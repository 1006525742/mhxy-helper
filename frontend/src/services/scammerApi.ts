/**
 * 骗子名单 API（后端 backend_scammer.py，端口 8013，经 Vite 代理 /api/scammer）
 */
const BASE = '/api/scammer'

export type ScamCategory = 'scammer' | 'gang' | 'afk' | 'blacklist'

export interface ScammerRecord {
  id: string
  category: ScamCategory
  name: string
  gameId: string
  level: string
  type: string          // 骗术 / 行为类型
  time: string          // 原始时间描述
  timeISO: string       // 归一化日期
  reporter: string      // 提供人游戏昵称
  detail: string        // 经过（手机号已打码）
  sensitive: {
    wechat: string
    wechatId: string
    reporterWechat: string
    phones: string[]
  }
  hasSensitive?: boolean
  extra?: Record<string, string>
  source: 'import' | 'user'
  verified: boolean
  risk: 'high' | 'normal'
  createdAt: string
}

export interface ScammerMeta {
  updatedAt: string
  notice: string
  rules: { k: string; v: string }[]
  total: number
  userReports: number
  highRisk: number
  byCategory: Record<string, { label: string; count: number }>
}

export interface CheckResult {
  keyword: string
  level: 'danger' | 'warn' | 'safe' | 'none'
  count: number
  hits: ScammerRecord[]
}

export interface ReportPayload {
  name: string
  gameId: string
  level: string
  type: string
  time: string
  detail: string
  reporter: string
  wechat: string
  wechatId: string
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v !== undefined)
  ).toString()
  const res = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`)
  if (!res.ok) throw new Error(`请求失败 ${res.status}`)
  return res.json()
}

export const getMeta = () => get<{ result: string } & ScammerMeta>('/meta')

export const getList = (params: { category?: string; q?: string; risk?: string; limit?: number }) =>
  get<{ result: string; total: number; records: ScammerRecord[] }>(
    '/list',
    Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v ?? '')])
    ) as Record<string, string>
  )

export const checkId = (q: string) =>
  get<{ result: string } & CheckResult>('/check', { q })

/** 按需获取敏感字段明文（微信号 / 手机号），后端限流 30 次/分钟 */
export const revealField = async (id: string, field: 'wechat' | 'wechatId' | 'reporterWechat' | 'phones') => {
  const res = await fetch(`${BASE}/reveal?id=${encodeURIComponent(id)}&field=${field}`)
  const json = await res.json()
  if (json.result !== 'ok') throw new Error(json.error || '获取失败')
  return json.value as string | string[]
}

export const submitReport = async (payload: ReportPayload) => {
  const res = await fetch(`${BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json()
  if (json.result !== 'ok') throw new Error(json.error || '提交失败')
  return json as { result: string; record: ScammerRecord; message: string }
}

export const CATEGORY_LABELS: Record<ScamCategory | 'all', string> = {
  all: '全部',
  scammer: '疑似骗子',
  gang: '骗子帮派',
  afk: '挂机不看号',
  blacklist: '黑名单',
}
