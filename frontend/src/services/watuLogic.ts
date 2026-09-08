/**
 * 挖图助手业务逻辑
 *
 * 从 mhxyai.com/v2/watu 逆向还原，适配本项目 TS。
 *
 * 设计原则（用户确认）：
 *   - 不做"可不可走"判定。所有挖图地图均视为全陆地可通行，
 *     与抓鬼模块思路一致（只预测/标注位置，不绕障碍寻路）。
 *   - 路径规划 = 预测路线：按游戏坐标在可视化图上直接画
 *     "出发点 → 宝图目标点" 的直线路线，并标出起/终点。
 *
 * 坐标系（用户确认）：
 *   游戏原点在地图图片【左下角】，每图有独立游戏坐标上限 (maxX, maxY)，
 *   按图片尺寸归一化，且图片 Y 轴向下，故 Y 需要翻转：
 *     px = x / maxX * imgW
 *     py = imgH - y / maxY * imgH
 */

import {
  getMapDefaultColor,
  type GridCell
} from './fentuLogic'

/** 地图数据 */
export interface WatuMapData {
  /** 地图名 */
  name: string
  /** 玩家出发点 [x, y]（游戏坐标，非像素） */
  start: [number, number] | [number, number][]
  /** 游戏坐标 x 最大值（用于游戏坐标 → 图片像素映射） */
  maxX: number
  /** 游戏坐标 y 最大值 */
  maxY: number
  /** 可视化图（jpg，用于展示与画路线） */
  visualImgPath: string
}

/**
 * 16 张挖图地图数据
 * 起点坐标为游戏坐标；maxX/maxY 为游戏坐标真实最大值（用户提供）。
 */
export const WATU_MAPS: Record<string, WatuMapData> = {
  东海湾: { name: '东海湾', start: [85, 23], maxX: 119, maxY: 119, visualImgPath: '/watu-assets/东海湾.jpg' },
  五庄观: { name: '五庄观', start: [9, 7], maxX: 100, maxY: 75, visualImgPath: '/watu-assets/五庄观.jpg' },
  傲来国: { name: '傲来国', start: [116, 98], maxX: 224, maxY: 150, visualImgPath: '/watu-assets/傲来国.jpg' },
  北俱芦洲: { name: '北俱芦洲', start: [186, 105], maxX: 227, maxY: 169, visualImgPath: '/watu-assets/北俱芦洲.jpg' },
  墨家村: { name: '墨家村', start: [79, 2], maxX: 95, maxY: 167, visualImgPath: '/watu-assets/墨家村.jpg' },
  大唐国境: { name: '大唐国境', start: [[337, 146], [90, 260]], maxX: 351, maxY: 335, visualImgPath: '/watu-assets/大唐国境.jpg' },
  大唐境外: { name: '大唐境外', start: [14, 55], maxX: 640, maxY: 120, visualImgPath: '/watu-assets/大唐境外.jpg' },
  狮驼岭: { name: '狮驼岭', start: [118, 90], maxX: 131, maxY: 98, visualImgPath: '/watu-assets/狮驼岭.jpg' },
  女儿村: { name: '女儿村', start: [119, 12], maxX: 130, maxY: 144, visualImgPath: '/watu-assets/女儿村.jpg' },
  建邺城: { name: '建邺城', start: [65, 30], maxX: 288, maxY: 144, visualImgPath: '/watu-assets/建邺城.jpg' },
  普陀山: { name: '普陀山', start: [87, 4], maxX: 95, maxY: 72, visualImgPath: '/watu-assets/普陀山.jpg' },
  朱紫国: { name: '朱紫国', start: [140, 93], maxX: 191, maxY: 120, visualImgPath: '/watu-assets/朱紫国.jpg' },
  麒麟山: { name: '麒麟山', start: [179, 3], maxX: 190, maxY: 143, visualImgPath: '/watu-assets/麒麟山.jpg' },
  花果山: { name: '花果山', start: [10, 10], maxX: 159, maxY: 119, visualImgPath: '/watu-assets/花果山.jpg' },
  江南野外: { name: '江南野外', start: [22, 107], maxX: 160, maxY: 120, visualImgPath: '/watu-assets/江南野外.jpg' },
  长寿郊外: { name: '长寿郊外', start: [156, 159], maxX: 191, maxY: 167, visualImgPath: '/watu-assets/长寿郊外.jpg' }
}

