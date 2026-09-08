// 藏宝阁模块前端 API 封装
// 安全约定（方案 B：用户各自授权）：
//  - user_token 由本机随机生成，存在 localStorage，仅用于后端按用户隔离数据
//  - 用户的藏宝阁 cookie 只存在本机 localStorage，绝不上传到任何服务器
//  - 所有 /api/cbg 请求都带 X-User-Token 头

const USER_TOKEN_KEY = 'cbg_user_token'
const CBG_COOKIE_KEY = 'cbg_cookie'

export function getOrCreateUserToken(): string {
  let t = localStorage.getItem(USER_TOKEN_KEY)
  if (!t) {
    t = 'u_' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
    localStorage.setItem(USER_TOKEN_KEY, t)
  }
  return t
}

export function getCbgCookie(): string {
  return localStorage.getItem(CBG_COOKIE_KEY) || ''
}

export function setCbgCookie(c: string): void {
  localStorage.setItem(CBG_COOKIE_KEY, c)
}

async function postJson(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Token': getOrCreateUserToken(),
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function getJson(path: string): Promise<any> {
  const u = new URL(path, window.location.origin)
  u.searchParams.set('user_token', getOrCreateUserToken())
  const res = await fetch(u.toString(), {
    headers: { 'X-User-Token': getOrCreateUserToken() },
  })
  return res.json()
}

export const cbgApi = {
  listWatch: () => getJson('/api/cbg/watch'),
  addWatch: (item: Record<string, unknown>) =>
    postJson('/api/cbg/watch', { ...item, user_token: getOrCreateUserToken() }),
  delWatch: (ordersn: string) =>
    fetch(`/api/cbg/watch?user_token=${getOrCreateUserToken()}&ordersn=${encodeURIComponent(ordersn)}`, {
      method: 'DELETE',
      headers: { 'X-User-Token': getOrCreateUserToken() },
    }).then((r) => r.json()),
  addSnapshot: (item: Record<string, unknown>) =>
    postJson('/api/cbg/snapshot', { ...item, user_token: getOrCreateUserToken() }),
  history: (ordersn: string) => getJson(`/api/cbg/history?ordersn=${encodeURIComponent(ordersn)}`),
  addDeals: (ordersn: string, deals: Array<{ deal_ts: number; deal_price: number }>) =>
    postJson('/api/cbg/deals', { user_token: getOrCreateUserToken(), ordersn, deals }),
  deals: (ordersn: string) => getJson(`/api/cbg/deals?ordersn=${encodeURIComponent(ordersn)}`),
  importItems: (items: Array<Record<string, unknown>>) =>
    postJson('/api/cbg/import', { user_token: getOrCreateUserToken(), items }),
  capture: (label: string, items: Array<Record<string, unknown>>) =>
    postJson('/api/cbg/capture', { user_token: getOrCreateUserToken(), label, items }),
  listItems: (params: Record<string, string | number> = {}) => {
    const u = new URL('/api/cbg/items', window.location.origin)
    u.searchParams.set('user_token', getOrCreateUserToken())
    for (const [k, v] of Object.entries(params)) {
      if (v !== '' && v !== undefined && v !== null) u.searchParams.set(k, String(v))
    }
    return fetch(u.toString(), { headers: { 'X-User-Token': getOrCreateUserToken() } }).then((r) => r.json())
  },
  listLabels: (excludeType?: string) => {
    const u = new URL('/api/cbg/labels', window.location.origin)
    u.searchParams.set('user_token', getOrCreateUserToken())
    if (excludeType) u.searchParams.set('exclude_type', excludeType)
    return fetch(u.toString(), { headers: { 'X-User-Token': getOrCreateUserToken() } }).then((r) => r.json())
  },
  delItem: (eid: string) =>
    fetch(`/api/cbg/item?user_token=${getOrCreateUserToken()}&eid=${encodeURIComponent(eid)}`, {
      method: 'DELETE',
      headers: { 'X-User-Token': getOrCreateUserToken() },
    }).then((r) => r.json()),
  delLabel: (label: string) =>
    fetch(`/api/cbg/label?user_token=${getOrCreateUserToken()}&label=${encodeURIComponent(label)}`, {
      method: 'DELETE',
      headers: { 'X-User-Token': getOrCreateUserToken() },
    }).then((r) => r.json()),
  delItemsByType: (item_type: string) =>
    fetch(`/api/cbg/items/type?user_token=${getOrCreateUserToken()}&item_type=${encodeURIComponent(item_type)}`, {
      method: 'DELETE',
      headers: { 'X-User-Token': getOrCreateUserToken() },
    }).then((r) => r.json()),
  // ---- 自动采集订阅 ----
  listSubscriptions: () => getJson('/api/cbg/subscriptions'),
  addSubscription: (item: Record<string, unknown>) =>
    postJson('/api/cbg/subscriptions', { ...item, user_token: getOrCreateUserToken() }),
  updateSubscription: (id: number | string, patch: Record<string, unknown>) =>
    fetch(`/api/cbg/subscriptions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Token': getOrCreateUserToken() },
      body: JSON.stringify({ ...patch, user_token: getOrCreateUserToken() }),
    }).then((r) => r.json()),
  delSubscription: (id: number | string) =>
    fetch(`/api/cbg/subscriptions/${id}?user_token=${getOrCreateUserToken()}`, {
      method: 'DELETE',
      headers: { 'X-User-Token': getOrCreateUserToken() },
    }).then((r) => r.json()),
  // ---- 角色估价 ----
  priceRoleItem: (eid: string) => getJson(`/api/cbg/price/item/${encodeURIComponent(eid)}`),
  runSubscriptionNow: (id: number | string) =>
    fetch(`/api/cbg/subscriptions/${id}/run-now?user_token=${getOrCreateUserToken()}`, {
      method: 'POST',
      headers: { 'X-User-Token': getOrCreateUserToken() },
    }).then((r) => r.json()),
}
