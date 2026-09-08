/**
 * 宝图坐标 OCR —— 复用项目自有的 RapidOCR 后端（PP-OCRv6 SMALL）
 *
 * 说明：
 * - 原来用浏览器端 tesseract.js，对梦幻西游位图字体识别差，已废弃。
 * - 现改为：裁剪藏宝图2 区域 → PNG → POST /api/fentu/capture
 *   → 后端 RapidOCR 识别，返回游戏内坐标 (x, y)。
 * - 该引擎与原站 /api/WatuOCR 同源（均为 PP-OCR 系列），且是项目抓鬼
 *   (/api/ghost/capture) 正在用的同一套服务，离线、精度更高。
 * - dev 环境下 /api/fentu 由 Vite proxy 兜底转发到 ghost 后端(8000)。
 */

const OCR_ENDPOINT = '/api/fentu/capture'

export interface CoordBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** OCR 返回结果（含裁剪预览图，便于页面核对截取是否正确） */
export interface BaotuOcrResult {
  /** 发给后端的裁剪图（base64 PNG），即「截图部分」 */
  cropDataUrl: string
  /** 识别到的游戏内坐标，识别失败为 null */
  coord: { x: number; y: number } | null
  /** 识别到的地图名（如「女儿村」），识别失败为 null */
  map: string | null
}

/**
 * 识别藏宝图2 框区域内的游戏内坐标
 * @param full 整屏 ImageData（坐标系统与 box 一致）
 * @param box 藏宝图2 检测框（原始屏幕坐标）
 * @returns { cropDataUrl, coord } 裁剪预览图 + 坐标（coord 为 null 表示 OCR 未识别到）
 */
export async function recognizeBaotuCoord(
  full: ImageData,
  box: CoordBox
): Promise<BaotuOcrResult> {
  const bw = box.x2 - box.x1
  const bh = box.y2 - box.y1
  if (bw <= 0 || bh <= 0) return { cropDataUrl: '', coord: null, map: null }

  // 对齐原站 fentuLogic「藏宝图2 截图」函数：坐标文字在图标右下方，
  // 故从框右缘起向右扩 ~2.65×框宽，向下从框中点取半框高，再放大2倍+白边
  const sw = Math.max(125, Math.ceil(bw * 2.65))          // 源宽（≥125）
  const sh = Math.ceil(bh / 2)                            // 源高 = 半框高
  const sx = Math.max(0, Math.floor(box.x1 + bw))         // 框右边缘为起点
  const sy = Math.max(0, Math.floor(box.y1 + bh / 2 - 1)) // 框中点偏上

  // 源区域越界则 clamp（原站直接用整图 drawImage，越界部分自然留白）
  const cx0 = Math.min(sx, full.width)
  const cy0 = Math.min(sy, full.height)
  const cw = Math.max(1, Math.min(sw, full.width - cx0))
  const ch = Math.max(1, Math.min(sh, full.height - cy0))
  if (cw <= 0 || ch <= 0) return { cropDataUrl: '', coord: null, map: null }

  // 从整屏 ImageData 取子区域 → 临时 canvas（源裁剪图）
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

  // 放大 2 倍 + 上下各 10px 白边（对齐原站）
  const outCanvas = document.createElement('canvas')
  outCanvas.width = sw * 2
  outCanvas.height = sh * 2 + 20
  const octx = outCanvas.getContext('2d')
  if (!octx) return { cropDataUrl: '', coord: null, map: null }
  octx.fillStyle = '#FFFFFF'
  octx.fillRect(0, 0, outCanvas.width, outCanvas.height)
  octx.imageSmoothingEnabled = false
  octx.drawImage(srcCanvas, 0, 10, sw * 2, sh * 2)

  const dataUrl = outCanvas.toDataURL('image/png')

  try {
    const resp = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    })
    if (!resp.ok) {
      console.error('[fentuOcr] 后端返回状态', resp.status)
      return { cropDataUrl: dataUrl, coord: null, map: null }
    }
    const json = await resp.json()
    // 地图名：成功时在顶层 map，未识别到坐标时回退到 ocr.map
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
    console.error('[fentuOcr] OCR 请求失败:', e)
    return { cropDataUrl: dataUrl, coord: null, map: null }
  }
}