/** 路径规划单步结果 */
export interface PathStep {
  /** 地图名 */
  mapName: string
  /** 目标 x 坐标（游戏内） */
  x: number
  /** 目标 y 坐标（游戏内） */
  y: number
  /** 物品栏格位（1~20） */
  cell: number
  /** 序号（同地图多张宝图的挖图顺序） */
  seq?: string
  /** 是否可达（此处固定为 true：全陆地，无不可达） */
  reachable: boolean
}

/** 路径规划总结果 */
export interface PlanResult {
  /** 有效（可达）路径步骤 */
  validSteps: PathStep[]
  /** 结果 HTML（用于列表展示） */
  resultHtml: string
}

/** 图片缓存：避免重复加载同一张地图 */
const imageCache = new Map<string, HTMLImageElement>()

/**
 * 加载地图图片（带缓存）
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached && cached.complete) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageCache.set(src, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`))
    img.src = src
  })
}

/**
 * 游戏坐标 → 图片像素坐标
 *
 * 映射规则（用户确认）：游戏原点在地图图片【左下角】，
 * 每图有独立的游戏坐标上限 (maxX, maxY)，按图片尺寸归一化，
 * 且图片 Y 轴向下，故 Y 需要翻转。
 *
 *   px = x / maxX * imgW
 *   py = imgH - y / maxY * imgH
 *
 * @param x 游戏坐标 x
 * @param y 游戏坐标 y
 * @param imgW 图片像素宽
 * @param imgH 图片像素高
 * @param maxX 游戏坐标 x 最大值
 * @param maxY 游戏坐标 y 最大值
 */
function gameToPixel(
  x: number,
  y: number,
  imgW: number,
  imgH: number,
  maxX: number,
  maxY: number
): [number, number] {
  const mx = maxX > 0 ? maxX : 1
  const my = maxY > 0 ? maxY : 1
  const px = (x / mx) * imgW
  const py = imgH - (y / my) * imgH
  return [px, py]
}

/**
 * 归一化起点：兼容单起点 [x, y] 与多起点 [[x, y], [x, y], ...]
 */
function getStarts(map: WatuMapData): [number, number][] {
  return Array.isArray((map.start as any)[0])
    ? (map.start as [number, number][])
    : [map.start as [number, number]]
}

/**
 * 在多个起点中取「距离目标点 (x, y) 最近」的那个，返回其下标。
 * 用于单张宝图：从离该挖点最近的传送点出发。
 */
function nearestStartIndex(starts: [number, number][], x: number, y: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < starts.length; i++) {
    const d = Math.hypot(starts[i][0] - x, starts[i][1] - y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * 最近邻巡回路线总长：从 start 出发，每次走到最近的未访问挖点，直到走完。
 * 用于比较多个起点谁当路线起点总路程最短。
 */
function nnRouteLength(start: [number, number], digs: Array<{ x: number; y: number }>): number {
  let cur: [number, number] = [start[0], start[1]]
  const remaining = digs.slice()
  let total = 0
  while (remaining.length) {
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].x - cur[0], remaining[i].y - cur[1])
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    total += bd
    cur = [remaining[bi].x, remaining[bi].y]
    remaining.splice(bi, 1)
  }
  return total
}

/**
 * 从多个起点中选「距离所有挖点最近」的那个作为路线起点（下标）。
 * 规则：对每个候选起点算出「走完所有挖点的最近邻总路程」，取总路程最短者。
 */
function chooseStartIndex(starts: [number, number][], digs: Array<{ x: number; y: number }>): number {
  if (starts.length <= 1) return 0
  let best = 0
  let bestLen = Infinity
  for (let i = 0; i < starts.length; i++) {
    const len = nnRouteLength(starts[i], digs)
    if (len < bestLen) {
      bestLen = len
      best = i
    }
  }
  return best
}

/**
 * 最近邻访问顺序：从 start 出发，反复走到最近的未访问挖点，
 * 返回按规划顺序排好的挖点列表（坐标对象）。用于画连续巡回路线。
 */
