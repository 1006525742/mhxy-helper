/** 资产登记 API —— 后端 backend_asset.py，端口 8012，前缀 /api/asset
 *  金额单位统一为「万」（梦幻币）
 */

export interface AssetItem {
  id: number
  code: string
  item_type: string
  server: string
  name: string
  attributes: string
  related_role: string
  qty: number
  buy_price: number | null
  buy_date: string
  sell_price: number | null
  sell_date: string
  fee: number
  note: string
  listing_reminder_at: string
  status: 'in_stock' | 'sold'
  source: string
  cbg_eid: string
  deleted_at: string | null
  created_at: string
  updated_at: string

  /** 后端补算的派生字段 */
  hold_days: number | null
  hold_warning: boolean
  cost: number
  revenue?: number
  profit: number | null
  profit_rate: number | null
}

export interface AssetListResp {
  success: boolean
  total: number
  items: AssetItem[]
}

export interface AssetSummary {
  success: boolean
  stock_count: number
  stock_qty: number
  stock_cost: number
  sold_count: number
  sold_profit: number
}

export interface ListParams {
  status?: 'in_stock' | 'sold' | 'all' | 'trash'
  kw?: string
  item_type?: string
  server?: string
  sort?: string
  page?: number
  page_size?: number
}

const BASE = '/api/asset'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`接口返回非 JSON（${res.status}）：${text.slice(0, 120)}`)
  }
  if (!res.ok) throw new Error(data?.detail || data?.error || `请求失败 ${res.status}`)
  return data as T
}

export function fetchAssets(params: ListParams): Promise<AssetListResp> {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  })
  return request<AssetListResp>(`${BASE}/list?${sp.toString()}`)
}

export function fetchSummary(): Promise<AssetSummary> {
  return request<AssetSummary>(`${BASE}/summary`)
}

export function fetchTypes(): Promise<{ success: boolean; types: string[]; hold_warn_days: number }> {
  return request(`${BASE}/types`)
}

export function createAsset(payload: Partial<AssetItem> & { batch_save_count?: number }): Promise<{ success: boolean; ids: number[]; item: AssetItem }> {
  return request(`${BASE}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updateAsset(id: number, payload: Partial<AssetItem>) {
  return request<{ success: boolean; item: AssetItem }>(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 部分售出：拆成「已售 N 件」+「在库 M 件」 */
export function splitSell(id: number, payload: { qty: number; sell_price?: number; sell_date?: string; fee?: number }) {
  return request<{ success: boolean; sold_id: number; remain_id: number }>(`${BASE}/${id}/split-sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function softDelete(id: number) {
  return request(`${BASE}/${id}`, { method: 'DELETE' })
}

export function restoreAsset(id: number) {
  return request(`${BASE}/${id}/restore`, { method: 'POST' })
}

export function purgeAsset(id: number) {
  return request(`${BASE}/${id}/purge`, { method: 'DELETE' })
}

/** CSV 导出，浏览器直接下载 */
export function exportCsv(status: string = 'all') {
  window.location.href = `${BASE}/export?status=${encodeURIComponent(status)}`
}

/** 截图识别：图片 -> OCR + 规则抽取 类型/名称/属性 */
export interface OcrParseResp {
  item_type: string
  name: string
  attributes: string
  raw_text: string
}

export function ocrParse(file: File): Promise<OcrParseResp> {
  const fd = new FormData()
  fd.append('img', file)
  return request<OcrParseResp>(`${BASE}/ocr-parse`, {
    method: 'POST',
    body: fd,
  })
}
