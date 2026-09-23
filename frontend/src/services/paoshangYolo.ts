/**
 * 跑商商品检测 YOLO（TensorFlow.js 版）—— 复刻 mhxyai.com/v2/paoshang
 *
 * 与抓鬼/监控模块（jiankong4Yolo.ts）同一套管线：动态 import @tensorflow/tfjs、
 * IndexedDB 缓存、WebGL 预热、letterbox 预处理。
 *
 *   - 模型: /models/paoshang/model.json（TF.js graph model，权重 3 分片）
 *   - 输入: [1,480,480,3]；输出: [1,68,4725]（4 bbox + 64 class，YOLOv8 风格）
 *   - 64 类 labels 见 paoshangLogic.ts 的 PAOSHANG_LABELS（顺序须与训练时一致）
 *
 * 相比 ONNX 版的好处：首次下载有进度反馈，之后走 IndexedDB 缓存秒开。
 */
import { PAOSHANG_LABELS } from './paoshangLogic'

export interface PaoshangDetection {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
  classId: number
  className: string
}

export interface PaoshangYOLOConfig {
  modelUrl?: string
  inputSize?: number
  confidenceThreshold?: number
  iouThreshold?: number
}

interface InternalConfig {
  modelUrl: string
  inputSize: number
  confidenceThreshold: number
  iouThreshold: number
}

const DEFAULTS: InternalConfig = {
  modelUrl: '/models/paoshang/model.json',
  inputSize: 480,
  confidenceThreshold: 0.4,
  iouThreshold: 0.45
}

/** 浏览器 IndexedDB 缓存键。bump 版本号即可失效旧缓存、触发重新下载。 */
const MODEL_CACHE_KEY = 'indexeddb://paoshang-v1'

type ModelSource = 'cache' | 'download' | null

let modelSource: ModelSource = null
let loadingPromise: Promise<boolean> | null = null

let tf: any = null
let model: any = null
let backendReady = false
let cfg: InternalConfig = { ...DEFAULTS }

async function ensureBackend(): Promise<void> {
  if (backendReady) return
  const backends = ['webgl', 'cpu']
  for (const b of backends) {
    try {
      await tf.setBackend(b)
      await tf.ready()
      console.log('[paoshangYolo] backend:', b)
      backendReady = true
      return
    } catch (e) {
      console.warn(`[paoshangYolo] backend ${b} 失败:`, e)
    }
  }
  throw new Error('无可用 TF.js 后端')
}

async function warmupModel(): Promise<void> {
  if (!model || !tf) return
  try {
    const dummy = tf.zeros([1, cfg.inputSize, cfg.inputSize, 3])
    const out = model.predict(dummy)
    if (Array.isArray(out)) out.forEach((t: any) => t.dispose())
    else out.dispose()
    dummy.dispose()
    console.log('[paoshangYolo] WebGL 预热完成')
  } catch (e) {
    console.warn('[paoshangYolo] 预热失败（不影响使用）:', e)
  }
}

/**
 * 加载跑商模型。优先 IndexedDB 缓存（秒开），未命中则下载并写入缓存。
 * @param onProgress 下载进度 0~1（仅首次下载触发）
 * @param onSource 'cache'=命中浏览器缓存 / 'download'=本次网络下载
 */
