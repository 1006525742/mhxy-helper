/**
 * ONNX YOLO 推理服务
 * 纯前端运行，跨平台
 */
import * as ort from 'onnxruntime-web'

// 自托管 ONNX wasm 推理引擎
// wasm 走本地 public/ort-wasm（生产构建直接当静态文件；dev 下由 vite.config.ts
// 的 ort-wasm 中间件在 Vite transform 之前直送，绕开「public 文件不可当模块 import」限制）。
// 强制单线程：onnxruntime-web 默认多线程需要服务端返回 COOP/COEP 跨域隔离头，
// 而 VPS nginx 没有这些头，浏览器会拒绝多线程 wasm。单线程版免跨域隔离，本地/VPS 均可正常加载。
ort.env.wasm.wasmPaths = '/ort-wasm/'
ort.env.wasm.numThreads = 1

// 配置
const CONFIG = {
  inputSize: 640,
  confidenceThreshold: 0.5,
  nmsThreshold: 0.5
}

// 运行时输入尺寸（不同模型可能不同，如 dati=480）
let curInputSize = CONFIG.inputSize
// 运行时置信度阈值（dati 用 0.4，宝图等默认 0.5）
let curConfThreshold = CONFIG.confidenceThreshold
// 是否使用 letterbox 预处理（保持宽高比 + 灰 114 填充）。
// YOLO 训练普遍采用 letterbox，推理必须一致，否则框会偏。
// mhxyai 的 useYoloDetector 也是这套（fillStyle rgb(114,114,114) + 记录 scale/padX/padY）。
// 默认关闭以兼容既有模块（宝图等历史行为），dati 显式开启。
let curLetterbox = false

export interface Detection {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
  classId: number
  className?: string
}

export interface YOLOConfig {
  modelPath: string
  classNames?: string[]
  inputSize?: number
  confidenceThreshold?: number
  /** 保持宽高比的 letterbox 预处理（YOLO 标准做法）。dati 必须开启，否则检测框会偏。 */
  letterbox?: boolean
}

let session: ort.InferenceSession | null = null
let classNames: string[] = ['treasure_map', 'coord_popup']

/**
 * 初始化 YOLO 模型
 */
export async function initYOLO(config: YOLOConfig): Promise<boolean> {
  try {
    session = await ort.InferenceSession.create(config.modelPath)
    if (config.classNames) {
      classNames = config.classNames
    }
    if (config.inputSize) {
      curInputSize = config.inputSize
    }
    if (typeof config.confidenceThreshold === 'number') {
      curConfThreshold = config.confidenceThreshold
    }
    curLetterbox = config.letterbox === true
    console.log('YOLO 模型加载成功:', session.inputNames, session.outputNames, 'inputSize=', curInputSize, 'letterbox=', curLetterbox)
    return true
  } catch (e) {
    console.error('YOLO 模型加载失败:', e)
    return false
  }
}

/**
 * 运行 YOLO 推理
 */
