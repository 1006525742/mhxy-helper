/**
 * 浏览器本地 PaddleOCR（PP-OCRv6 tiny，det + rec）
 *
 * 纯前端本地 OCR：不依赖任何后端（无 :8001）、模型权重自托管在 public/models/paddleocr/。
 * 推理引擎 onnxruntime-web 的 wasm 也自托管在 public/ort-wasm/（见 scripts/fetch_paddle_models.mjs）。
 *
 * 说明：
 *  - 游戏聊天文字为水平排布，检测采用「DB 概率图 → 阈值 → 连通域 → 轴对齐框」，
 *    不追求旋转框，足够；相比 OpenCV 轮廓拟合更轻、更易在浏览器实现。
 *  - 识别为 CTC 贪心解码 + ppocr_keys_v1 字典（6623 字 + blank）。
 *  - 预处理：RGB / 255，ImageNet 归一化(mean=[.485,.456,.406] std=[.229,.224,.225])，ToCHW。
 *  - 算法遵循 PP-OCRv6 tiny 官方管线；因无法在 Node 无头环境验证 ONNX 推理，
 *    首次浏览器运行请确认识别框/文字是否正常（见仓库 README / 方案文档）。
 */

import * as ort from 'onnxruntime-web'

// 自托管推理引擎 wasm（复制自 onnxruntime-web 的 dist 到 public/ort-wasm/）
ort.env.wasm.wasmPaths = '/ort-wasm/'
// 强制单线程：避免 wasm 多线程所需的 COOP/COEP 响应头（dev server 未设置会直接 backend 不可用）
ort.env.wasm.numThreads = 1
// 若本地 wasm 缺失，回退 jsdelivr（仅引擎二进制，模型仍本地）
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'

export interface OcrOptions {
  /** 模型目录，默认自托管。可改成百度 CDN 的 .tar 解包路径做回退 */
  modelBase?: string
  /** det 限制边长（长边），默认 960 */
  detLimitSideLen?: number
  /** 文本置信度阈值，低于丢弃，默认 0.3 */
  recScoreThresh?: number
}

interface LoadedModels {
  det: ort.InferenceSession
  rec: ort.InferenceSession
  dict: string[]
}

// PP-OCRv6 tiny 官方推理模型（百度云，作为本地模型缺失时的运行时回退，等同 mhxyai 行为）
const CDN = {
  det: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_det_onnx_infer.tar',
  rec: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar'
}
const DICT_URL = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt'

let models: LoadedModels | null = null
let loadPromise: Promise<LoadedModels> | null = null

function localPath(modelBase: string, file: string): string {
  return `${modelBase.replace(/\/$/, '')}/${file}`
}

/** 最小 tar 解析：从 .tar 中取出名为 *inference.onnx 的条目返回 ArrayBuffer */
async function extractOnnxFromTar(url: string): Promise<ArrayBuffer> {
  const buf = await (await fetch(url)).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let offset = 0
  const str = (off: number, len: number) => {
    let s = ''
    for (let i = 0; i < len; i++) {
      const c = bytes[off + i]
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }
  while (offset + 512 <= buf.byteLength) {
    const name = str(offset, 100).trim()
    const size = parseInt(str(offset + 124, 12).trim(), 8) || 0
    if (!name && !size) break
    offset += 512
    if (name.endsWith('inference.onnx')) {
      return buf.slice(offset, offset + size)
    }
    offset += Math.ceil(size / 512) * 512
  }
  throw new Error('inference.onnx 未在 tar 中找到: ' + url)
}

/** 优先读本地 onnx；缺失则运行时从百度云 tar 拉取（开箱即用，等同 mhxyai） */
async function getOnnx(local: string, cdnTar: string): Promise<ArrayBuffer> {
  try {
    const res = await fetch(local)
    if (res.ok) return await res.arrayBuffer()
  } catch {
    /* 本地缺失，走回退 */
  }
  return extractOnnxFromTar(cdnTar)
}

async function getDict(modelBase: string): Promise<string[]> {
  try {
    const res = await fetch(localPath(modelBase, 'ppocr_keys_v1.txt'))
    if (res.ok) {
      const t = await res.text()
      return ['', ...t.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)]
    }
  } catch {
    /* 本地缺失，走回退 */
  }
  const t = await (await fetch(DICT_URL)).text()
  return ['', ...t.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)]
}

/** 本地 wasm 缺失时回退 CDN。用 .mjs 探测并排除 Vite SPA fallback 的 text/html 误判 */
async function ensureWasmPaths(): Promise<void> {
  try {
    const res = await fetch(localPath('/ort-wasm/', 'ort-wasm-simd-threaded.jsep.mjs'), { method: 'HEAD' })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok || ct.includes('text/html')) {
      ort.env.wasm.wasmPaths = WASM_CDN
    }
  } catch {
    ort.env.wasm.wasmPaths = WASM_CDN
  }
}