function nnOrder<T extends { x: number; y: number }>(
  start: [number, number],
  digs: T[]
): T[] {
  let cur: [number, number] = [start[0], start[1]]
  const remaining = digs.slice()
  const order: T[] = []
  while (remaining.length) {
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].x - cur[0], remaining[i].y - cur[1])
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    order.push(remaining[bi])
    cur = [remaining[bi].x, remaining[bi].y]
    remaining.splice(bi, 1)
  }
  return order
}

/**
 * 挖图顺序结果（与地图可视化「挖1/挖2/挖3」严格一致）
 */
export interface DigOrderResult {
  /** 路线起点（游戏坐标，多起点时已选最优） */
  start: [number, number]
  /** 被选中的起点下标 */
  chosenIdx: number
  /** 按最近邻巡回排好的挖点（含 cell 与 1-based order） */
  ordered: Array<{ order: number; cell: number; x: number; y: number }>
}

/**
 * 计算某地图各挖点的「挖图顺序」，与 drawPathOverview 画的「挖1/挖2/挖3」完全一致。
 * 多起点选「最近邻总路程最短」的起点；从该起点出发按最近邻连续巡回。
 * 返回每个 cell 对应的 order，供物品栏蒙版数字使用，确保两边序号对齐。
 */
export function getDigOrder(
  mapName: string,
  steps: PathStep[]
): DigOrderResult | null {
  const mapData = WATU_MAPS[mapName]
  if (!mapData || steps.length === 0) return null
  const digs = steps.map((s) => ({ cell: s.cell, x: s.x, y: s.y }))
  const starts = getStarts(mapData)
  const chosenIdx = chooseStartIndex(starts, digs)
  const start = starts[chosenIdx]
  const ordered = nnOrder(start, digs).map((d, i) => ({
    order: i + 1,
    cell: d.cell,
    x: d.x,
    y: d.y
  }))
  return { start, chosenIdx, ordered }
}

/**
 * 在可视化图上绘制"起点 → 目标"预测路线
 *
 * 不做可通行判定（全陆地可走），直接按游戏坐标在底图上画一条直线，
 * 并标注起点（绿）与目标点（红）。
 *
 * @param canvas 目标 canvas（已设置好尺寸）
 * @param mapName 地图名
 * @param x 目标点游戏坐标 x
 * @param y 目标点游戏坐标 y
 */
/**
 * 画一条黄色导航线 + 沿途多个箭头（指向行进方向）
 * @param ctx   画布上下文
 * @param pts   途径点（像素坐标，按顺序连接）
 * @param color 线 / 箭头颜色（默认黄色）
 */
function drawNavArrows(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  color = '#FFD400'
): void {
  if (pts.length < 2) return

  // 1) 黄色虚线（不连贯、弱化存在感，箭头保留实色指示方向）
  ctx.save()
  ctx.globalAlpha = 0.7
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.setLineDash([7, 9])
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.stroke()
  ctx.restore()

  // 2) 沿途箭头：按路径累计长度均匀放置
  const arrowGap = 72 // 箭头间隔（px）
  const arrowSize = 13 // 箭头大小
  const segLen: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    segLen.push(d)
    total += d
  }
  if (total <= 0) return
  let target = arrowGap / 2
  let segIdx = 0
  let acc = 0
  while (target < total) {
    while (segIdx < segLen.length && acc + segLen[segIdx] < target) {
      acc += segLen[segIdx]
      segIdx++
    }
    if (segIdx >= segLen.length) break
    const t = (target - acc) / (segLen[segIdx] || 1)
    const x = pts[segIdx][0] + (pts[segIdx + 1][0] - pts[segIdx][0]) * t
    const y = pts[segIdx][1] + (pts[segIdx + 1][1] - pts[segIdx][1]) * t
    const ang = Math.atan2(
      pts[segIdx + 1][1] - pts[segIdx][1],
      pts[segIdx + 1][0] - pts[segIdx][0]
    )
    // 箭头三角
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(arrowSize, 0)
    ctx.lineTo(-arrowSize * 0.7, -arrowSize * 0.7)
    ctx.lineTo(-arrowSize * 0.7, arrowSize * 0.7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    target += arrowGap
  }
}

