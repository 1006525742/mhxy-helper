/**
 * 收货采集 API（后端 backend_harvest.py，端口 8007，经 Vite 代理 /api/harvest）
 */
const BASE = '/api/harvest'

export interface HarvestItem {
  item_name: string
  category: string
  parent: string
  icon: string | null
  avg: number
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
  icon?: string
}

export interface OcrBlock {
  text: string
  score: number
  x: number
  y: number
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

/** 框选截图 → 上传识别，返回带坐标文字块（按版面排序）。 */
export async function recognizeImage(file: Blob): Promise<{ success: boolean; size: number[]; blocks: OcrBlock[]; message?: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${BASE}/recognize`, { method: 'POST', body: fd })
  return r.json()
}