export async function loadModels(opts: OcrOptions = {}): Promise<LoadedModels> {
  if (models) return models
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const modelBase = opts.modelBase || '/models/paddleocr/'
    await ensureWasmPaths()
    const [detBuf, recBuf, dict] = await Promise.all([
      getOnnx(localPath(modelBase, 'PP-OCRv6_tiny_det_infer/PP-OCRv6_tiny_det_onnx_infer/inference.onnx'), CDN.det),
      getOnnx(localPath(modelBase, 'PP-OCRv6_tiny_rec_infer/PP-OCRv6_tiny_rec_onnx_infer/inference.onnx'), CDN.rec),
      getDict(modelBase)
    ])
    const det = await ort.InferenceSession.create(detBuf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    })
    const rec = await ort.InferenceSession.create(recBuf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    })
    models = { det, rec, dict }
    return models
  })()
  return loadPromise
}

// ---------------------------------------------------------------------------
// 图像工具
// ---------------------------------------------------------------------------
function getImageData(canvas: HTMLCanvasElement | ImageData | HTMLImageElement): { data: Uint8ClampedArray; width: number; height: number } {
  if (canvas instanceof ImageData) return { data: canvas.data, width: canvas.width, height: canvas.height }
  const cv = document.createElement('canvas')
  const w = (canvas as HTMLCanvasElement).width || (canvas as HTMLImageElement).naturalWidth
  const h = (canvas as HTMLCanvasElement).height || (canvas as HTMLImageElement).naturalHeight
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.drawImage(canvas as CanvasImageSource, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  return { data: img.data, width: w, height: h }
}

/** RGB / 255 - mean/std，返回 CHW Float32，shape [1,3,H,W] */
function preprocessCHW(rgb: Uint8ClampedArray, h: number, w: number): { tensor: Float32Array; shape: [number, number, number, number] } {
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const out = new Float32Array(3 * h * w)
  for (let i = 0; i < h * w; i++) {
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 4 + c] / 255
      out[c * h * w + i] = (v - mean[c]) / std[c]
    }
  }
  return { tensor: out, shape: [1, 3, h, w] }
}

// ---------------------------------------------------------------------------
// 检测：DB 概率图 → 轴对齐框
// ---------------------------------------------------------------------------
interface Box { x: number; y: number; w: number; h: number }

async function detect(src: { data: Uint8ClampedArray; width: number; height: number }, limitSideLen: number): Promise<Box[]> {
  const { width: ow, height: oh } = src
  // 等比缩放：长边 = limitSideLen，短边按比例，再 pad 到 32 倍数
  const ratio = limitSideLen / Math.max(ow, oh)
  let rh = Math.round(oh * ratio)
  let rw = Math.round(ow * ratio)
  const padH = (32 - (rh % 32)) % 32
  const padW = (32 - (rw % 32)) % 32
  rh += padH
  rw += padW

  // 缩放 + 转 RGB
  const tmp = document.createElement('canvas')
  tmp.width = rw
  tmp.height = rh
  const tctx = tmp.getContext('2d')!
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = ow
  srcCanvas.height = oh
  srcCanvas.getContext('2d')!.putImageData(new ImageData(src.data, ow, oh), 0, 0)
  tctx.drawImage(srcCanvas, 0, 0, rw, rh)
  const rgb = tctx.getImageData(0, 0, rw, rh).data

  const { tensor, shape } = preprocessCHW(rgb, rh, rw)
  const input = new ort.Tensor('float32', tensor, shape)
  const out = await models!.det.run({ [models!.det.inputNames[0]]: input })
  const prob = out[models!.det.outputNames[0]].data as Float32Array // [1,1,H/4,W/4]
  const ohh = Math.floor(rh / 4)
  const oww = Math.floor(rw / 4)

  // sigmoid
  const map = new Float32Array(ohh * oww)
  for (let i = 0; i < map.length; i++) map[i] = 1 / (1 + Math.exp(-prob[i]))
  const TH = 0.3
  const bin = new Uint8Array(ohh * oww)
  for (let i = 0; i < map.length; i++) bin[i] = map[i] > TH ? 1 : 0

  // 连通域（4 连通）找轴对齐框
  const seen = new Uint8Array(ohh * oww)
  const boxes: Box[] = []
  const scaleX = ow / rw
  const scaleY = oh / rh
  for (let y = 0; y < ohh; y++) {
    for (let x = 0; x < oww; x++) {
      const idx = y * oww + x
      if (bin[idx] && !seen[idx]) {
        let minx = x, miny = y, maxx = x, maxy = y
        const stack = [idx]
        seen[idx] = 1
        while (stack.length) {
          const cur = stack.pop()!
          const cy = Math.floor(cur / oww)
          const cx = cur % oww
          minx = Math.min(minx, cx); miny = Math.min(miny, cy)
          maxx = Math.max(maxx, cx); maxy = Math.max(maxy, cy)
          const nb = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
          ]
          for (const [nx, ny] of nb) {
            if (nx < 0 || ny < 0 || nx >= oww || ny >= ohh) continue
            const nidx = ny * oww + nx
            if (bin[nidx] && !seen[nidx]) { seen[nidx] = 1; stack.push(nidx) }
          }
        }
        const bw = (maxx - minx + 1)
        const bh = (maxy - miny + 1)
        // 过滤极小框（< 原图 0.3% 面积或 <8px）
        if (bw * 4 >= 8 && bh * 4 >= 8) {
          boxes.push({
            x: Math.floor(minx * 4 * scaleX),
            y: Math.floor(miny * 4 * scaleY),
            w: Math.ceil((bw + 1) * 4 * scaleX),
            h: Math.ceil((bh + 1) * 4 * scaleY)
          })
        }
      }
    }
  }
  // 按 y 然后 x 排序，模拟从上到下、从左到右的阅读顺序
  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  return boxes
}

