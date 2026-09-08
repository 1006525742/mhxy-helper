// 慈心棋盘识别（纯前端 CV，无模型）—— 严格对齐 mhxyai.com CixinOthelloView 的识别流水线。
// 关键逻辑（逆向自其打包代码，已逐函数核对）：
//  - isWarm(r,g,b): r>90 && r>g*1.07 && g>b*1.08 && b<185  —— 仅用于【找棋盘外框】(候选区暖色角点占比>=0.42)
//  - 棋子分类 classifyCell: 纯【亮度】，与色相无关
//        黑子 = 圆盘环区暗像素(luma<90)占比>0.42，或平均亮度<92
//        白子 = 圆盘环区亮像素(luma>135 且方差<45)占比>0.38，或平均亮度>150 且方差<48
//        空   = 其余
//  - 宝箱检测 (boxes): 仅在空位上做
//        boxConfidence = clamp((lumaVar-122)/32, 0, 1)
//        >= 0.45 视为宝箱；返回 boxes（按 conf 降序，最多 3 个）
//  - 自动检测：缩放<=800 找框(暖色) → 在全分辨率原图上 buildBoard
//  - 手动框选：直接把用户矩形(原图坐标)送入 buildBoard，跳过找框
// 常量：BOARD=8, INSET=0.055, RESIZE_MAX_W=800, SOBEL_TH=110, WARM_TH=0.42, BOX_TH=0.45

export interface DetectedBoard {
  board: number[] // 长度 64，1=黑 / -1=白 / 0=空
  whiteMoves: number[]
  blackMoves: number[]
  boxes: number[] // 检测到的宝箱格 index（最多 3 个，按 boxConfidence 降序）
  counts: { black: number; white: number; empty: number; box: number }
  confidence: number
  isPlausible: boolean
  gridRect: { x: number; y: number; width: number; height: number } | null
}

const BOARD = 8
const INSET = 0.055
const RESIZE_MAX_W = 800
const SOBEL_TH = 110
const WARM_TH = 0.42
const BOX_TH = 0.45
const BOX_MAX = 3
const BOX_RED_TH = 0.02 // 宝箱红宝石像素占比阈值（铁证特征：木格/棋子/邻格误扫均为 0）

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** dataURL -> ImageData */
export function loadImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, img.width, img.height))
    }
    img.onerror = () => reject(new Error('图像解码失败'))
    img.src = dataUrl
  })
}

/** 暖色像素判定（梦幻界面暖色调）—— 仅用于找棋盘外框 */
function isWarm(r: number, g: number, b: number): boolean {
  return r > 90 && r > g * 1.07 && g > b * 1.08 && b < 185
}

/** 候选棋盘的暖色角点占比（8x8 每格四角采样），用于定位棋盘外框 */
function warmRatioAt(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  rect: { x: number; y: number; width: number; height: number }
): number {
  const i = rect.width * INSET
  const a = rect.height * INSET
  const o = rect.width - i * 2
  const s = rect.height - a * 2
  let c = 0
  let l = 0
  for (let u = 0; u < BOARD; u++) {
    for (let d = 0; d < BOARD; d++) {
      for (const [f, p] of [
        [0.12, 0.12],
        [0.88, 0.12],
        [0.12, 0.88],
        [0.88, 0.88]
      ] as Array<[number, number]>) {
        const m = Math.round(rect.x + i + (d + f) * (o / BOARD))
        const h = Math.round(rect.y + a + (u + p) * (s / BOARD))
        if (m < 0 || m >= W || h < 0 || h >= H) continue
        const g = (h * W + m) * 4
        if (isWarm(data[g], data[g + 1], data[g + 2])) c++
        l++
      }
    }
  }
  return l ? c / l : 0
}

/** 向内缩进 INSET，去掉外框留白 */
function insetRect(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: rect.x + rect.width * INSET,
    y: rect.y + rect.height * INSET,
    width: rect.width - rect.width * INSET * 2,
    height: rect.height - rect.height * INSET * 2
  }
}

