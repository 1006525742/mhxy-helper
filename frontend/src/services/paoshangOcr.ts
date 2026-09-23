/**
 * 跑商助手 · 价格识别
 *
 * 复用科举 OCR 后端的通用端点 /api/ocr/general（PP-OCRv6）。
 * 流程：YOLO 定位「单价」框 → 裁剪该区域 → 放大+白边 → 后端识数字 → 前端清洗。
 *
 * dev 环境下 /api/ocr 由 Vite proxy 转发到 8001 后端。
 */

const OCR_ENDPOINT = '/api/ocr/general'

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * 把画布上的一块区域裁剪出来，放大并加白边，转成 base64 PNG。
 * 游戏内价格字号较小，放大 3 倍能明显提升识别率。
 */
export function cropRegion(
  source: HTMLCanvasElement | HTMLVideoElement,
  box: Box,
  scale = 3
): string | null {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height
  if (!sw || !sh) return null

  const bw = box.x2 - box.x1
  const bh = box.y2 - box.y1
  if (bw <= 0 || bh <= 0) return null

  const sx = Math.max(0, Math.floor(box.x1))
  const sy = Math.max(0, Math.floor(box.y1))
  const cw = Math.max(1, Math.min(Math.ceil(bw), sw - sx))
  const ch = Math.max(1, Math.min(Math.ceil(bh), sh - sy))

  const src = document.createElement('canvas')
  src.width = cw
  src.height = ch
  const sctx = src.getContext('2d')
  if (!sctx) return null
  sctx.drawImage(source, sx, sy, cw, ch, 0, 0, cw, ch)

  // 放大 + 四周白边（OCR 对贴边文字识别差）
  const pad = 8
  const out = document.createElement('canvas')
  out.width = cw * scale + pad * 2
  out.height = ch * scale + pad * 2
  const octx = out.getContext('2d')
  if (!octx) return null
  octx.fillStyle = '#FFFFFF'
  octx.fillRect(0, 0, out.width, out.height)
  octx.imageSmoothingEnabled = false
  octx.drawImage(src, pad, pad, cw * scale, ch * scale)

  return out.toDataURL('image/png')
}

/**
 * 识别单价框内的数字
 * @returns 识别到的价格，失败返回 0
 */
export async function recognizePrice(
  source: HTMLCanvasElement | HTMLVideoElement,
  box: Box
): Promise<number> {
  const dataUrl = cropRegion(source, box)
  if (!dataUrl) return 0

  try {
    const blob = await (await fetch(dataUrl)).blob()
    const form = new FormData()
    form.append('img', blob, 'price.png')

    const resp = await fetch(OCR_ENDPOINT, { method: 'POST', body: form })
    if (!resp.ok) {
      console.error('[paoshangOcr] 后端返回状态', resp.status)
      return 0
    }
    const json = await resp.json()
    const text: string = json?.text || ''
    return parseDigits(text)
  } catch (e) {
    console.error('[paoshangOcr] 识别请求失败:', e)
    return 0
  }
}

/**
 * 从 OCR 文本中提取价格数字。
 * 游戏价格是纯数字，OCR 可能混入空格或「两」「银」等字，只保留连续数字段。
 */
export function parseDigits(text: string): number {
  if (!text) return 0
  const matches = text.replace(/[^\d]/g, '')
  if (!matches) return 0
  const n = Number(matches)
  if (Number.isNaN(n)) return 0
  return n
}
