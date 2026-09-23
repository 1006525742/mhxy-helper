/**
 * 跑商助手 · 核心逻辑
 *
 * 商品价格每 10 分钟刷新一次（一刷 / 二刷两条时间线），
 * 本模块负责：基准价表、涨跌计算、刷新倒计时、识别结果校验。
 */

/** 模型类别顺序（必须与训练时一致，顺序错则全部识别错乱） */
export const PAOSHANG_LABELS: string[] = (() => {
  const goods = [
    '棉布', '佛珠', '纸扇', '武器',
    '面粉', '符', '鹿茸', '木材',
    '珍珠', '首饰', '纸钱', '夜明珠',
    '衣甲', '人参', '香油', '铜铃',
    '盐', '布帽', '酒', '蜡烛'
  ]
  const labels: string[] = []
  for (const g of goods) {
    labels.push(`${g}0`, `${g}1`, `${g}2`)
  }
  labels.push('交易框', '买入框', '空白1', '单价')
  return labels
})()

export const PAOSHANG_MODEL = {
  path: '/models/paoshang/best.onnx',
  inputSize: 480,
  confidence: 0.4
}

export type Slot = 'gd1' | 'gd2' | 'gd3' | 'gd4'

export interface GoodsInfo {
  /** 基准价：涨跌百分比以此为分母 */
  base: number
  /** 所属地点 */
  addr: string
  /** 在该地点商人处的槽位（商品1~商品4） */
  slot: Slot
  /** 校验用基准价，少数商品与 base 不同（如符 5300/5400） */
  checkBase?: number
  /** 未配图时的兜底图标 */
  emoji: string
  /** 自定义图片路径，留空则按 GOODS_ICON_DIR + 商品名.png 取 */
  icon?: string
}

/**
 * 商品图片存放目录（对应 public/static/icons/paoshang/）
 * 把截图/图标按「商品名.png」丢进去即可自动生效，例如 棉布.png
 */
export const GOODS_ICON_DIR = '/static/icons/paoshang/'

/** 商品图片路径；图片缺失时前端会降级显示 emoji */
export function goodsIconSrc(name: string): string {
  const info = GOODS[name]
  if (info?.icon) return info.icon
  return GOODS_ICON_DIR + encodeURIComponent(name) + '.png'
}

export function goodsEmoji(name: string): string {
  return GOODS[name]?.emoji || '📦'
}

/** 20 种商品的基准价与归属 */
export const GOODS: Record<string, GoodsInfo> = {
  棉布: { base: 3500, addr: '长安', slot: 'gd1', emoji: '🧵' },
  佛珠: { base: 7000, addr: '长安', slot: 'gd2', emoji: '📿' },
  纸扇: { base: 3800, addr: '长安', slot: 'gd3', emoji: '🪭' },
  武器: { base: 4000, addr: '长安', slot: 'gd4', emoji: '⚔️' },

  木材: { base: 3900, addr: '长寿', slot: 'gd1', emoji: '🪵' },
  面粉: { base: 3000, addr: '长寿', slot: 'gd2', emoji: '🌾' },
  鹿茸: { base: 7500, addr: '长寿', slot: 'gd3', emoji: '🦌' },
  符: { base: 5300, addr: '长寿', slot: 'gd4', checkBase: 5400, emoji: '📜' },

  珍珠: { base: 5500, addr: '地府', slot: 'gd1', emoji: '💠' },
  首饰: { base: 4300, addr: '地府', slot: 'gd2', emoji: '💍' },
  纸钱: { base: 3000, addr: '地府', slot: 'gd3', emoji: '💴' },
  夜明珠: { base: 8200, addr: '地府', slot: 'gd4', emoji: '🔮' },

  衣甲: { base: 2700, addr: '北俱', slot: 'gd1', emoji: '🛡️' },
  人参: { base: 7600, addr: '北俱', slot: 'gd2', emoji: '🥕' },
  香油: { base: 4300, addr: '北俱', slot: 'gd3', emoji: '🫙' },
  铜铃: { base: 4200, addr: '北俱', slot: 'gd4', checkBase: 4300, emoji: '🔔' },

  盐: { base: 5500, addr: '傲来', slot: 'gd1', emoji: '🧂' },
  布帽: { base: 3500, addr: '傲来', slot: 'gd2', emoji: '🧢' },
  酒: { base: 4000, addr: '傲来', slot: 'gd3', emoji: '🍶' },
  蜡烛: { base: 2000, addr: '傲来', slot: 'gd4', emoji: '🕯️' }
}

export const LOCATIONS = ['长安', '长寿', '地府', '北俱', '傲来'] as const

/** OCR 易混商品名纠正：仅在长寿商人处生效 */
const NAME_FIX: Record<string, string> = {
  '长寿|纸钱': '面粉',
  '长寿|布帽': '鹿茸'
}

/** 价格合理区间，超出即视为误识别 */
export const PRICE_MIN = 1000
export const PRICE_MAX = 15000
/** 与基准价的允许偏离倍数 */
const BASE_TOLERANCE = 0.7

export interface GoodsCell {
  name: string
  price: number
  rate: number
}

export interface PriceRow {
  time: string
  location: string
  goods: GoodsCell[]
}

export function emptyCell(): GoodsCell {
  return { name: '', price: 0, rate: 0 }
}

/**
 * 涨跌百分比： (现价 - 基准价) / 基准价
 * 涨为正、跌为负，取整
 */