/** Sobel 边缘，返回 0/1 边缘图 */
function sobel(data: Uint8ClampedArray, W: number, H: number): Uint8Array {
  const n = W * H
  const gray = new Uint8Array(n)
  const edge = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    gray[i] = Math.round(data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114)
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const r = y * W + x
      const o = gray[r - W - 1], s = gray[r - W], c = gray[r - W + 1]
      const l = gray[r - 1], u = gray[r + 1]
      const d = gray[r + W - 1], f = gray[r + W], p = gray[r + W + 1]
      const gx = -o - l * 2 - d + c + u * 2 + p
      const gy = -o - s * 2 - c + d + f * 2 + p
      if (Math.max(Math.abs(gx), Math.abs(gy)) > SOBEL_TH) edge[r] = 1
    }
  }
  return edge
}

interface Rect { x: number; y: number; width: number; height: number; edgeCount?: number }

/** 连通域 flood fill，筛选接近正方形的大色块（棋盘外框） */
function findRects(edges: Uint8Array, W: number, H: number): Rect[] {
  const visited = new Int32Array(W * H)
  const minSide = Math.max(100, Math.min(W, H) * 0.24)
  const maxSide = Math.min(W, H) * 0.93
  const rects: Rect[] = []
  for (let s = 0; s < edges.length; s++) {
    if (edges[s] !== 1 || visited[s]) continue
    const stack = [s]
    visited[s] = 1
    let minX = W, minY = H, maxX = 0, maxY = 0, count = 0
    while (stack.length) {
      const idx = stack.pop()!
      const y = Math.floor(idx / W)
      const x = idx % W
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const gx0 = Math.max(0, x - 1), gx1 = Math.min(W - 1, x + 1)
      const gy0 = Math.max(0, y - 1), gy1 = Math.min(H - 1, y + 1)
      for (let yy = gy0; yy <= gy1; yy++) {
        for (let xx = gx0; xx <= gx1; xx++) {
          const a = yy * W + xx
          if (edges[a] === 1 && !visited[a]) {
            visited[a] = 1
            stack.push(a)
          }
        }
      }
    }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const side = Math.min(w, h)
    const aspect = w / Math.max(1, h)
    if (
      side >= minSide && side <= maxSide &&
      aspect >= 0.74 && aspect <= 1.32 &&
      count >= side * 3 &&
      minX > 1 && minY > 1 && maxX < W - 2 && maxY < H - 2
    ) {
      rects.push({ x: minX, y: minY, width: w, height: h, edgeCount: count })
    }
  }
  return rects
}

interface Candidate { x: number; y: number; width: number; height: number; warmRatio: number }

/** 候选棋盘：在定位到的方块内，不同缩放/位置采样，按暖色角点占比评分（>=0.42 才算） */
function candidateSquares(
  rect: Rect,
  data: Uint8ClampedArray,
  W: number,
  H: number
): Candidate[] {
  const out: Candidate[] = []
  const side = Math.min(rect.width, rect.height)
  for (const scale of [1, 0.99, 0.97, 0.95]) {
    const s = side * scale
    const offX = rect.width - s
    const offY = rect.height - s
    const xs = offX < 1.5 ? [0.5] : [0, 0.5, 1]
    const ys = offY < 1.5 ? [0.5] : [0, 0.5, 1]
    for (const ay of ys) {
      for (const ax of xs) {
        const x = rect.x + offX * ax
        const y = rect.y + offY * ay
        const cand: Rect = { x: Math.round(x), y: Math.round(y), width: Math.round(s), height: Math.round(s) }
        const wr = warmRatioAt(data, W, H, cand)
        if (wr >= WARM_TH) out.push({ x: cand.x, y: cand.y, width: cand.width, height: cand.height, warmRatio: wr })
      }
    }
  }
  return out
}

/**
 * 单格分类（纯亮度，与界面色相无关）—— 对齐 mhxyai 的 P 函数：
 * 在距格心 0.13~0.35 倍格宽 的环形区采样，统计暗/亮像素占比判定黑/白/空。
 */