export async function drawPathOnMap(
  canvas: HTMLCanvasElement,
  mapName: string,
  x: number,
  y: number
): Promise<void> {
  const mapData = WATU_MAPS[mapName]
  if (!mapData) return

  try {
    const jImg = await loadImage(mapData.visualImgPath)
    const jW = jImg.naturalWidth || jImg.width
    const jH = jImg.naturalHeight || jImg.height
    if (!jW || !jH) return

    // 藏宝图标记图标（用于挖掘目标点）
    let markerImg: HTMLImageElement | null = null
    try {
      markerImg = await loadImage('/watu-assets/marker.png')
    } catch (e) {
      console.warn('[watuLogic] 藏宝图标记加载失败，回退圆圈:', e)
    }

    canvas.width = jW
    canvas.height = jH
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 绘制底图
    ctx.drawImage(jImg, 0, 0)

    // 多起点时，取距离该挖点最近的传送点作为出发点
    const starts = getStarts(mapData)
    const sIdx = nearestStartIndex(starts, x, y)
    const [sGx, sGy] = starts[sIdx]
    // 起点 / 目标点：游戏坐标 → jpg 像素
    const [sJx, sJy] = gameToPixel(sGx, sGy, jW, jH, mapData.maxX, mapData.maxY)
    const [tJx, tJy] = gameToPixel(x, y, jW, jH, mapData.maxX, mapData.maxY)

    // 预测路线：起点 → 目标，黄色箭头导航线
    drawNavArrows(ctx, [
      [sJx, sJy],
      [tJx, tJy]
    ])

    // 起点标记（绿色大圆圈 + 文字，醒目）
    const startR = Math.max(11, Math.min(jW, jH) * 0.03)
    ctx.strokeStyle = '#00E676'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(sJx, sJy, startR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(0, 230, 118, 0.4)'
    ctx.fill()
    ctx.fillStyle = '#00E676'
    ctx.font = `bold ${Math.round(startR * 1.1)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('起', sJx, sJy)
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'

    // 目标点标记：藏宝图图标（带黄色光晕）
    const baseSize = Math.min(48, Math.max(32, Math.min(jW, jH) * 0.08))
    const mw = markerImg ? baseSize * (markerImg.naturalWidth / markerImg.naturalHeight) : 0
    const mh = markerImg ? baseSize : 0
    // 黄色光晕描边，确保图标在任意底色上都醒目
    ctx.beginPath()
    ctx.arc(tJx, tJy, mh * 0.62, 0, Math.PI * 2)
    ctx.lineWidth = 4
    ctx.strokeStyle = '#FFEB3B'
    ctx.stroke()
    if (markerImg && markerImg.complete) {
      ctx.drawImage(markerImg, tJx - mw / 2, tJy - mh / 2, mw, mh)
    } else {
      // 图标加载失败回退：红色圆圈 + 文字
      ctx.strokeStyle = '#FF1744'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(tJx, tJy, 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255, 23, 68, 0.4)'
      ctx.fill()
    }
    // "挖" 文字标签放在图标下方
    ctx.fillStyle = '#FFEB3B'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('挖', tJx, tJy + mh * 0.62 + 4)
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'

    // 坐标标注（游戏坐标）
    ctx.fillStyle = '#FFF'
    ctx.font = 'bold 12px sans-serif'
    const label = `(${x}, ${y})`
    const tw = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(tJx + 12, tJy - 8, tw + 8, 18)
    ctx.fillStyle = '#FFEB3B'
    ctx.fillText(label, tJx + 16, tJy + 5)
  } catch (e) {
    console.error(`[watuLogic] 绘制路线失败 ${mapName}:`, e)
  }
}

/**
 * 在可视化图上绘制「同图多挖点总览」
 *
 * 把同一地图的多个宝图全部标在同一张图上：每个挖点用藏宝图图标 + "挖N"标签，
 * 并从出发点按顺序连线（起点 → 挖1 → 挖2 → …）形成巡回路线。
 *
 * @param canvas 目标 canvas
 * @param mapName 地图名
 * @param steps 该地图的全部宝图步骤（按挖图顺序）
 */
export async function drawPathOverview(
  canvas: HTMLCanvasElement,
  mapName: string,
  steps: PathStep[]
): Promise<void> {
  const mapData = WATU_MAPS[mapName]
  if (!mapData || steps.length === 0) return

  try {
    const jImg = await loadImage(mapData.visualImgPath)
    const jW = jImg.naturalWidth || jImg.width
    const jH = jImg.naturalHeight || jImg.height
    if (!jW || !jH) return

    canvas.width = jW
    canvas.height = jH
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(jImg, 0, 0)

    // 多起点：列出所有传送点（绿圈 + 起），并选「距离所有挖点最近」的那个作为路线起点
    const starts = getStarts(mapData)
    const orderInfo = getDigOrder(mapName, steps)
    if (!orderInfo) return
    const chosenIdx = orderInfo.chosenIdx
    const [sGx, sGy] = orderInfo.start
    const startR = Math.max(11, Math.min(jW, jH) * 0.03)

    starts.forEach(([gx, gy], idx) => {
      const [jx, jy] = gameToPixel(gx, gy, jW, jH, mapData.maxX, mapData.maxY)
      ctx.strokeStyle = '#00E676'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(jx, jy, startR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0, 230, 118, 0.4)'
      ctx.fill()
      if (idx === chosenIdx) {
        // 黄色高亮环：标记路线真正从此点出发
        ctx.strokeStyle = '#FFD400'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(jx, jy, startR + 5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.fillStyle = '#00E676'
      ctx.font = `bold ${Math.round(startR * 1.1)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('起', jx, jy)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
    })

    // 藏宝图标记图标
    let markerImg: HTMLImageElement | null = null
    try {
      markerImg = await loadImage('/watu-assets/marker.png')
    } catch (e) {
      console.warn('[watuLogic] 藏宝图标记加载失败，回退圆圈:', e)
    }
    const baseSize = Math.min(48, Math.max(32, Math.min(jW, jH) * 0.08))
    const mw = markerImg ? baseSize * (markerImg.naturalWidth / markerImg.naturalHeight) : 0
    const mh = markerImg ? baseSize : 0

    // 挖图顺序：与 getDigOrder 一致（最近邻连续巡回），保证物品栏蒙版数字与「挖N」对齐
    const ordered = orderInfo.ordered
    const pts = ordered.map((d) => gameToPixel(d.x, d.y, jW, jH, mapData.maxX, mapData.maxY))
    const [sJx, sJy] = gameToPixel(sGx, sGy, jW, jH, mapData.maxX, mapData.maxY)

    // 顺序巡回路线（最近邻）：起点 → 挖1 → 挖2 → …，黄色箭头导航线
    drawNavArrows(ctx, [[sJx, sJy], ...pts])

    // 绘制每个挖点
    const placedLabels: Array<{ x: number; y: number; w: number; h: number }> = []
    pts.forEach(([px, py], i) => {
      const gR = mh * 0.62
      ctx.beginPath()
      ctx.arc(px, py, gR, 0, Math.PI * 2)
      ctx.lineWidth = 4
      ctx.strokeStyle = '#FFEB3B'
      ctx.stroke()
      if (markerImg && markerImg.complete) {
        ctx.drawImage(markerImg, px - mw / 2, py - mh / 2, mw, mh)
      } else {
        ctx.strokeStyle = '#FF1744'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(px, py, 12, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255, 23, 68, 0.4)'
        ctx.fill()
      }
      // 标签单元：挖N + 坐标合并为一个黑底框，做碰撞避免（两点太近时自动错开 + 引导线）
      const digLabel = `挖${ordered[i].order}`
      const coordLabel = `(${ordered[i].x}, ${ordered[i].y})`
      ctx.font = 'bold 14px sans-serif'
      const dw = ctx.measureText(digLabel).width
      ctx.font = 'bold 12px sans-serif'
      const cw = ctx.measureText(coordLabel).width
      const padX = 6
      const lineH = 16
      const boxW = Math.max(dw, cw) + padX * 2
      const boxH = lineH * 2 + 8

      // 候选偏移（挖点中心为原点）：优先右上 → 右下 → 左上 → 左下 → 右 → 左 → 上 → 下
      const cand: Array<[number, number]> = [
        [gR + 6, -boxH - 2],
        [gR + 6, gR + 4],
        [-(boxW + gR + 6), -boxH - 2],
        [-(boxW + gR + 6), gR + 4],
        [gR + 6, -boxH / 2 - 2],
        [-(boxW + gR + 6), -boxH / 2 - 2],
        [-boxW / 2, -boxH - 2],
        [-boxW / 2, gR + 4]
      ]
      let bx = px + cand[0][0]
      let by = py + cand[0][1]
      for (const [dx, dy] of cand) {
        const cx = px + dx
        const cy = py + dy
        const overlap = placedLabels.some(
          (b) => cx < b.x + b.w && cx + boxW > b.x && cy < b.y + b.h && cy + boxH > b.y
        )
        if (!overlap) {
          bx = cx
          by = cy
          break
        }
      }
      placedLabels.push({ x: bx, y: by, w: boxW, h: boxH })

      // 引导线：挖点中心 → 标签框靠近挖点一侧
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, py)
      const lx = bx + (bx < px ? boxW : 0)
      const ly = by + boxH / 2
      ctx.lineTo(lx, ly)
      ctx.stroke()

      // 黑底框
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
      ctx.fillRect(bx, by, boxW, boxH)

      // 挖N（黄，居中第一行）
      ctx.fillStyle = '#FFEB3B'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(digLabel, bx + boxW / 2, by + 4 + lineH / 2)
      // 坐标（白，居中第二行）
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 12px sans-serif'
      ctx.fillText(coordLabel, bx + boxW / 2, by + 4 + lineH + lineH / 2)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
    })
  } catch (e) {
    console.error(`[watuLogic] 绘制总览失败 ${mapName}:`, e)
  }
}

