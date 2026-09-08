/**
 * 挖图助手 OCR —— 独立后端端点 /api/watu/capture
 *
 * 说明：
 * - 后端使用挖图专属 16 张地图名清单，排除宝象国/长寿村等非挖图地图
 * - 与 fentuOcr 结构一致，但使用独立端点，便于分别维护
 * - 复用项目自有的 RapidOCR 后端（PP-OCRv6 SMALL）
 * - dev 环境下 /api/watu 由 Vite proxy 转发到 baotu 后端(8002)
 */

const OCR_ENDPOINT = '/api/watu/capture'

export interface CoordBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** OCR 返回结果（含裁剪预览图，便于页面核对截取是否正确） */
export interface WatuOcrResult {
  /** 发给后端的裁剪图（base64 PNG），即"截图部分" */
  cropDataUrl: string
  /** 识别到的游戏内坐标，识别失败为 null */
  coord: { x: number; y: number } | null
  /** 识别到的地图名（如"女儿村"），识别失败为 null */
  map: string | null
}

/**
 * 识别藏宝图2 框区域内的游戏内坐标
 * @param full 整屏 ImageData（坐标系统与 box 一致）
 * @param box 藏宝图2 检测框（原始屏幕坐标）
 * @returns { cropDataUrl, coord, map } 裁剪预览图 + 坐标 + 地图名
 */
export async function recognizeWatuCoord(
  full: ImageData,
  box: CoordBox
): Promise<WatuOcrResult> {
  const bw = box.x2 - box.x1
  const bh = box.y2 - box.y1
  if (bw <= 0 || bh <= 0) return { cropDataUrl: '', coord: null, map: null }

  // 从框右缘起向右扩 ~2.65×框宽，向下从框中点取半框高，再放大2倍+白边
  const sw = Math.max(125, Math.ceil(bw * 2.65))
  const sh = Math.ceil(bh / 2) + 2
  const sx = Math.max(0, Math.floor(box.x1 + bw) - 12)
  const sy = Math.max(0, Math.floor(box.y1 + bh / 2 - 1))

  // 源区域越界则 clamp
  const cx0 = Math.min(sx, full.width)
  const cy0 = Math.min(sy, full.height)
  const cw = Math.max(1, Math.min(sw, full.width - cx0))
  const ch = Math.max(1, Math.min(sh, full.height - cy0))
  if (cw <= 0 || ch <= 0) return { cropDataUrl: '', coord: null, map: null }

  // 从整屏 ImageData 取子区域 → 临时 canvas
  const region = new Uint8ClampedArray(cw * ch * 4)
  for (let row = 0; row < ch; row++) {
    const srcStart = ((cy0 + row) * full.width + cx0) * 4
    region.set(full.data.subarray(srcStart, srcStart + cw * 4), row * cw * 4)
  }
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = cw
  srcCanvas.height = ch
  const sctx = srcCanvas.getContext('2d')
  if (!sctx) return { cropDataUrl: '', coord: null, map: null }
  sctx.putImageData(new ImageData(region, cw, ch), 0, 0)

  // 放大 2 倍 + 上白边 10px + 下白边 12px
  const outCanvas = document.createElement('canvas')
  outCanvas.width = sw * 2
  outCanvas.height = sh * 2 + 22
  const octx = outCanvas.getContext('2d')
  if (!octx) return { cropDataUrl: '', coord: null, map: null }
  octx.fillStyle = '#FFFFFF'
  octx.fillRect(0, 0, outCanvas.width, outCanvas.height)
  octx.imageSmoothingEnabled = false
  octx.drawImage(srcCanvas, 0, 10, sw * 2, sh * 2)

  // 说明：颜色反转 / 对比度增强等 OCR 预处理已统一放到后端
  // (backend/services/rapidocr_recognizer.py) 的兜底逻辑中处理，
  // 前端只负责裁剪 + 2× 上采样，避免双重处理导致配色错乱。
  const dataUrl = outCanvas.toDataURL('image/png')

  try {
    const resp = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    })
    if (!resp.ok) {
      console.error('[watuOcr] 后端返回状态', resp.status)
      return { cropDataUrl: dataUrl, coord: null, map: null }
    }
    const json = await resp.json()
    const mapName =
      (typeof json?.map === 'string' && json.map) ||
      (json?.ocr && typeof json.ocr.map === 'string' && json.ocr.map) ||
      null
    if (
      json &&
      json.success &&
      typeof json.x === 'number' &&
      typeof json.y === 'number' &&
      json.x &&
      json.y
    ) {
      return { cropDataUrl: dataUrl, coord: { x: json.x, y: json.y }, map: mapName }
    }
    return { cropDataUrl: dataUrl, coord: null, map: mapName }
  } catch (e) {
    console.error('[watuOcr] OCR 请求失败:', e)
    return { cropDataUrl: dataUrl, coord: null, map: null }
  }
}