// ---------------------------------------------------------------------------
// 识别：裁框 → resize(48,动态) → 归一化 → CTC 解码
// ---------------------------------------------------------------------------
async function recognizeBox(
  src: { data: Uint8ClampedArray; width: number; height: number },
  box: Box,
  dict: string[],
  scoreThresh: number
): Promise<{ text: string; score: number } | null> {
  const { width: ow, height: oh } = src
  const x = Math.max(0, box.x)
  const y = Math.max(0, box.y)
  const w = Math.min(ow - x, box.w)
  const h = Math.min(oh - y, box.h)
  if (w <= 0 || h <= 0) return null

  const crop = document.createElement('canvas')
  crop.width = w
  crop.height = h
  const cctx = crop.getContext('2d')!
  const full = document.createElement('canvas')
  full.width = ow
  full.height = oh
  full.getContext('2d')!.putImageData(new ImageData(src.data, ow, oh), 0, 0)
  cctx.drawImage(full, x, y, w, h, 0, 0, w, h)

  // 高 = 48，宽按比例（≤320）
  const ratio = w / h
  let rw = Math.min(320, Math.max(1, Math.round(48 * ratio)))
  const rh = 48
  const rec = document.createElement('canvas')
  rec.width = rw
  rec.height = rh
  const rctx = rec.getContext('2d')!
  rctx.drawImage(crop, 0, 0, rw, rh)
  const rrgb = rctx.getImageData(0, 0, rw, rh).data

  const { tensor, shape } = preprocessCHW(rrgb, rh, rw)
  const input = new ort.Tensor('float32', tensor, shape)
  const out = await models!.rec.run({ [models!.rec.inputNames[0]]: input })
  // 输出 [1, T, C] 或 [T, C]
  const outData = out[models!.rec.outputNames[0]].data as Float32Array
  const dims = out[models!.rec.outputNames[0]].dims
  const T = dims[dims.length - 2]
  const C = dims[dims.length - 1]
  const stride = C

  let text = ''
  let scoreSum = 0
  let last = -1
  for (let t = 0; t < T; t++) {
    let best = 0
    let bestIdx = 0
    for (let c = 0; c < C; c++) {
      const v = outData[t * stride + c]
      if (v > best) { best = v; bestIdx = c }
    }
    if (bestIdx !== 0 && bestIdx !== last) {
      text += dict[bestIdx] || ''
      scoreSum += best
    }
    last = bestIdx
  }
  const score = T > 0 ? scoreSum / T : 0
  if (!text || score < scoreThresh) return null
  return { text, score }
}

// ---------------------------------------------------------------------------
// 对外入口：输入画布/图片，返回按阅读顺序的文本行
// ---------------------------------------------------------------------------
export async function recognize(
  source: HTMLCanvasElement | HTMLImageElement | ImageData,
  opts: OcrOptions = {}
): Promise<string[]> {
  await loadModels(opts)
  const img = getImageData(source)
  const boxes = await detect(img, opts.detLimitSideLen || 960)
  const lines: string[] = []
  for (const box of boxes) {
    const r = await recognizeBox(img, box, models!.dict, opts.recScoreThresh ?? 0.3)
    if (r) lines.push(r.text)
  }
  return lines
}

export async function recognizeFromCanvas(canvas: HTMLCanvasElement, opts: OcrOptions = {}): Promise<string[]> {
  return recognize(canvas, opts)
}