function classifyCell(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  cx: number,
  cy: number,
  cellW: number,
  cellH: number
): { value: number; confidence: number; boxConfidence: number; isBox: boolean } {
  const s = Math.min(cellW, cellH)
  const c0 = Math.max(0, Math.floor(cx - s * 0.38))
  const c1 = Math.min(W - 1, Math.ceil(cx + s * 0.38))
  const r0 = Math.max(0, Math.floor(cy - s * 0.38))
  const r1 = Math.min(H - 1, Math.ceil(cy + s * 0.38))
  let f = 0, pSum = 0, vSum = 0, lumaSqSum = 0, dark = 0, bright = 0, warm = 0, red = 0
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const dist = Math.hypot(x - cx, y - cy) / s
      if (dist < 0.13 || dist > 0.35) continue
      const o = (y * W + x) * 4
      const r = data[o], g = data[o + 1], b = data[o + 2]
      const variance = Math.max(r, g, b) - Math.min(r, g, b)
      const luma = r * 0.299 + g * 0.587 + b * 0.114
      pSum += luma
      vSum += variance
      lumaSqSum += luma * luma
      if (luma < 90) dark++
      if (luma > 135 && variance < 45) bright++
      if (isWarm(r, g, b)) warm++
      // 红宝石像素（宝箱图标铁证特征：高饱和红，木格/棋子/邻格误扫均无）
      if (r > 160 && g < 110 && b < 110 && r - b > 60) red++
      f++
    }
  }
  if (!f) return { value: 0, confidence: 0, boxConfidence: 0, isBox: false }
  const v = pSum / f
  const y = vSum / f
  // luma 方差：宝箱图标高方差，普通木格低方差。E[x²] - (E[x])² 即采样区 luma 方差
  const lumaVar = Math.max(0, lumaSqSum / f - v * v)
  const bFrac = dark / f
  const xFrac = bright / f
  const wFrac = warm / f
  // mhxyai boxConfidence = clamp((y-122)/32, 0, 1)，y 取 luma 方差，实机校验：宝箱 ~980 / 普通木格 ~1.9-60
  const boxConfidence = clamp((lumaVar - 122) / 32, 0, 1)
  const redRatio = red / f
  // 宝箱判定【前置】：
  //  1) 高 luma 方差 + 含红宝石（铁证）—— 前置可避免宝箱黑描边被误判黑子而漏检；
  //  2) 红宝石特征可排除"棋盘对齐偏移时邻格扫到宝箱边缘"造成的方差误判。
  //     实机校验：真宝箱 red≈0.07~0.30；木格/棋子/误扫邻格 red=0，阈值留足余量。
  const isBox = boxConfidence >= BOX_TH && redRatio >= BOX_RED_TH
  if (isBox) {
    return { value: 0, confidence: clamp(redRatio * 4, 0, 1), boxConfidence, isBox: true }
  }
  if (bFrac > 0.42 || v < 92) {
    return { value: 1, confidence: clamp(Math.max(bFrac, (105 - v) / 70), 0, 1), boxConfidence: 0, isBox: false }
  }
  if (xFrac > 0.38 || (v > 150 && y < 48)) {
    return { value: -1, confidence: clamp(Math.max(xFrac, (v - 125) / 70), 0, 1), boxConfidence: 0, isBox: false }
  }
  return { value: 0, confidence: clamp(Math.max(wFrac, v / 100), 0, 1), boxConfidence: 0, isBox: false }
}

const DIRS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
]

function flipsFor(board: number[], idx: number, player: number): number[] {
  if (board[idx] !== 0) return []
  const row = Math.floor(idx / 8)
  const col = idx % 8
  const opp = -player
  const res: number[] = []
  for (const [dr, dc] of DIRS) {
    let r = row + dr
    let c = col + dc
    const line: number[] = []
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const v = board[r * 8 + c]
      if (v === opp) line.push(r * 8 + c)
      else if (v === player) {
        if (line.length) res.push(...line)
        break
      } else break
      r += dr
      c += dc
    }
  }
  return res
}

export function legalMoves(board: number[], player: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 64; i++) {
    if (flipsFor(board, i, player).length) out.push(i)
  }
  return out
}