export async function runYOLO(imageData: ImageData): Promise<Detection[]> {
  if (!session) {
    console.error('YOLO 模型未加载')
    return []
  }

  const { width, height, data } = imageData
  const inputSize = curInputSize

  // 创建输入 tensor (1, 3, inputSize, inputSize)
  const input = new Float32Array(3 * inputSize * inputSize)

  // letterbox 参数：保持宽高比缩放后居中，四周填灰 114（YOLO 训练/推理标准）
  // 反算原图坐标： origX = (modelX - padX) / scale
  const scale = curLetterbox
    ? Math.min(inputSize / width, inputSize / height)
    : 1
  const newW = curLetterbox ? Math.round(width * scale) : inputSize
  const newH = curLetterbox ? Math.round(height * scale) : inputSize
  const padX = (inputSize - newW) / 2
  const padY = (inputSize - newH) / 2
  const padVal = 114 / 255

  if (curLetterbox) input.fill(padVal)

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      // 目标像素 (dstX, dstY) 在 inputSize 网格上的位置
      const dstX = x + padX
      const dstY = y + padY
      // 源像素：letterbox 时按比例映射，否则按拉伸映射
      const srcX = curLetterbox ? Math.min(width - 1, Math.floor(x / scale)) : Math.floor(x * width / inputSize)
      const srcY = curLetterbox ? Math.min(height - 1, Math.floor(y / scale)) : Math.floor(y * height / inputSize)
      const srcIdx = (srcY * width + srcX) * 4

      // RGB 归一化到 0-1
      const r = data[srcIdx] / 255
      const g = data[srcIdx + 1] / 255
      const b = data[srcIdx + 2] / 255

      // CHW 格式（写入取整后的网格位置）
      const gx = Math.round(dstX)
      const gy = Math.round(dstY)
      if (gx >= inputSize || gy >= inputSize) continue
      const di = gy * inputSize + gx
      input[0 * inputSize * inputSize + di] = r
      input[1 * inputSize * inputSize + di] = g
      input[2 * inputSize * inputSize + di] = b
    }
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize])
  const feeds = { 'images': tensor }
  const results = await session.run(feeds)

  // 解析输出 - YOLOv8 输出 shape: [1, 4+nc, num_anchors]
  const outputTensor = results[session.outputNames[0]]
  const output = outputTensor.data as Float32Array
  const dims = outputTensor.dims as number[]

  // dims 可能是 [1, channels, anchors] 或 [1, anchors, channels]
  let channels: number, numAnchors: number, channelStride: number, anchorStride: number

  if (dims.length === 3) {
    if (dims[1] < dims[2]) {
      // [1, channels, anchors]
      channels = dims[1]
      numAnchors = dims[2]
      channelStride = numAnchors
      anchorStride = 1
    } else {
      // [1, anchors, channels]
      numAnchors = dims[1]
      channels = dims[2]
      channelStride = 1
      anchorStride = channels
    }
  } else {
    console.error('意外的输出维度:', dims)
    return []
  }

  const numClasses = channels - 4
  const boxes: Detection[] = []

  for (let i = 0; i < numAnchors; i++) {
    // 读取 cx, cy, w, h
    const cx = output[0 * channelStride + i * anchorStride]
    const cy = output[1 * channelStride + i * anchorStride]
    const w = output[2 * channelStride + i * anchorStride]
    const h = output[3 * channelStride + i * anchorStride]

    // 找最大类别置信度
    let maxClassConf = 0
    let classId = 0
    for (let c = 0; c < numClasses; c++) {
      const conf = output[(4 + c) * channelStride + i * anchorStride]
      if (conf > maxClassConf) {
        maxClassConf = conf
        classId = c
      }
    }

    if (maxClassConf > curConfThreshold) {
      // 模型网格坐标 -> 原图坐标
      // letterbox: (m - pad) / scale；非 letterbox(拉伸): m * size / inputSize
      const toX = (m: number) => (curLetterbox ? (m - padX) / scale : m * width / inputSize)
      const toY = (m: number) => (curLetterbox ? (m - padY) / scale : m * height / inputSize)
      const clampX = (v: number) => Math.max(0, Math.min(width, v))
      const clampY = (v: number) => Math.max(0, Math.min(height, v))
      boxes.push({
        x1: clampX(toX(cx - w / 2)),
        y1: clampY(toY(cy - h / 2)),
        x2: clampX(toX(cx + w / 2)),
        y2: clampY(toY(cy + h / 2)),
        conf: maxClassConf,
        classId,
        className: classNames[classId]
      })
    }
  }

  // NMS
  return nms(boxes, CONFIG.nmsThreshold)
}

/**
 * 非极大值抑制
 */
function nms(boxes: Detection[], threshold: number): Detection[] {
  if (boxes.length === 0) return []

  boxes.sort((a, b) => b.conf - a.conf)
  const keep: Detection[] = []

  while (boxes.length > 0) {
    const best = boxes.shift()!
    keep.push(best)

    boxes = boxes.filter(box => calcIOU(best, box) <= threshold)
  }

  return keep
}

/**
 * 计算 IOU
 */
function calcIOU(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)

  const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)

  return interArea / (areaA + areaB - interArea)
}

/**
 * 模型是否已加载
 */
export function isModelLoaded(): boolean {
  return session !== null
}