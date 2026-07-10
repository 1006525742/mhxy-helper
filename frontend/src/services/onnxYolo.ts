/**
 * ONNX YOLO 推理服务
 * 纯前端运行，跨平台
 */
import * as ort from 'onnxruntime-web'

// 配置
const CONFIG = {
  inputSize: 640,
  confidenceThreshold: 0.5,
  nmsThreshold: 0.5
}

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
    console.log('YOLO 模型加载成功:', session.inputNames, session.outputNames)
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
  const inputSize = CONFIG.inputSize

  // 创建输入 tensor (1, 3, 640, 640)
  const input = new Float32Array(3 * inputSize * inputSize)
  const scaleX = width / inputSize
  const scaleY = height / inputSize

  for (let y = 0; y < inputSize; y++) {
    for (let x = 0; x < inputSize; x++) {
      const srcX = Math.floor(x * scaleX)
      const srcY = Math.floor(y * scaleY)
      const srcIdx = (srcY * width + srcX) * 4

      // RGB 归一化到 0-1
      const r = data[srcIdx] / 255
      const g = data[srcIdx + 1] / 255
      const b = data[srcIdx + 2] / 255

      // CHW 格式
      input[0 * inputSize * inputSize + y * inputSize + x] = r
      input[1 * inputSize * inputSize + y * inputSize + x] = g
      input[2 * inputSize * inputSize + y * inputSize + x] = b
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

    if (maxClassConf > CONFIG.confidenceThreshold) {
      boxes.push({
        x1: (cx - w / 2) * width / inputSize,
        y1: (cy - h / 2) * height / inputSize,
        x2: (cx + w / 2) * width / inputSize,
        y2: (cy + h / 2) * height / inputSize,
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