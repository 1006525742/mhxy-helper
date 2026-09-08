/**
 * 分图助手业务逻辑
 * 从 mhxyai.com/v2/fentu 逆向还原，适配本项目 TS
 *
 * 核心职责：
 * 1. 提供 YOLO 6 类标签
 * 2. 提供 16 场景地图列表与颜色编码
 * 3. 将检测框中心点映射到 4×5 物品栏网格
 * 4. 读写每个场景槽位的本地缓存（scene_0 ~ scene_15）
 */

/** YOLO 模型识别的 6 类目标（顺序对应模型输出 channel 0~5） */
export const FENTU_LABELS = [
  '藏宝图0',
  '藏宝图1',
  '藏宝图2',
  '物品栏',
  '仓库物品栏',
  '仓库'
] as const

export type FentuLabel = (typeof FENTU_LABELS)[number]

/** 16 个场景地图（对应游戏内宝图可挖场景） */
export const SCENE_MAPS = [
  '傲来国', '花果山', '女儿村', '建邺城',
  '东海湾', '墨家村', '朱紫国', '麒麟山',
  '普陀山', '五庄观', '狮驼岭', '北俱芦洲',
  '大唐国境', '大唐境外', '江南野外', '长寿郊外'
] as const

/** 16 场景颜色编码（用于网格槽位徽章） */
export const SCENE_COLORS = [
  '#365DFF', '#0aff22', '#FF7D00', '#F53F3F',
  '#86909C', '#722ED1', '#fd9605', '#031817',
  '#7BC616', '#FF6700', '#F83A30', '#5f446b',
  '#1E90FF', '#054705', '#ba1beb', '#08f3f7'
]

/** 仓库槽位上限（用户可用「+」扩展到 40） */
export const MAX_WAREHOUSE_SLOTS = 40
/** 默认仓库槽位数（对应 16 个场景地图） */
const DEFAULT_SLOT_COUNT = 16

/** 读取仓库槽位数量（默认 16，localStorage 持久） */
function readSlotCount(): number {
  try {
    const raw = localStorage.getItem('warehouse_slot_count')
    if (raw) {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) return Math.min(MAX_WAREHOUSE_SLOTS, Math.max(DEFAULT_SLOT_COUNT, n))
    }
  } catch {
    /* localStorage 不可用时静默 */
  }
  return DEFAULT_SLOT_COUNT
}