export function calcRate(name: string, price: number): number {
  const info = GOODS[name]
  if (!info || !price) return 0
  return Math.round(((price - info.base) / info.base) * 100)
}

/** 涨跌配色：涨红跌绿（国内习惯），≥25% 视为高价买入警示 */
export function rateColor(rate: number): string {
  if (rate < 0) return 'down'
  if (rate >= 25) return 'up'
  return 'flat'
}

/**
 * 从 OCR 文本中解析价格。
 * 游戏内价格是纯数字，可能混入空格、逗号、中文标点。
 */
export function parsePrice(text: string): number {
  if (!text) return 0
  const cleaned = text.replace(/[^\d]/g, '')
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isNaN(n) ? 0 : n
}

/** 价格是否落在合理区间 */
export function priceInRange(price: number): boolean {
  return price > PRICE_MIN && price < PRICE_MAX
}

/**
 * 与基准价比对，剔除明显误识别。
 * 通过返回 true。
 */
export function priceMatchesBase(name: string, price: number): boolean {
  const info = GOODS[name]
  if (!info) return false
  const ref = info.checkBase || info.base
  return price >= ref * (1 - BASE_TOLERANCE) && price <= ref * (1 + BASE_TOLERANCE)
}

/** 修正 OCR 商品名（按当前地点纠偏） */
export function fixGoodsName(location: string, name: string): string {
  return NAME_FIX[`${location}|${name}`] || name
}

/**
 * 距离下次一刷：商品每 10 分钟刷一次，刷新的秒偏移固定为 10 秒。
 * 即每个 10 分钟的第 10 秒（0:10、10:10、20:10 ...）。
 */
export function nextFirstRefresh(now: Date = new Date()): { minutes: number; seconds: number } {
  const elapsed = now.getMinutes() * 60 + now.getSeconds()
  let target = Math.ceil((elapsed - 10) / 600) * 600 + 10
  if (target === elapsed) target += 600
  let remain = target - elapsed
  if (remain < 0) remain += 3600
  return { minutes: Math.floor(remain / 60), seconds: remain % 60 }
}

/**
 * 距离下次二刷：二刷的分/秒由用户设置（分 0-9，每 10 分钟一轮）。
 * 默认 0 分 10 秒，与一刷重合，玩家按所在服务器的实际错开时间调整。
 */
export function nextSecondRefresh(
  setMin: number,
  setSec: number,
  now: Date = new Date()
): { minutes: number; seconds: number } {
  const minutes: number[] = []
  for (let m = setMin; m < 60; m += 10) minutes.push(m)

  const nowSec = now.getMinutes() * 60 + now.getSeconds()
  const candidates = [
    ...minutes.map(m => m * 60 + setSec),
    (minutes[0] + 60) * 60 + setSec
  ]
  let remain = candidates.find(c => c > nowSec)! - nowSec
  if (remain >= 3600) remain -= 3600
  if (remain < 0) remain += 3600
  return { minutes: Math.floor(remain / 60), seconds: remain % 60 }
}

export function formatCountdown(c: { minutes: number; seconds: number }): string {
  const mm = String(c.minutes).padStart(2, '0')
  const ss = String(c.seconds).padStart(2, '0')
  return `${mm}分${ss}秒`
}

export function formatDuration(totalSec: number): string {
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const s = String(totalSec % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

/** 三条常规跑商路线的单程耗时（秒） */
export const ROUTES: { from: string; to: string; seconds: number }[] = [
  { from: '长安', to: '长寿', seconds: 260 },
  { from: '长寿', to: '长安', seconds: 100 },
  { from: '地府', to: '北俱', seconds: 180 },
  { from: '北俱', to: '地府', seconds: 70 },
  { from: '傲来', to: '北俱', seconds: 40 },
  { from: '傲来', to: '长寿', seconds: 85 }
]

export function formatRouteSeconds(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}分${String(s).padStart(2, '0')}秒`
}

// ---------- 本地持久化 ----------

const LS_ORDER = 'mhxy_paoshang_order'
const LS_ERMIN = 'mhxy_paoshang_ershua_min'
const LS_ERSEC = 'mhxy_paoshang_ershua_sec'
const LS_ROWS = 'mhxy_paoshang_rows'

export type SortOrder = 'asc' | 'desc'

export function loadOrder(): SortOrder {
  return (localStorage.getItem(LS_ORDER) as SortOrder) || 'asc'
}

export function saveOrder(v: SortOrder): void {
  localStorage.setItem(LS_ORDER, v)
}

export function loadErshua(): { min: number; sec: number } {
  return {
    min: parseInt(localStorage.getItem(LS_ERMIN) || '0', 10) || 0,
    sec: parseInt(localStorage.getItem(LS_ERSEC) || '10', 10) || 0
  }
}

export function saveErshua(min: number, sec: number): void {
  localStorage.setItem(LS_ERMIN, String(min))
  localStorage.setItem(LS_ERSEC, String(sec))
}

export function loadRows(): PriceRow[] {
  try {
    const raw = localStorage.getItem(LS_ROWS)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveRows(rows: PriceRow[]): void {
  try {
    // 只保留最近 200 条，避免 localStorage 膨胀
    localStorage.setItem(LS_ROWS, JSON.stringify(rows.slice(-200)))
  } catch {
    /* 忽略配额错误 */
  }
}
