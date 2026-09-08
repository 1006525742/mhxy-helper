/**
 * 自动战斗框检测 YOLO（TensorFlow.js 版）—— 复刻 mhxyai.com/v2/jiankong4
 *
 * 复用项目 fentuYolo.ts 同套 TF.js graph model 推理管线（动态 import @tensorflow/tfjs、
 * IndexedDB 缓存、WebGL 预热），仅替换模型与标签：
 *   - 模型: /models/jk4/model.json（已下载到 public/models/jk4/，与 fentu 的 cbaotu 同出处）
 *   - 输入: [1,480,480,3]；输出: [1,9,4725]（4 bbox + 5 class，YOLOv8 风格，无 obj-conf 通道）
 *   - 5 类 labels: ['回合3','回合2','回合1','自动战斗','四小人']（顺序须与模型训练时一致）
 *
 * detectJk4(imageData) 返回 Jk4Detection[]，坐标已映射回原始 imageData 像素空间。
 */
export const JK4_LABELS = ['回合3', '回合2', '回合1', '自动战斗', '四小人'] as const
export type Jk4Label = (typeof JK4_LABELS)[number]

export interface Jk4Detection {
  className: Jk4Label | string
  classId: number
  conf: number
  /** 检测框中心 x（映射回原始图像坐标） */
  cx: number
  /** 检测框中心 y */
  cy: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Jk4YOLOConfig {
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

const DEFAULTS = {
  modelUrl: '/models/jk4/model.json',
  inputSize: 480,
  confidenceThreshold: 0.4,
  iouThreshold: 0.45
}

/**
 * 浏览器 IndexedDB 缓存键。bump 版本号即可失效旧缓存、触发重新下载。
 */
const MODEL_CACHE_KEY = 'indexeddb://jk4-v1'

/** 模型来源：'cache'=浏览器缓存秒开 / 'download'=本次网络下载 / null=未加载 */
let modelSource: 'cache' | 'download' | null = null

let loadingPromise: Promise<boolean> | null = null

// TF.js 动态 import，避免进入首屏 bundle
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
      console.log('[jk4Yolo] backend:', b)
      backendReady = true
      return
    } catch (e) {
      console.warn(`[jk4Yolo] backend ${b} 失败:`, e)
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
    console.log('[jk4Yolo] WebGL 预热完成')
  } catch (e) {
    console.warn('[jk4Yolo] 预热失败（不影响使用）:', e)
  }
}

/**
 * 加载 jk4 graph model（动态 import TF.js，带进度回调）。
 * 优先浏览器 IndexedDB 缓存，未命中则从 /models/jk4/model.json 下载并写入缓存。
 */
export async function loadJk4Model(
  config?: Partial<Jk4YOLOConfig>,
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
        console.log('[jk4Yolo] 从浏览器缓存加载模型（秒开）')
        onProgress?.(1)
        await warmupModel()
        return true
      } catch {
        console.log('[jk4Yolo] 浏览器无缓存，开始下载模型…')
        modelSource = 'download'
        onSource?.('download')
        model = await tf.loadGraphModel(
          cfg.modelUrl,
          onProgress ? { onProgress } : undefined
        )
        try {
          await model.save(MODEL_CACHE_KEY)
          console.log('[jk4Yolo] 模型已缓存到浏览器 IndexedDB')
        } catch (saveErr) {
          console.error('[jk4Yolo] ⚠️ 模型写入 IndexedDB 失败（下次访问仍会重新下载）:', saveErr)
        }
      }

      await warmupModel()
      return true
    } catch (e) {
      console.error('[jk4Yolo] 模型加载失败:', e)
      throw e
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

export function getJk4ModelSource(): 'cache' | 'download' | null {
  return modelSource
}

export async function clearJk4ModelCache(): Promise<void> {
  try {
    if (!tf) tf = await import('@tensorflow/tfjs')
    await tf.io.removeModel(MODEL_CACHE_KEY)
    console.log('[jk4Yolo] 已清除模型缓存')
  } catch (e) {
    console.warn('[jk4Yolo] 清除模型缓存失败（可能本就没有）:', e)
  }
}

export function isJk4ModelLoaded(): boolean {
  return model !== null
}

export function disposeJk4Model(): void {
  if (model) {
    model.dispose()
    model = null
  }
}

/**
 * 运行一次完整推理 + 后处理。
 * @param imageData 来自 canvas 的 ImageData（任意尺寸，内部 resize 到 480）
 * 输出 [1,9,4725]：前 4 通道为 bbox(cx,cy,w,h)，后 5 通道为各类置信度，
 * 无独立 obj-conf 通道（YOLOv8 风格，与 fentuYolo 一致）。
 */
export async function detectJk4(
  imageData: ImageData,
  confThresholdOverride?: number
): Promise<Jk4Detection[]> {
  if (!model || !tf) {
    console.warn('[jk4Yolo] 模型未加载')
    return []
  }

  const { width: srcW, height: srcH } = imageData
  const size = cfg.inputSize

  const inputTensor = tf.tidy(() => {
    const input = tf.browser.fromPixels(imageData)
    const floatInput = tf.cast(input, 'float32')
    const resized = tf.image.resizeBilinear(floatInput, [size, size])
    const normalized = tf.div(resized, tf.scalar(255))
    return normalized.expandDims(0)
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

  const channels = dims?.[1] ?? 9
  const numAnchors = dims?.[2] ?? 4725
  const numClasses = channels - 4 // 5
  const confThresh = confThresholdOverride ?? cfg.confidenceThreshold

  const detections: Jk4Detection[] = []
  const scaleX = srcW / size
  const scaleY = srcH / size

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
      const x1 = (cx - w / 2) * scaleX
      const y1 = (cy - h / 2) * scaleY
      const x2 = (cx + w / 2) * scaleX
      const y2 = (cy + h / 2) * scaleY
      detections.push({
        className: JK4_LABELS[classId] || `class_${classId}`,
        classId,
        conf: maxConf,
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
        x1,
        y1,
        x2,
        y2
      })
    }
  }

  return nms(detections, cfg.iouThreshold)
}

function nms(boxes: Jk4Detection[], iouThreshold: number): Jk4Detection[] {
  if (boxes.length === 0) return []
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf)
  const keep: Jk4Detection[] = []
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

function iou(a: Jk4Detection, b: Jk4Detection): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  const union = areaA + areaB - inter
  return union <= 0 ? 0 : inter / union
}
