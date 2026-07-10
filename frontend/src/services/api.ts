/**
 * 后端 API 调用服务
 */
const API_BASE = '/api'

export interface RecognizeResult {
  success: boolean
  map?: string
  x?: number
  y?: number
  error?: string
}

export interface PredictResult {
  success: boolean
  map?: string
  x?: number
  y?: number
  position_areas?: string[]
  corner_areas?: string[]
  confidence?: number
  annotated_image?: string
  error?: string
}

export interface MapInfo {
  name: string
  width: number
  height: number
}

/**
 * 模板匹配识别坐标
 */
export async function recognizeCoord(imageBase64: string): Promise<RecognizeResult> {
  const response = await fetch(`${API_BASE}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64 })
  })
  return response.json()
}

/**
 * 抓鬼预测
 */
export async function predictGhost(mapName: string, x: number, y: number): Promise<PredictResult> {
  const response = await fetch(`${API_BASE}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ map: mapName, x, y })
  })
  return response.json()
}

/**
 * 获取地图列表
 */
export async function getMaps(): Promise<{ maps: string[] }> {
  const response = await fetch(`${API_BASE}/maps`)
  return response.json()
}

/**
 * 获取模板列表
 */
export async function getTemplates(): Promise<{ templates: string[]; count: number }> {
  const response = await fetch(`${API_BASE}/templates`)
  return response.json()
}