// 慈心后端接口封装（backend_cixin，端口 8005，经 vite proxy /api/othello 转发）
// 参照 services/api.ts 风格，使用同源相对路径。

export interface OthelloCoordinate {
  mapName: string
  x: number
  y: number
  row: number
  column: number
  action: number
}

export interface OthelloMoveRequest {
  board: number[]
  aiPlayer?: number
  timeMs?: number
  maxDepth?: number
  /** 检测到的宝箱格 index 列表（最多 3 个，按 boxConfidence 降序） */
  boxes?: number[]
  /** 求解策略：
   *  - winFirst (默认): 优先赢棋
   *  - boxFirst: 优先抢宝箱（在赢棋基础上加成）
   *  - taskFirst: 速刷，优先前往「落地可刷任务」的地图（长寿村/朱紫国/傲来国）
   */
  strategy?: 'winFirst' | 'boxFirst' | 'taskFirst'
}

export interface OthelloMoveResponse {
  action: number | null
  notation: string
  legal_moves: number[]
  coordinate: OthelloCoordinate | null
  coordinate_label: string
  board_str: string
}

const API_BASE = ''

export async function fetchOthelloStatus(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/othello/status`, { signal })
  if (!res.ok) throw new Error(`/api/othello/status 失败: ${res.status}`)
  return res.json()
}

export async function solveOthello(
  req: OthelloMoveRequest,
  signal?: AbortSignal
): Promise<OthelloMoveResponse> {
  const res = await fetch(`${API_BASE}/api/othello/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`/api/othello/move 失败: ${res.status} ${detail}`)
  }
  return res.json()
}
