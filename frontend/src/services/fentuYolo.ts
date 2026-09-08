/**
 * 分图助手 YOLO 检测器（TensorFlow.js 版）
 *
 * 加载白嫖的 mhxyai cbaotu graph model：
 *   - 输入: [1, 480, 480, 3] NHWC, float32, 归一化 0~1
 *   - 输出: [1, 10, 4725]  (4 bbox + 6 class, 4725 anchors) YOLOv8 风格
 *   - 6 类: 藏宝图0/1/2、物品栏、仓库物品栏、仓库
 *
 * 置信度 0.45，NMS IoU 0.45，后端优先 webgl。
 *
 * 注意：TF.js 采用动态 import，避免拖慢首屏；模型加载带进度回调。
 */
import { FENTU_LABELS, type FentuLabel } from './fentuLogic'

export interface FentuDetection {
  className: FentuLabel
  classId: number
  conf: number
  /** 检测框中心 x（映射回原始屏幕坐标） */
  cx: number
  /** 检测框中心 y（映射回原始屏幕坐标） */
  cy: number
  /** 检测框左上 x */
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface FentuYOLOConfig {
  modelUrl: string
  inputSize?: number
  confidenceThreshold?: number
  iouThreshold?: number
}

/** 内部配置：合并默认值后所有字段都必填 */
interface InternalConfig {
  modelUrl: string
  inputSize: number
  confidenceThreshold: number
  iouThreshold: number
}

const DEFAULTS = {
  inputSize: 480,
  confidenceThreshold: 0.45,
  iouThreshold: 0.45
}

/**
 * 浏览器 IndexedDB 缓存键。
 * 版本号 bump 即可自动失效旧缓存、触发重新下载：
 *  - v2 -> v3：模型从量化版 cbaotu（权重全 uint8，TF.js 报 Unsupported dtype 无法加载）
 *            切换到未量化版 cbaotu_orig（float32/int32），必须换 key 避免复用损坏缓存。
 */
const MODEL_CACHE_KEY = 'indexeddb://fentu-cbaotu-v3'

/** 模型来源：'cache'=浏览器缓存秒开 / 'download'=本次网络下载 / null=未加载 */
let modelSource: 'cache' | 'download' | null = null

/**
 * 单例加载锁：保证同一页面会话内模型只真正加载一次。
 * 反复进出分图/挖图页面时，重复调用 loadFentuModel 会共享同一次加载结果，
 * 不会每次都重新下载/解包模型（这是外网"每次都转圈下载"的根因之一）。
 */
let loadingPromise: Promise<boolean> | null = null

// TF.js 动态 import，避免进入首屏 bundle
let tf: any = null
let model: any = null
let backendReady = false
let cfg: InternalConfig = { modelUrl: '', ...DEFAULTS }

/**
 * 初始化后端（webgl 优先，失败回退 cpu）
 */
async function ensureBackend(): Promise<void> {
  if (backendReady) return
  const backends = ['webgl', 'cpu']
  for (const b of backends) {
    try {
      await tf.setBackend(b)
      await tf.ready()
      console.log('[fentuYolo] backend:', b)
      backendReady = true
      return
    } catch (e) {
      console.warn(`[fentuYolo] backend ${b} 失败:`, e)
    }
  }
  throw new Error('无可用 TF.js 后端')
}

/**
 * WebGL 预热：用一张全零输入跑一次前向，触发 shader 编译，
 * 把「首帧推理才编译」的卡顿提前到加载阶段消化。输出直接丢弃。
 */
async function warmupModel(): Promise<void> {
  if (!model || !tf) return
  try {
    const dummy = tf.zeros([1, cfg.inputSize, cfg.inputSize, 3])
    const out = model.predict(dummy)
    if (Array.isArray(out)) out.forEach((t: any) => t.dispose())
    else out.dispose()
    dummy.dispose()
    console.log('[fentuYolo] WebGL 预热完成')
  } catch (e) {
    console.warn('[fentuYolo] 预热失败（不影响使用）:', e)
  }
}

/**
 * 加载 graph model（动态 import TF.js，带进度回调）
 *
 * 浏览器缓存策略（对齐原站"不用每次加载"的体验）：
 *   1) 优先从浏览器 IndexedDB 缓存读取 —— 秒开，无任何网络请求；
 *   2) 缓存未命中时再从 URL 下载（带进度），下载完成后写入 IndexedDB；
 *   下次访问直接从缓存取，不再重复下载约 11MB 的模型权重。
 *
 * @param onProgress fraction: 0~1 下载进度（仅网络下载时回调；缓存命中直接到 1）
 * @param onSource  模型来源回调：'cache'=命中浏览器缓存 / 'download'=本次网络下载
 */
export async function loadFentuModel(
  config: FentuYOLOConfig,
  onProgress?: (fraction: number) => void,
  onSource?: (source: 'cache' | 'download') => void
): Promise<boolean> {
  // 守卫 1：模型已在内存中（如刚从分图切到挖图）→ 直接复用，不触发任何下载/解包
  if (model) {
    onSource?.(modelSource ?? 'cache')
    onProgress?.(1)
    return true
  }
  // 守卫 2：并发去重（多个视图同时 mount 时共享同一次加载）
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    cfg = { ...DEFAULTS, ...config }
    try {
      if (!tf) {
        tf = await import('@tensorflow/tfjs')
      }
      await ensureBackend()

      // 1) 优先读浏览器 IndexedDB 缓存（秒开，无任何网络请求）
      try {
        const cached = await tf.loadGraphModel(MODEL_CACHE_KEY)
        model = cached
        modelSource = 'cache'
        onSource?.('cache')
        console.log('[fentuYolo] 从浏览器缓存加载模型（秒开）')
        onProgress?.(1)
        await warmupModel()
        return true
      } catch (cacheErr) {
        // 2) 缓存未命中 → 从 URL 下载
        console.log('[fentuYolo] 浏览器无缓存，开始下载模型…', cacheErr)
        modelSource = 'download'
        onSource?.('download')
        model = await tf.loadGraphModel(
          cfg.modelUrl,
          onProgress ? { onProgress } : undefined
        )
        // 3) 写入 IndexedDB，供下次访问秒开
        try {
          await model.save(MODEL_CACHE_KEY)
          console.log('[fentuYolo] 模型已缓存到浏览器 IndexedDB')
        } catch (saveErr) {
          // 显式报错：IndexedDB 写入失败会导致下次仍需下载，必须让用户知道
          console.error('[fentuYolo] ⚠️ 模型写入 IndexedDB 失败（下次访问仍会重新下载）:', saveErr)
        }
      }

      // 4) WebGL 预热：加载阶段用空图跑一次前向，提前编译 shader，
      //    避免加载条结束后「第一帧识别」才触发编译而卡顿。
      await warmupModel()

      return true
    } catch (e) {
      console.error('[fentuYolo] 模型加载失败:', e)
      throw e
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

/** 读取当前模型来源（'cache' / 'download' / null） */
export function getFentuModelSource(): 'cache' | 'download' | null {
  return modelSource
}

/** 清除浏览器中的模型缓存（换模型版本时调用；之后会重新触发下载） */
export async function clearFentuModelCache(): Promise<void> {
  try {
    if (!tf) tf = await import('@tensorflow/tfjs')
    await tf.io.removeModel(MODEL_CACHE_KEY)
    console.log('[fentuYolo] 已清除模型缓存')
  } catch (e) {
    console.warn('[fentuYolo] 清除模型缓存失败（可能本就没有）:', e)
  }
}

/**
 * 模型是否已加载
 */
export function isFentuModelLoaded(): boolean {
  return model !== null
}

/**
 * 释放模型
 */
export function disposeFentuModel(): void {
  if (model) {
    model.dispose()
    model = null
  }
}

/**
 * 运行一次完整推理 + 后处理
 * @param imageData 来自 canvas 的 ImageData（任意尺寸，内部 resize 到 480）
 */
export async function detectFentu(imageData: ImageData): Promise<FentuDetection[]> {
  if (!model || !tf) {
    console.warn('[fentuYolo] 模型未加载')
    return []
  }

  const { width: srcW, height: srcH } = imageData
  const size = cfg.inputSize

  // 预处理
  const inputTensor = tf.tidy(() => {
    const input = tf.browser.fromPixels(imageData)
    const floatInput = tf.cast(input, 'float32')
    const resized = tf.image.resizeBilinear(floatInput, [size, size])
    const normalized = tf.div(resized, tf.scalar(255))
    return normalized.expandDims(0) // [1, 480, 480, 3]
  })

  let output: any
  try {
    const results = model.predict(inputTensor)
    // predict 可能返回 Tensor 或 Tensor[]
    output = Array.isArray(results) ? results[0] : results
  } finally {
    inputTensor.dispose()
  }

  // 输出 shape [1, 10, 4725] → 转成 [4725, 10] 方便处理
  const dims = output.shape
  const outData = await output.data()
  output.dispose()

  const channels = dims?.[1] ?? 10
  const numAnchors = dims?.[2] ?? 4725
  const numClasses = channels - 4 // 6
  const confThresh = cfg.confidenceThreshold

  const detections: FentuDetection[] = []
  const scaleX = srcW / size
  const scaleY = srcH / size

  for (let i = 0; i < numAnchors; i++) {
    // [1, channels, anchors] 布局：channelStride = anchors, anchorStride = 1
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
      // 480 空间坐标 → 原始屏幕坐标（等比映射回 srcW × srcH）
      const x1 = (cx - w / 2) * scaleX
      const y1 = (cy - h / 2) * scaleY
      const x2 = (cx + w / 2) * scaleX
      const y2 = (cy + h / 2) * scaleY
      detections.push({
        className: FENTU_LABELS[classId] || ('物品栏' as FentuLabel),
        classId,
        conf: maxConf,
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
        x1, y1, x2, y2
      })
    }
  }

  return nms(detections, cfg.iouThreshold)
}
function nms(boxes: FentuDetection[], iouThreshold: number): FentuDetection[] {
  if (boxes.length === 0) return []
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf)
  const keep: FentuDetection[] = []
  const removed = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (removed.has(i)) continue
    keep.push(sorted[i])
    for (let j = i + 1; j < sorted.length; j++) {
      if (removed.has(j)) continue
      if (iou(sorted[i], sorted[j]) > iouThreshold) {
        removed.add(j)
      }
    }
  }
  return keep
}

function iou(a: FentuDetection, b: FentuDetection): number {
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
