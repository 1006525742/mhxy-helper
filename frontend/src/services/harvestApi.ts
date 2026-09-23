/**
 * 摆摊收售价采集 API（后端 backend_harvest.py，端口 8007，经 Vite 代理 /api/harvest）
 */
const BASE = '/api/harvest'

/** 价格溯源：最低价/最高价那条原始样本的来源信息 */
export interface PriceRec {
  id: string
  price: number
  server: string
  stall_owner: string    // 摊主名
  stall_id: string       // 摊位ID
  stall_name: string     // 摊位名/招牌（摊主自写的广告语，如「25W收163五行」）
  collected_at: number
}

export interface PriceStat {
  avg: number
  min: number
  max: number
  count: number
  min_rec: PriceRec | null   // 最低价那条（出货关注）
  max_rec: PriceRec | null   // 最高价那条（收货关注）
}

export interface HarvestItem {
  item_name: string
  category: string
  parent: string
  icon: string | null
  buy: PriceStat | null       // 收货价统计（来自收购摊位）
  sell: PriceStat | null      // 出货价统计（来自出售摊位）
  avg: number                 // 兼容旧字段：优先收货价
  min: number
  max: number
  count: number
  latest: number
}

export interface CatNode {
  id: number
  name: string
  displayName: string
  children: { id: number; name: string; displayName: string }[]
}

export interface HarvestSample {
  id: string
  item_name: string
  category: string
  server: string
  price: number
  icon: string | null
  collected_at: number
}

export interface SamplePayload {
  item_name: string
  category: string
  server: string
  price: number
  price_type?: 'buy' | 'sell'   // buy=收货价 / sell=出货价
  stall_owner?: string          // 摊主名（溯源用）
  stall_id?: string             // 摊位ID（溯源用）
  stall_name?: string           // 摊位名/招牌（溯源用）
  icon?: string
}

export interface OcrBlock {
  text: string
  score: number
  x: number
  y: number
}

/** 后端从截图解析出的结构化收货价条目（对标 mhxyai 的 items[]） */
export interface HarvestParsedItem {
  name: string            // OCR 原文（透明保留）
  item_name: string       // 归一到类目表的规范物品名（未匹配置 name 原值）
  category: string        // 命中时=叶子名(顶级命中则为顶级名)，可直接入库
  parent: string          // 命中时=顶级分类名
  matched: boolean        // 是否成功归一到规范物品
  match_method: string    // wuji-exact / mhxy-exact / … / none
  match_score: number     // 匹配置信度 0~1
  icon?: string           // 物价宝鉴图标相对路径，如 低级兽决/兽决.png（经 /static/icons 取图）
  price_text: string
  price: number
  score: number
  row: number
  col: number
  split?: boolean        // 该条目由「黏连物品名」自动切分而来，价格需逐条核对
}

export async function getCategories(): Promise<CatNode[]> {
  const r = await fetch(`${BASE}/categories`)
  const j = await r.json()
  return j.tree || []
}

export async function getHarvest(params: { category?: string; server?: string; kw?: string } = {}): Promise<HarvestItem[]> {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.server) qs.set('server', params.server)
  if (params.kw) qs.set('kw', params.kw)
  const r = await fetch(`${BASE}?${qs.toString()}`)
  const j = await r.json()
  return j.items || []
}

export async function addSample(p: SamplePayload) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  return r.json()
}

export async function deleteSample(id: string) {
  const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  return r.json()
}

export async function deleteItem(name: string) {
  const r = await fetch(`${BASE}/item/${encodeURIComponent(name)}`, { method: 'DELETE' })
  return r.json()
}

/** 框选截图 → 上传识别，返回结构化收货价条目（items）+ 原始文字块（blocks）兜底。 */
export async function recognizeImage(file: Blob): Promise<{
  success: boolean
  size: number[]
  server_hint: string
  stall_kind: string            // 'buy'=收购摊位(收货价) / 'sell'=出售摊位(出货价) / ''=未识别
  stall_detected: boolean       // 是否确认为摊位界面（False=只是主画面/聊天窗，items 已被后端清空）
  stall_owner: string           // 摊主名
  stall_id: string              // 摊位ID
  stall_name: string            // 摊位名/招牌
  region: number[] | null       // 自动定位到的摊位区域 [x0,y0,x1,y1]（原图坐标）
  occluded?: boolean            // True=画面被本页遮挡（捕获源选了"整个屏幕"而非"游戏窗口"）
  occlusion_hits?: string[]     // 命中哪些本页特征文案
  items: HarvestParsedItem[]
  blocks: OcrBlock[]
  message?: string
}> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${BASE}/recognize`, { method: 'POST', body: fd })
  return r.json()
}