/** 由定位到的棋盘矩形构建 8x8 局面（对齐 mhxyai 的 F 函数） */
function buildBoard(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  rect: { x: number; y: number; width: number; height: number }
): DetectedBoard {
  const cellW = rect.width / BOARD
  const cellH = rect.height / BOARD
  const board: number[] = []
  // boxCandidates: { idx, conf }，收集空位且 boxConfidence 高的格，按 conf 降序取前 3
  const boxCandidates: Array<{ idx: number; conf: number }> = []
  let confSum = 0
  for (let row = 0; row < BOARD; row++) {
    for (let col = 0; col < BOARD; col++) {
      const cx = rect.x + (col + 0.5) * cellW
      const cy = rect.y + (row + 0.5) * cellH
      const cl = classifyCell(data, W, H, cx, cy, cellW, cellH)
      const idx = row * 8 + col
      board.push(cl.value)
      confSum += cl.confidence
      // 宝箱：classifyCell 已前置判定（高方差 + 红宝石铁证），不依赖空位/黑子判定
      if (cl.isBox) {
        boxCandidates.push({ idx, conf: cl.boxConfidence })
      }
    }
  }
  boxCandidates.sort((a, b) => b.conf - a.conf)
  const boxes = boxCandidates.slice(0, BOX_MAX).map((b) => b.idx)
  const black = board.filter((v) => v === 1).length
  const white = board.filter((v) => v === -1).length
  const empty = board.length - black - white
  const whiteMoves = legalMoves(board, -1)
  const blackMoves = legalMoves(board, 1)
  const isPlausible =
    black > 0 && white > 0 && black + white >= 4 &&
    (whiteMoves.length > 0 || blackMoves.length > 0 || empty === 0)
  return {
    board,
    whiteMoves,
    blackMoves,
    boxes,
    counts: { black, white, empty, box: boxes.length },
    confidence: confSum / board.length,
    isPlausible,
    gridRect: { ...rect }
  }
}

/** 顶层：从 ImageData 自动识别棋盘（缩放<=800 找框，全分辨率建盘） */
export function detectBoard(image: ImageData): DetectedBoard | null {
  const W = image.width
  const H = image.height
  if (!W || !H) return null
  const scale = Math.min(1, RESIZE_MAX_W / W)
  const n = Math.max(1, Math.round(W * scale))
  const r = Math.max(1, Math.round(H * scale))
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  src.getContext('2d')!.putImageData(image, 0, 0)
  const small = document.createElement('canvas')
  small.width = n
  small.height = r
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(src, 0, 0, n, r)
  const smallData = sctx.getImageData(0, 0, n, r)
  const edges = sobel(smallData.data, n, r)
  const rects = findRects(edges, n, r)
  const candidates = rects
    .flatMap((rect) => candidateSquares(rect, smallData.data, n, r))
    .sort((a, b) => b.warmRatio - a.warmRatio)
    .slice(0, 12)
  const full = image.data
  const results: Array<DetectedBoard & { score: number }> = []
  for (const cand of candidates) {
    const mapped = {
      x: cand.x / scale,
      y: cand.y / scale,
      width: cand.width / scale,
      height: cand.height / scale
    }
    const ins = insetRect(mapped)
    const det = buildBoard(full, W, H, ins)
    if (!det.isPlausible) continue
    const total = det.counts.black + det.counts.white
    const score = cand.warmRatio * 3 + det.confidence * 1.5 + Math.min(1, total / 20)
    results.push({ ...det, score })
  }
  if (!results.length) return null
  results.sort((a, b) => b.score - a.score)
  return results[0]
}

/**
 * 手动框选识别：用户拖出 8×8 棋盘矩形（原图像素坐标），跳过自动找框，
 * 直接把矩形均分 8×8 后逐格分类。对齐 mhxyai 的 Ce（手动校准直接建盘，不内缩）。
 */
export function detectBoardManual(
  image: ImageData,
  rect: { x: number; y: number; width: number; height: number }
): DetectedBoard | null {
  const W = image.width
  const H = image.height
  if (!W || !H || !rect?.width || !rect?.height) return null
  return buildBoard(image.data, W, H, rect)
}