/**
 * 路径规划主函数
 *
 * 接收物品栏网格中已识别的宝图，按地图分组，对每张宝图直接生成
 * "出发点 → 目标点" 的预测路线（全陆地可走，无不可达判定）。
 *
 * @param gridCells 物品栏网格（来自 store.grid，含已识别的地图名和坐标）
 * @returns { validSteps, resultHtml }
 */
export async function planRoute(gridCells: GridCell[]): Promise<PlanResult> {
  // 收集所有已识别且有坐标的宝图
  const treasures: Array<{ cell: number; mapName: string; x: number; y: number }> = []
  for (let i = 0; i < gridCells.length; i++) {
    const cell = gridCells[i]
    if (cell.isRecognized && cell.mapname && cell.x && cell.y && WATU_MAPS[cell.mapname]) {
      treasures.push({
        cell: i + 1,
        mapName: cell.mapname,
        x: cell.x,
        y: cell.y
      })
    }
  }

  if (treasures.length === 0) {
    return {
      validSteps: [],
      resultHtml: '<div class="annotation-item">⚠️ 暂无已识别的宝图数据</div>'
    }
  }

  // 按地图名分组
  const grouped: Record<string, typeof treasures> = {}
  for (const t of treasures) {
    if (!grouped[t.mapName]) grouped[t.mapName] = []
    grouped[t.mapName].push(t)
  }

  const validSteps: PathStep[] = []

  for (const mapName of Object.keys(grouped)) {
    const items = grouped[mapName].sort((a, b) => a.cell - b.cell)
    for (let i = 0; i < items.length; i++) {
      const t = items[i]
      const seq = items.length > 1 ? String(i + 1) : undefined
      validSteps.push({
        mapName,
        x: t.x,
        y: t.y,
        cell: t.cell,
        seq,
        reachable: true
      })
    }
  }

  // 生成结果 HTML（按地图分组：只列地图名 + 数量；点地图名看总览）
  let html = '<div class="annotation-title" style="color:#66bb6a;">✅ 预测路线（按地图）</div>'
  for (const mapName of Object.keys(grouped)) {
    const items = grouped[mapName].sort((a, b) => a.cell - b.cell)
    const color = getMapDefaultColor(mapName)
    const isMulti = items.length > 1
    html += '<div class="watu-map-group">'
    html += `<div class="watu-map-name" data-map="${mapName}" title="点击查看该图挖图顺序总览">`
    html += `<span class="watu-map-icon">🗺️</span>`
    html += `<span class="watu-map-dot" style="background:${color};"></span>`
    html += `<span class="watu-map-label">${mapName}</span>`
    if (isMulti) html += ` <span class="watu-count">×${items.length}</span>`
    html += '</div>'
    html += '</div>'
  }

  return { validSteps, resultHtml: html }
}

/**
 * 获取地图名列表（用于校验 OCR 识别结果）
 */
export function getMapNames(): string[] {
  return Object.keys(WATU_MAPS)
}

/**
 * 判断地图名是否在 16 张挖图地图内
 */
export function isWatuMap(mapName: string): boolean {
  return !!WATU_MAPS[mapName]
}

export { getMapDefaultColor }