/** 写入仓库槽位数量 */
export function writeSlotCount(n: number): void {
  try {
    localStorage.setItem('warehouse_slot_count', String(n))
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/** 6 类目标颜色编码（用于 overlay 画框） */
export const LABEL_COLORS: Record<FentuLabel, string> = {
  '藏宝图0': '#00E5FF',
  '藏宝图1': '#76FF03',
  '藏宝图2': '#FFEA00',
  '物品栏': '#E040FB',
  '仓库物品栏': '#FF4081',
  '仓库': '#448AFF'
}

/** 识别位置模式 */
export type DetectMode = 'horizontal' | 'warehouse-left' | 'warehouse-right'

/** 网格规格 */
const GRID_ROWS = 4
const GRID_COLS = 5
const TOTAL_SLOTS = GRID_ROWS * GRID_COLS // 20

/**
 * 读取场景槽位缓存
 * @param idx 0~15
 * @returns 场景地图名，未设置时返回空串
 */
export function readSceneSlot(idx: number): string {
  if (idx < 0 || idx >= MAX_WAREHOUSE_SLOTS) return ''
  try {
    return localStorage.getItem(`scene_${idx}`) || ''
  } catch {
    return ''
  }
}

/**
 * 写入场景槽位缓存
 */
export function writeSceneSlot(idx: number, value: string): void {
  if (idx < 0 || idx >= MAX_WAREHOUSE_SLOTS) return
  try {
    localStorage.setItem(`scene_${idx}`, value.trim())
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/**
 * 清空全部仓库槽位缓存（scene_0 ~ scene_39）与数量键，恢复出厂默认
 */
export function clearAllSceneSlots(): void {
  try {
    for (let i = 0; i < MAX_WAREHOUSE_SLOTS; i++) {
      localStorage.removeItem(`scene_${i}`)
    }
    localStorage.removeItem('warehouse_slot_count')
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/**
 * 初始化全部仓库槽位（从缓存读出到数组）
 * 前 16 个槽位未手动设置时默认用对应序号的场景（scene_0 → SCENE_MAPS[0] …），
 * 第 17~40 个默认空（无对应场景地图），由「+」按钮添加后用户自行指定。
 * 槽位总数由 localStorage 的 warehouse_slot_count 决定（默认 16，可扩展到 40）。
 */
export function loadAllSceneSlots(): string[] {
  const count = readSlotCount()
  return Array.from({ length: count }, (_, i) => {
    const saved = readSceneSlot(i)
    if (saved) return saved
    return i < SCENE_MAPS.length ? SCENE_MAPS[i] : ''
  })
}

export interface GridCell {
  /** 槽位序号 0~19 */
  index: number
  /** 场景地图名（藏宝图2 命中时） */
  mapname: string
  /** 坐标 x */
  x: number
  /** 坐标 y */
  y: number
  /** 命中的场景槽位序号（0~15），用于颜色编码 */
  sceneSlot: number
  /** 槽位颜色 */
  slotColor: string
  /** 错误信息（如坐标越界） */
  error: string
  /** 是否已通过 OCR 识别出真实坐标（已识别的坐标跨帧持久保留，不被重建覆盖） */
  isRecognized: boolean
}

/** 创建空网格 */
export function createEmptyGrid(): GridCell[] {
  return Array.from({ length: TOTAL_SLOTS }, () => ({
    index: 0,
    mapname: '',
    x: 0,
    y: 0,
    sceneSlot: -1,
    slotColor: '#B8860B',
    error: '',
    isRecognized: false
  }))
}

export interface Point {
  x: number
  y: number
}

/**
 * 将检测框映射到 4×5 网格的某一行某一列
 *
 * 严格对齐 mhxyai.com/v2/fentu 的判定逻辑（逆向自其 fentuLogic.o）：
 *   1) 传入的是【检测框左上角 x1,y1】—— 原站用 bbox 左上角，不是中心！
 *      用中心会因 round() 整体错位 +1 格（宝图显示到错位格子就是它）。
 *   2) 原点 origin 是【面板框（物品栏/仓库/仓库物品栏）的左上角】，
 *      不是藏宝图图标的位置。
 *   3) 行列用 Math.round(dx/cellW)（四舍五入，格中心在 0/50/100…，
 *      第0格中心在面板左边缘），越界才回退 floor。
 *   4) 每格尺寸取面板框实测宽高 ÷ 行列数（原站固定 50/55px，
 *      那是基于 ~1280×960 采集；这里按实测自适应，跨分辨率都准确）。
 *
 * @param x 检测框左上角 x（x1，原始屏幕坐标）
 * @param y 检测框左上角 y（y1，原始屏幕坐标）
 * @param origin 面板框左上角原点
 * @param cellW 每格宽度
 * @param cellH 每格高度
 * @returns { row, col } 均 0 基
 */
export function locateCell(
  x: number,
  y: number,
  origin: Point,
  cellW: number,
  cellH: number
): { row: number; col: number } {
  const cols = GRID_COLS
  const rows = GRID_ROWS
  const left = origin.x
  const top = origin.y
  const right = left + cols * cellW
  const bottom = top + rows * cellH

  const tolX = cellW * 0.5
  const tolY = cellH * 0.5

  // 越界：与原站一致——按 clamp 落格（不跳过），保证每个宝图都落格
  if (!(x >= left - tolX && x <= right + tolX &&
        y >= top - tolY && y <= bottom + tolY)) {
    const dx = x - left < 0 ? 0 : x - left
    const dy = y - top < 0 ? 0 : y - top
    return {
      row: Math.max(0, Math.min(Math.round(dy / cellH), rows - 1)),
      col: Math.max(0, Math.min(Math.round(dx / cellW), cols - 1))
    }
  }

  const dx = x - left < 0 ? 0 : x - left
  const dy = y - top < 0 ? 0 : y - top

  // 关键：四舍五入（原站 Math.round(dx/cellSize)），不是 floor
  let col = Math.round(dx / cellW)
  let row = Math.round(dy / cellH)
  // 越界兜底：用 floor 重新计算（原站逻辑）
  if (col < 0 || col >= cols) col = Math.floor(dx / cellW)
  if (row < 0 || row >= rows) row = Math.floor(dy / cellH)

  return {
    row: Math.max(0, Math.min(row, rows - 1)),
    col: Math.max(0, Math.min(col, cols - 1))
  }
}

/** 行列转一维槽位序号 0~19 */
export function rowColToIndex(row: number, col: number): number {
  return row * GRID_COLS + col
}

/**
 * 从检测框数组解析出网格状态
 * @param detections YOLO 输出的检测框（已 NMS），需含左上角坐标
 * @param mode 当前识别位置模式
 * @returns 20 格网格数据
 */
/** buildGridFromDetections 的返回，含藏宝图2 的格位与框（供 OCR 读取游戏内坐标） */
export interface BuildGridResult {
  grid: GridCell[]
  baotu2: { index: number; x1: number; y1: number; x2: number; y2: number } | null
}

/** 面板锚框（物品栏/仓库/仓库物品栏）几何描述 */
export interface AnchorBox {
  className: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface BuildGridOptions {
  /**
   * 外部传入的（已做时间平滑的）锚框。提供后优先用它作为网格原点与格尺寸，
   * 不再内部重新选择面板框——这是消除「网格一上一下抖动」的关键：
   * 锚框每帧的像素级抖动被 EMA 平滑吸收，整网格稳定。
   */
  anchorOverride?: AnchorBox | null
}

/**
 * 把当前帧检测框【合并】进已存在的网格（持久网格），不重建、不覆盖已识别坐标。
 *
 * 关键修复（对齐原站 mhxyai.com/v2/fentu 的网格持久化机制）：
 *   - 原实现每帧 buildGridFromDetections() 用 createEmptyGrid() 重建空白网格并整体替换，
 *     导致异步 OCR（0.6~1.6s 才回）写入的坐标在下一帧被空白网格覆盖 → 多张宝图只显示最后一张。
 *   - 本函数接收 currentGrid（store 里的持久网格），返回【新数组】但保留其中已识别的格子，
 *     只在未识别的格子上写占位 / 清空；OCR 回填的坐标准确落格且跨帧持久。
 *
 * 合并规则（逐格）：
 *   1) 该格已 isRecognized（有真实坐标）→ 原样保留，无论本帧是否还有藏宝图1。
 *   2) 该格本帧检测到藏宝图1 且未识别 → 标占位（藏宝图），不写坐标。
 *   3) 其余（本帧无藏宝图1、且未识别）→ 清空为空格。
 *
 * 藏宝图2 的目标格 = 最近的藏宝图1 格（与原站一致）；无藏宝图1 时 index=-1（走「最近识别坐标」）。
 *
 * @param currentGrid 上一帧的持久网格（store.grid）
 * @param detections   本帧 YOLO 检测框
 * @param mode         识别位置模式
 * @param opts.anchorOverride 平滑后的锚框
 * @returns { grid, baotu2 }
 */
export function mergeDetectionsIntoGrid(
  currentGrid: GridCell[],
  detections: Array<{
    className: string
    cx: number
    cy: number
    x1: number
    y1: number
    x2: number
    y2: number
  }>,
  mode: DetectMode,
  opts?: BuildGridOptions
): BuildGridResult {
  const isWarehouse = mode !== 'horizontal'

  // 优先使用外部平滑锚框（消除网格抖动）；否则按模式选面板框作为兜底。
  const ov = opts?.anchorOverride
  let anchor: AnchorBox | undefined
  if (ov && ov.x2 > ov.x1 && ov.y2 > ov.y1) {
    anchor = ov
  } else {
    const panelClass = isWarehouse
      ? (mode === 'warehouse-left' ? '仓库' : '仓库物品栏')
      : '物品栏'
    anchor =
      detections.find(d => d.className === panelClass) ||
      detections.find(d => d.className === '物品栏') ||
      detections.find(d => d.className === '仓库物品栏') ||
      detections.find(d => d.className === '仓库')
  }

  // 无锚框：原站不落格。这里直接沿用上一份网格（不清除已识别坐标），藏宝图2 也暂不处理。
  if (!anchor) return { grid: currentGrid, baotu2: null }

  const origin: Point = { x: anchor.x1, y: anchor.y1 }
  const cellW = Math.max(1, (anchor.x2 - anchor.x1) / GRID_COLS)
  const cellH = Math.max(1, (anchor.y2 - anchor.y1) / GRID_ROWS)

  // 本帧藏宝图1 落到的槽位集合
  const baotu1Dets = detections.filter(d => d.className === '藏宝图1')
  const baotu1Slots = new Set<number>()
  for (const det of baotu1Dets) {
    const { row, col } = locateCell(det.x1, det.y1, origin, cellW, cellH)
    const idx = rowColToIndex(row, col)
    if (idx >= 0 && idx < TOTAL_SLOTS) baotu1Slots.add(idx)
  }

  // —— 合并进持久网格（核心：已识别坐标绝不覆盖）——
  const grid = currentGrid.map((cell) => {
    const idx = cell.index
    if (cell.isRecognized) {
      // 已识别：保留坐标（即使本帧该格无藏宝图1 也不清，OCR 回填后即持久）
      return cell
    }
    if (baotu1Slots.has(idx)) {
      // 本帧有未识别的藏宝图1 → 占位（藏宝图），等待藏宝图2 OCR 回填
      return { ...cell, mapname: '藏宝图', x: 0, y: 0, isRecognized: false }
    }
    // 无藏宝图1 且未识别 → 空格
    return { ...cell, mapname: '', x: 0, y: 0, isRecognized: false }
  })

  // —— 藏宝图2 → OCR 读坐标，目标格 = 最近的藏宝图1 格 ——
  let baotu2: BuildGridResult['baotu2'] = null
  const baotu2Dets = detections.filter(d => d.className === '藏宝图2')
  if (baotu2Dets.length > 0) {
    const b2 = baotu2Dets[0]
    let bestIdx = -1
    if (baotu1Slots.size > 0) {
      const b2cx = (b2.x1 + b2.x2) / 2
      const b2cy = (b2.y1 + b2.y2) / 2
      let bestDist = Infinity
      for (const idx of baotu1Slots) {
        const ccx = origin.x + (idx % GRID_COLS + 0.5) * cellW
        const ccy = origin.y + (Math.floor(idx / GRID_COLS) + 0.5) * cellH
        const dist = Math.hypot(ccx - b2cx, ccy - b2cy)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = idx
        }
      }
    }
    baotu2 = { index: bestIdx, x1: b2.x1, y1: b2.y1, x2: b2.x2, y2: b2.y2 }
  }

  return { grid, baotu2 }
}

/**
 * 根据场景槽位序号获取颜色
 * 0~15 用预置 SCENE_COLORS；第 17 个起用黄金角在 HSL 色环上均匀取色，
 * 保证最多 40 个槽位彼此可区分。
 */
export function getSceneColor(sceneSlot: number): string {
  if (sceneSlot >= 0 && sceneSlot < SCENE_COLORS.length) return SCENE_COLORS[sceneSlot]
  if (sceneSlot < 0) return '#B8860B'
  const hue = (sceneSlot * 137.508) % 360
  return `hsl(${Math.round(hue)}, 65%, 55%)`
}

/**
 * 地图名 → 该地图的默认色（即该地图作为默认场景时所在槽位的颜色）
 * 未设置 / 不在 16 图内的地图返回中性灰（#9aa1b0），用于「未选地图不填充颜色」。
 * 仓库徽章与物品栏大数字统一以此着色，保证「同一地图 = 同一颜色」，与槽位序号无关。
 */
export function getMapDefaultColor(mapName: string): string {
  if (!mapName) return '#9aa1b0'
  const idx = SCENE_MAPS.indexOf(mapName as (typeof SCENE_MAPS)[number])
  if (idx >= 0) return SCENE_COLORS[idx]
  return '#9aa1b0'
}