export async function loadPaoshangModel(
  config?: Partial<PaoshangYOLOConfig>,
  onProgress?: (fraction: number) => void,
  onSource?: (source: 'cache' | 'download') => void
): Promise<boolean> {
  if (model) {
    onSource?.(modelSource ?? 'cache')
    onProgress?.(1)
    return true
  }
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    cfg = { ...DEFAULTS, ...config }
    try {
      if (!tf) tf = await import('@tensorflow/tfjs')
      await ensureBackend()

      try {
        const cached = await tf.loadGraphModel(MODEL_CACHE_KEY)
        model = cached
        modelSource = 'cache'
        onSource?.('cache')
        console.log('[paoshangYolo] 从浏览器缓存加载模型（秒开）')
        onProgress?.(1)
        await warmupModel()
        return true
      } catch {
        console.log('[paoshangYolo] 浏览器无缓存，开始下载模型…')
        modelSource = 'download'
        onSource?.('download')
        model = await tf.loadGraphModel(
          cfg.modelUrl,
          onProgress ? { onProgress } : undefined
        )
        try {
          await model.save(MODEL_CACHE_KEY)
          console.log('[paoshangYolo] 模型已缓存到浏览器 IndexedDB')
        } catch (saveErr) {
          console.error('[paoshangYolo] ⚠️ 模型写入 IndexedDB 失败（下次访问仍会重新下载）:', saveErr)
        }
      }

      await warmupModel()
      return true
    } catch (e) {
      console.error('[paoshangYolo] 模型加载失败:', e)
      throw e
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

export function getPaoshangModelSource(): ModelSource {
  return modelSource
}

export function isPaoshangModelLoaded(): boolean {
  return model !== null
}

export async function clearPaoshangModelCache(): Promise<void> {
  try {
    if (!tf) tf = await import('@tensorflow/tfjs')
    await tf.io.removeModel(MODEL_CACHE_KEY)
    console.log('[paoshangYolo] 已清除模型缓存')
  } catch (e) {
    console.warn('[paoshangYolo] 清除模型缓存失败（可能本就没有）:', e)
  }
}

/**
 * 跑一次推理。letterbox 预处理（保持宽高比 + 灰 114 填充），
 * 与模型训练时一致，检测框不会偏。坐标已映射回原始 imageData 像素空间。
 */
export async function detectPaoshang(
  imageData: ImageData,
  confThresholdOverride?: number
): Promise<PaoshangDetection[]> {
  if (!model || !tf) {
    console.warn('[paoshangYolo] 模型未加载')
    return []
  }

  const { width: srcW, height: srcH } = imageData
  const size = cfg.inputSize
  const scale = Math.min(size / srcW, size / srcH)
  const newW = Math.round(srcW * scale)
  const newH = Math.round(srcH * scale)
  const padX = (size - newW) / 2
  const padY = (size - newH) / 2

  const inputTensor = tf.tidy(() => {
    const input = tf.browser.fromPixels(imageData)
    const floatInput = tf.cast(input, 'float32')
    const resized = tf.image.resizeBilinear(floatInput, [newH, newW])
    const normalized = tf.div(resized, tf.scalar(255))
    const padTop = Math.floor(padY)
    const padLeft = Math.floor(padX)
    const padBottom = size - newH - padTop
    const padRight = size - newW - padLeft
    const padded = tf.pad(normalized, [[padTop, padBottom], [padLeft, padRight], [0, 0]], 114 / 255)
    return padded.expandDims(0)
  })

  let output: any
  try {
    const results = model.predict(inputTensor)
    output = Array.isArray(results) ? results[0] : results
  } finally {
    inputTensor.dispose()
  }

  const dims = output.shape
  const outData = await output.data()
  output.dispose()

  const channels = dims?.[1] ?? 68
  const numAnchors = dims?.[2] ?? 4725
  const numClasses = channels - 4
  const confThresh = confThresholdOverride ?? cfg.confidenceThreshold

  const detections: PaoshangDetection[] = []

  for (let i = 0; i < numAnchors; i++) {
    const cx = outData[0 * numAnchors + i]
    const cy = outData[1 * numAnchors + i]
    const w = outData[2 * numAnchors + i]
    const h = outData[3 * numAnchors + i]

    let maxConf = 0
    let classId = 0
    for (let c = 0; c < numClasses; c++) {
      const conf = outData[(4 + c) * numAnchors + i]
      if (conf > maxConf) {
        maxConf = conf
        classId = c
      }
    }

    if (maxConf > confThresh) {
      // 模型坐标 -> letterbox 画布 -> 原图
      const toX = (m: number) => (m - padX) / scale
      const toY = (m: number) => (m - padY) / scale
      const clampX = (v: number) => Math.max(0, Math.min(srcW, v))
      const clampY = (v: number) => Math.max(0, Math.min(srcH, v))
      detections.push({
        x1: clampX(toX(cx - w / 2)),
        y1: clampY(toY(cy - h / 2)),
        x2: clampX(toX(cx + w / 2)),
        y2: clampY(toY(cy + h / 2)),
        conf: maxConf,
        classId,
        className: PAOSHANG_LABELS[classId] || `class_${classId}`
      })
    }
  }

  return nms(detections, cfg.iouThreshold)
}

function nms(boxes: PaoshangDetection[], iouThreshold: number): PaoshangDetection[] {
  if (boxes.length === 0) return []
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf)
  const keep: PaoshangDetection[] = []
  const removed = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (removed.has(i)) continue
    keep.push(sorted[i])
    for (let j = i + 1; j < sorted.length; j++) {
      if (removed.has(j)) continue
      if (iou(sorted[i], sorted[j]) > iouThreshold) removed.add(j)
    }
  }
  return keep
}

function iou(a: PaoshangDetection, b: PaoshangDetection): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter)
}
