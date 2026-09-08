// background.js - MV3 service worker
// 职责：管理每用户 token、作为中转把抓取数据上报到 mhxy-helper 后端(8006)
// 安全：token 存于本机扩展 storage，绝不经手密码；cookie 由用户在藏宝阁官网自己登录产生。

const API_BASE = 'http://127.0.0.1:8006'

// ---------- 登录态 Cookie 备份/恢复 ----------
// 藏宝阁登录态 = 163.com 各域下的 Cookie（P_INFO/NTES_PASSPORT/NTES_SESS 等，含 HttpOnly）。
// 浏览器清 Cookie / 无痕模式 / 换机后这些会丢失，需手动重登。本模块在用户登录后把
// 所有 163.com 域下的登录态 Cookie 备份到本地 storage（不依赖固定白名单，避免不同登录
// 方式真实鉴权 Cookie 名字不在列表里而备份为空）；丢失时（扩展启动、采集报"登陆过期"、页面检测到未登录）
// 自动写回，避免反复手动登录。（注：网易服务端 session 已失效时写回无效，仍需真登录——
// 恢复后会让用户刷新页面确认，并给出提示。）
const CBG_ORIGIN = 'https://xyq.cbg.163.com'
const LOGIN_COOKIE_KEYS = ['P_INFO', 'NTES_PASSPORT', 'NTES_SESS', 'NTES_SID', 'wb_gameid']

async function getCbgCookies() {
  // 登录态 Cookie（P_INFO/NTES_PASSPORT 等）多数设在 .163.com 根域或 cbg.163.com 子域。
  // 需 manifest 声明 https://*.163.com/* host 权限才能读取（否则静默返回空）。
  // 多路查询覆盖根域/各子域，最大化拿到登录态（含 HttpOnly），避免漏抓。
  const queries = [
    { domain: '163.com' },
    { domain: 'cbg.163.com' },
    { domain: 'xyq.cbg.163.com' },
    { url: 'https://cbg.163.com' },
    { url: CBG_ORIGIN },
  ]
  const map = new Map()
  for (const q of queries) {
    try {
      const list = await chrome.cookies.getAll(q)
      for (const c of list) map.set(c.domain + '|' + c.name + '|' + c.path, c)
    } catch (e) {}
  }
  return [...map.values()]
}
async function hasLoginCookie() {
  const cs = await getCbgCookies()
  // 白名单命中任一已知鉴权 Cookie → 已登录
  if (cs.some((c) => LOGIN_COOKIE_KEYS.includes(c.name))) return true
  // 兜底：任意 163.com 域下的 Cookie 也视为已登录信号（不再漏判导致保活不触发）
  return cs.some((c) => (c.domain || '').endsWith('163.com'))
}
async function backupCookies() {
  const cs = await getCbgCookies()
  // 备份所有 163.com 域下的登录态 Cookie，不再依赖固定白名单，
  // 避免不同登录方式（邮箱/手机）真实鉴权 Cookie 名字不在列表里而备份为空。
  const sel = cs.filter((c) => (c.domain || '').endsWith('163.com'))
  if (!sel.length) {
    return { ok: false, error: '未检测到藏宝阁登录 Cookie，请先在藏宝阁官网登录' }
  }
  await chrome.storage.local.set({ cbgCookies: sel, cbgCookieBackupAt: Date.now() })
  return { ok: true, count: sel.length, at: Date.now() }
}
function cookieToUrl(c) {
  const proto = c.secure ? 'https' : 'http'
  let host = c.domain && c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
  // url host 必须在 cookie domain 作用域内；根域(.163.com) cookie 用具体子域作为
  // url host，否则 chrome.cookies.set 会因 host 不在 domain 范围内而静默失败。
  if (host === '163.com') host = 'cbg.163.com'
  return proto + '://' + host + (c.path || '/')
}
async function restoreCookies() {
  const { cbgCookies } = await chrome.storage.local.get('cbgCookies')
  if (!cbgCookies || !cbgCookies.length) {
    return { ok: false, error: '没有可用的登录备份，请先登录并点「备份当前登录」' }
  }
  let okCount = 0
  for (const c of cbgCookies) {
    const setObj = {
      url: cookieToUrl(c),
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
    }
    // host-only cookie 不能带 domain（带了会变成可被子域共享的域 cookie，
    // 部分站点鉴权校验会拒绝）；域 cookie(.163.com 等) 必须带 domain。
    if (c.domain && (c.domain.startsWith('.') || c.hostOnly === false)) {
      setObj.domain = c.domain
    }
    if (c.storeId) setObj.storeId = c.storeId
    if (c.expirationDate) setObj.expirationDate = c.expirationDate
    if (c.sameSite) setObj.sameSite = c.sameSite
    try {
      await chrome.cookies.set(setObj)
      okCount++
    } catch (e) {}
  }
  return { ok: true, count: okCount }
}

// ---------- 定时保活（续命服务端会话，减少被动登出）----------
// 藏宝阁登录态服务端有活跃超时，长时间无请求会被强制登出 → 表现为"又得手动登录"。
// 每隔若干分钟悄悄打开一个隐藏标签页访问登录态页面（请求自带登录 Cookie），
// 让服务端刷新会话活跃时间，从源头减少重登。仅当前确实已登录时才保活。
const KEEPALIVE_INTERVAL_MS = 20 * 60 * 1000 // 20 分钟（服务端会话可能短于 1 小时，缩短间隔确保续命及时）
const KEEPALIVE_URL = 'https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_overall_search_yupo'

async function keepAliveOnce(opts) {
  opts = opts || {}
  const enabled = (await chrome.storage.local.get('cbgKeepAliveEnabled')).cbgKeepAliveEnabled
  if (enabled === false) {
    console.log('[cbg] 保活已关闭，跳过')
    return { ok: false, skipped: 'disabled' }
  }
  // 没登录则保活无意义（也避免反复开空页面），恢复交给其他机制
  const hasLogin = await hasLoginCookie()
  if (!hasLogin) {
    console.log('[cbg] 未检测到登录 Cookie，跳过保活')
    return { ok: false, skipped: 'not_logged_in' }
  }
  console.log('[cbg] 开始保活：打开隐藏标签页访问', KEEPALIVE_URL)
  let tab
  try {
    tab = await chrome.tabs.create({ url: KEEPALIVE_URL, active: false })
  } catch (e) {
    console.error('[cbg] 打开保活标签页失败:', e.message)
    return { ok: false, error: '打开保活标签页失败: ' + e.message }
  }
  // 等页面请求发出（带登录 Cookie）即完成续命，无需等 DOM 渲染
  await sleep(8000)
  try { await chrome.tabs.remove(tab.id) } catch (e) {}
  await chrome.storage.local.set({ cbgKeepAliveAt: Date.now() })
  console.log('[cbg] 保活完成，时间:', new Date().toLocaleString())
  return { ok: true, at: Date.now() }
}

async function getToken() {
  let { cbgToken } = await chrome.storage.local.get('cbgToken')
  if (!cbgToken) {
    cbgToken = 'u_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
    await chrome.storage.local.set({ cbgToken })
  }
  return cbgToken
}

// 透传到后端；自动带上 X-User-Token 头
// 注意：fetch 不带超时，若后端(8006)进程卡死/写锁，await 会永久挂起 → collectSubscription 永远不返回
// → popup 永久卡「采集中」。故统一加 20s AbortController 超时，超时即抛错并向上带出可读提示。
async function api(path, method = 'GET', body = null, timeoutMs = 20000) {
  const token = await getToken()
  const ctrl = new AbortController()
  const tid = setTimeout(function () { ctrl.abort() }, timeoutMs)
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    signal: ctrl.signal,
  }
  if (body) opts.body = JSON.stringify(body)
  try {
    const res = await fetch(API_BASE + path, opts)
    if (!res.ok) throw new Error('后端 ' + API_BASE + path + ' 返回 ' + res.status)
    return await res.json()
  } finally {
    clearTimeout(tid)
  }
}

// 对需要 user_token 写在请求体里的接口，自动注入 token 到 body
async function apiBody(path, method, body) {
  const token = await getToken()
  return api(path, method, { ...body, user_token: token })
}

// ---------- 自动采集调度（订阅） ----------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 等待标签页完成加载并确认 content script 已注入（返回 true 表示就绪）。
// SW 通过 chrome.tabs.create 新建的标签页存在 content script 注入时序竞争：
// document_idle 注入可能晚于首次 sendMessage，导致 "Receiving end does not exist"。
// 策略：轮询 tab 状态直到 complete 且域名匹配，并探活 GET_PAGE；超时则强制用
// chrome.scripting.executeScript 注入 content.js 一次再探活（content.js 内有一次性
// 注册标志，重复注入不会重复注册监听器）。
async function waitTabReadyAndInject(tabId, timeoutMs) {
  const total = timeoutMs || 12000
  const deadline = Date.now() + total
  const start = Date.now()
  let forceInjected = false
  const probe = async function () {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE' })
      return true
    } catch (e) {
      return false
    }
  }
  while (Date.now() < deadline) {
    let tabInfo = null
    try { tabInfo = await chrome.tabs.get(tabId) } catch (e) { return false }
    if (!tabInfo) return false
    const okUrl = /xyq\.cbg\.163\.com/.test(tabInfo.url || '')
    // 不要求 status==='complete'：CBG 页面常驻连接导致 complete 迟迟不来，白等 25s 反而拖慢采集；
    // 只要 content script 已注入（探针通过）即可开始 fetch（同源请求即便页面未完全渲染也能发出）。
    if (okUrl && (await probe())) return true
    // 已等待 ~2s 仍未注入（可能 document_idle 延迟）→ 强制注入一次再探活
    if (!forceInjected && Date.now() - start >= 2000) {
      forceInjected = true
      try {
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] })
        await sleep(500)
        if (await probe()) return true
      } catch (e) {}
    }
    await sleep(1000)
  }
  // 最终兜底：再强制注入一次
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] })
    await sleep(600)
    if (await probe()) return true
  } catch (e) {}
  return false
}

// 给 chrome.tabs.sendMessage 加超时兜底：content script 若因任何原因迟迟不调 sendResponse
// （如 fetch 卡死），避免 collectSubscription 永久挂起、popup 一直转圈到 150s 超时。
async function sendMsgWithTimeout(tabId, msg, ms) {
  const timeoutErr = new Promise(function (_, rej) {
    setTimeout(function () {
      rej(new Error('标签页采集无响应（>' + (ms / 1000) + 's），可能藏宝阁接口卡住或页面已关闭'))
    }, ms)
  })
  return Promise.race([chrome.tabs.sendMessage(tabId, msg), timeoutErr])
}

// 打开后台标签页（藏宝阁任意页面，保证登录态 cookie），直调 recommend.py 拿结果入库
// 采集并发锁：定时器自动采集与用户手动「立即采集」可能同时触发，
// 两路请求叠加会显著放大被藏宝阁风控命中的概率。同一时刻只允许一个采集任务运行，
// 后来的直接返回提示，不开标签页、不打请求。
let __collecting = false

async function collectSubscription(sub) {
  if (__collecting) {
    return {
      ok: false,
      scanned: 0,
      captured: 0,
      error: '已有采集任务正在进行中，请等它结束后再试（避免请求叠加触发藏宝阁风控）',
    }
  }
  __collecting = true
  try {
    return await collectSubscriptionInner(sub)
  } finally {
    __collecting = false
  }
}

async function collectSubscriptionInner(sub) {
  const url = sub && sub.search_url
  if (!url) return { ok: false, error: '订阅缺少 search_url' }
  // 从 conditions_json 解析订阅类型与角色搜索参数
  let cond = {}
  try { cond = sub.conditions_json ? JSON.parse(sub.conditions_json) : {} } catch (e) {}
  const isRole = cond.type === 'role'
  let roleArgs = null
  if (isRole) roleArgs = cond.role || {}
  let tabId = null
  let created = false
  const tabUrl = isRole
    ? 'https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_search_role_form'
    : 'https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_overall_search_yupo'
  try {
    // 优先复用用户已打开的藏宝阁标签页（通常前台、热会话，fetch 最快且不被隐藏页网络限速）；
    // 仅当没有任何 cbg 页时才新建后台标签页。复用前台页可根除「很久才开始采集」与冷会话超时。
    const existing = await chrome.tabs.query({ url: 'https://xyq.cbg.163.com/*' })
    if (existing && existing.length) {
      tabId = existing[0].id
      console.log('[cbg] 复用已存在藏宝阁标签页 tabId:', tabId)
    } else {
      const nt = await chrome.tabs.create({ url: tabUrl, active: false })
      tabId = nt.id
      created = true
      console.log('[cbg] 打开标签页 URL:', tabUrl)
    }
  } catch (e) {
    return { ok: false, error: '打开标签页失败: ' + e.message }
  }
  let items = []
  let lastErr = ''
  let triedRestore = false
  // 确认 content script 已注入：复用页探针即可（用户重载扩展后该页需 Cmd+Shift+R 才注入）；
  // 新建后台页则在 2s 后强制注入再探活（不要求 status=complete，CBG 常驻连接导致 complete 迟迟不来）。
  const ready = await waitTabReadyAndInject(tabId, created ? 12000 : 8000)
  if (!ready) {
    lastErr = '藏宝阁标签页未能就绪（content script 未注入）。请确认扩展已重载、藏宝阁页面可正常打开，或手动打开藏宝阁页面后再点「立即采集」。'
  }
  // 等 content script 就绪后采集（最多 2 次：仅登录过期自动恢复重试一次，其余错误立即结束）
  for (let attempt = 0; attempt < 2 && items.length === 0; attempt++) {
    if (!ready) break
    await sleep(800)
    try {
      let r
      if (isRole) {
        // 角色搜索：调用 recommend.py 接口，fetchAll=true 翻页采集所有页
        console.log('[cbg] 发送 FETCH_ROLE_SEARCH, args:', JSON.stringify(roleArgs))
        r = await sendMsgWithTimeout(tabId, { type: 'FETCH_ROLE_SEARCH', args: roleArgs, fetchAll: true }, 120000)
      } else {
        // 玉魄/装备：直调 recommend.py（JSON 接口，同源带 cookie）
        r = await sendMsgWithTimeout(tabId, { type: 'FETCH_RECOMMEND', url: url, fetchAll: true }, 120000)
      }
      console.log('[cbg] 采集响应 attempt=' + attempt, JSON.stringify(r && { ok: r.ok, count: r.count, error: r.error, warn: r.warn }))
      if (r && r.ok && r.items && r.items.length) {
        items = r.items
        break
      }
      if (r && r.error) {
        lastErr = r.error
        // 登录态过期：先尝试自动恢复登录态（写回备份 Cookie）+ 刷新标签页，给一次重试机会；
        // 若恢复后仍过期（服务端 session 已死），则中断把原因带出去提示真登录。
        if (/登陆过期|登录过期|SESSION_TIMEOUT|会话过期|将军令|重新登录/i.test(r.error)) {
          if (!triedRestore) {
            triedRestore = true
            try {
              const rr = await restoreCookies()
              if (rr && rr.ok) {
                await chrome.tabs.reload(tabId)
                await sleep(2500)
                continue
              }
            } catch (e) {}
          }
        }
        // 非登录过期类错误（含请求超时/无响应）：不再盲目重试，直接结束避免累计超时报「采集超时」
        break
      }
    } catch (e) {
      lastErr = e.message
      break
    }
  }
  let captured = 0
  // 从订阅 conditions_json 推断 item_type（角色订阅有 type=role，玉魄订阅有 scope 等）
  let itemType = 'equip'
  try {
    const c = sub.conditions_json ? JSON.parse(sub.conditions_json) : {}
    if (c.type === 'role') itemType = 'role'
    else if (c.scope || (c.yupo)) itemType = 'yupo'
  } catch (e) {}
  if (items.length) {
    const rr = await apiBody('/api/cbg/capture', 'POST', {
      label: sub.label || '未分类',
      subscription_id: String(sub.id),
      item_type: itemType,
      items: items,
    })
    console.log('[cbg] 入库响应:', JSON.stringify(rr), '首条 item:', JSON.stringify(items[0]))
    captured = (rr && rr.captured) || 0
  }
  // 回写运行时间与采集结果（last_run=now, next_run=now+interval, last_result=诊断信息）
  try {
    await api('/api/cbg/subscriptions/' + encodeURIComponent(sub.id) + '/ran', 'POST', {
      scanned: items.length,
      captured: captured,
      error: lastErr || null,
    })
  } catch (e) {}
  // 采集完成，仅当本次新建了后台标签页时才关闭（复用用户已有的前台页绝不能关掉）
  if (created) {
    try { await chrome.tabs.remove(tabId) } catch (e) {}
  }
  console.log('[cbg] 采集完成，已关闭标签页 tabId:', tabId)
  // 登录态过期单独给出可读提示，方便弹窗/前端直接展示
  if (/登陆过期|登录过期|SESSION_TIMEOUT|会话过期|将军令|重新登录/i.test(lastErr || '')) {
    return { ok: false, scanned: 0, captured: 0, need_login: true, error: '藏宝阁登录已过期，请先在藏宝阁官网重新登录，再点「立即采集」' }
  }
  // 验证码风控：采集/翻页太频繁触发，需手动去藏宝阁页面完成验证或等冷却
  if (/验证码|captcha|CAPTCHA/i.test(lastErr || '')) {
    return { ok: false, scanned: 0, captured: 0, need_captcha: true, error: '藏宝阁触发验证码风控，请去藏宝阁页面手动完成一次验证，或等几分钟再试' }
  }
  return { ok: true, scanned: items.length, captured: captured, error: lastErr }
}

async function runDueSubscriptions() {
  try {
    const due = await api('/api/cbg/subscriptions/due')
    const list = (due && due.subscriptions) || []
    for (const sub of list) {
      try {
        await collectSubscription(sub)
      } catch (e) {
        console.warn('[cbg] collectSubscription failed', e)
      }
    }
  } catch (e) {
    // 后端未运行等：忽略
  }
}

function ensureAlarms() {
  // 每 30 秒唤醒一次（Chrome 最小周期）；订阅是否到点由后端 next_run 决定，到点才真正采集。
  // 立即采集依赖此定时器感知 next_run 变化，周期越短点击后等待越短。
  chrome.alarms.create('cbg-tick', { periodInMinutes: 0.5 })
}

// SW 每次被唤醒都会重新执行顶层代码，这里主动确保 alarm 存在，
// 避免重载/更新/休眠后 alarm 丢失导致调度永久停摆。
try { ensureAlarms() } catch (e) {}
chrome.runtime.onInstalled.addListener(ensureAlarms)
chrome.runtime.onStartup.addListener(ensureAlarms)
chrome.runtime.onStartup.addListener(async () => {
  // 启动即检测：本地无登录 Cookie 但有备份 → 尝试自动恢复，省去手动重登
  try {
    if (!(await hasLoginCookie())) await restoreCookies()
  } catch (e) {}
})
// 定时保活检查：距上次保活超过间隔则续命一次（仅已登录时才做）
async function keepAliveCheck() {
  const { cbgKeepAliveAt } = await chrome.storage.local.get('cbgKeepAliveAt')
  const last = cbgKeepAliveAt || 0
  const elapsed = Date.now() - last
  console.log('[cbg] 保活检查: 距上次', Math.round(elapsed / 60000), '分钟, 间隔', KEEPALIVE_INTERVAL_MS / 60000, '分钟')
  if (elapsed >= KEEPALIVE_INTERVAL_MS) {
    console.log('[cbg] 保活间隔已到，执行保活')
    await keepAliveOnce()
  } else {
    console.log('[cbg] 保活间隔未到，跳过')
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === 'cbg-tick') {
    try { ensureAlarms() } catch (e) {}  // 双保险：alarm 触发时重新确认
    // 到点才保活：每分钟唤醒里检查间隔，仅超时才真正访问藏宝阁续命
    keepAliveCheck().catch(() => {})
    runDueSubscriptions()
  }
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    try {
      if (msg.type === 'STATUS') {
        await chrome.storage.local.set({ loggedIn: !!msg.loggedIn })
        // 登录态丢失且有备份 → 后台尝试自动恢复（不阻塞响应）
        if (!msg.loggedIn) {
          try {
            const { cbgCookies } = await chrome.storage.local.get('cbgCookies')
            if (cbgCookies && cbgCookies.length) restoreCookies().catch(() => {})
          } catch (e) {}
        }
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'GET_STATUS') {
        const { cbgToken, loggedIn } = await chrome.storage.local.get(['cbgToken', 'loggedIn'])
        sendResponse({ ok: true, token: cbgToken, loggedIn: !!loggedIn })
        return
      }
      if (msg.type === 'BACKUP_LOGIN') {
        const r = await backupCookies()
        sendResponse(r)
        return
      }
      if (msg.type === 'RESTORE_LOGIN') {
        const r = await restoreCookies()
        sendResponse(r)
        return
      }
      if (msg.type === 'GET_LOGIN_BACKUP') {
        const { cbgCookieBackupAt } = await chrome.storage.local.get('cbgCookieBackupAt')
        sendResponse({ ok: true, at: cbgCookieBackupAt || null })
        return
      }
      if (msg.type === 'GET_KEEPALIVE') {
        const { cbgKeepAliveEnabled, cbgKeepAliveAt } = await chrome.storage.local.get([
          'cbgKeepAliveEnabled',
          'cbgKeepAliveAt',
        ])
        sendResponse({ ok: true, enabled: cbgKeepAliveEnabled !== false, at: cbgKeepAliveAt || null })
        return
      }
      if (msg.type === 'KEEPALIVE_NOW') {
        const r = await keepAliveOnce({ force: true })
        sendResponse(r)
        return
      }
      if (msg.type === 'GET_PAGE') {
        // 弹窗要实时向当前藏宝阁标签页的 content script 询问页面信息
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]
        if (!tab || !/xyq\.cbg\.163\.com/.test(tab.url || '')) {
          sendResponse({ ok: false, error: '当前没有打开藏宝阁页面' })
          return
        }
        try {
          const page = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE' })
          sendResponse(page || { ok: false, error: '页面未响应' })
        } catch (e) {
          sendResponse({ ok: false, error: e.message })
        }
        return
      }
      if (msg.type === 'LIST_WATCH') {
        const r = await api('/api/cbg/watch')
        sendResponse(r)
        return
      }
      if (msg.type === 'ADD_WATCH') {
        const r = await apiBody('/api/cbg/watch', 'POST', msg)
        sendResponse(r)
        return
      }
      if (msg.type === 'DEL_WATCH') {
        const r = await api('/api/cbg/watch?ordersn=' + encodeURIComponent(msg.ordersn), 'DELETE')
        sendResponse(r)
        return
      }
      if (msg.type === 'GET_HISTORY') {
        const r = await api('/api/cbg/history?ordersn=' + encodeURIComponent(msg.ordersn))
        sendResponse(r)
        return
      }
      if (msg.type === 'GET_DEALS') {
        const r = await api('/api/cbg/deals?ordersn=' + encodeURIComponent(msg.ordersn))
        sendResponse(r)
        return
      }
      if (msg.type === 'IMPORT_ITEMS') {
        const r = await apiBody('/api/cbg/import', 'POST', { items: msg.items })
        sendResponse(r)
        return
      }
      if (msg.type === 'CAPTURE_ITEMS') {
        const r = await apiBody('/api/cbg/capture', 'POST', {
          label: msg.label,
          item_type: msg.item_type,
          items: msg.items,
        })
        sendResponse(r)
        return
      }
      if (msg.type === 'RUN_SUBSCRIPTION') {
        // 弹窗「立即采集此订阅」：拿到订阅数据直接跑一次（不等定时器）
        const sub = msg.sub
        if (!sub || !sub.search_url) {
          sendResponse({ ok: false, error: '订阅数据缺失' })
          return
        }
        collectSubscription(sub)
          .then((r) => sendResponse(r))
          .catch((e) => sendResponse({ ok: false, error: e.message }))
        return true // 保持异步响应通道
      }
      if (msg.type === 'REFRESH_STATUS') {
        // 拉库内所有 eid → 让当前已登录的 cbg 标签页逐个核验 → 回写后端
        const ids = await api('/api/cbg/capture/ids')
        const items = (ids && ids.items) || []
        if (!items.length) {
          sendResponse({ ok: true, done: 0, updated: 0, message: '藏品库为空' })
          return
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        let tab = tabs[0]
        if (!tab || !/xyq\.cbg\.163\.com/.test(tab.url || '')) {
          const all = await chrome.tabs.query({ url: 'https://xyq.cbg.163.com/*' })
          if (!all.length) {
            sendResponse({ ok: false, error: '请先打开一个已登录的藏宝阁页面' })
            return
          }
          tab = all[0]
        }
        const checked = await chrome.tabs.sendMessage(tab.id, {
          type: 'CHECK_STATUS',
          items: items,
        })
        const results = (checked && checked.results) || []
        let updated = 0
        for (const r of results) {
          if (r.eid && r.status) {
            await api(
              '/api/cbg/item/' + encodeURIComponent(r.eid) + '/status',
              'PUT',
              { status: r.status }
            )
            updated++
          }
        }
        sendResponse({ ok: true, done: results.length, updated: updated })
        return
      }
      if (msg.type === 'ADD_SNAPSHOT') {
        const r = await apiBody('/api/cbg/snapshot', 'POST', msg.item)
        sendResponse(r)
        return
      }
      if (msg.type === 'BRIDGE_DATA') {
        // bridge 回传的抓取结果，按 kind 上报
        const payload = msg.payload || {}
        if (payload.kind === 'my_equips_items') {
          const r = await apiBody('/api/cbg/import', 'POST', { items: payload.items })
          sendResponse(r)
          return
        }
        if (payload.kind === 'equip_detail') {
          const r = await apiBody('/api/cbg/snapshot', 'POST', payload.item)
          sendResponse(r)
          return
        }
        if (payload.kind === 'deals') {
          const r = await apiBody('/api/cbg/deals', 'POST', {
            ordersn: payload.ordersn,
            deals: payload.deals,
          })
          sendResponse(r)
          return
        }
        sendResponse({ ok: true, ignored: payload.kind })
        return
      }
      if (msg.type === 'LIST_SUBS') {
        const r = await api('/api/cbg/subscriptions')
        sendResponse(r)
        return
      }
      if (msg.type === 'DEL_SUB') {
        const r = await api('/api/cbg/subscriptions/' + encodeURIComponent(msg.id), 'DELETE')
        sendResponse(r)
        return
      }
      sendResponse({ ok: false, error: 'unknown type' })
    } catch (e) {
      sendResponse({ ok: false, error: e.message })
    }
  })()
  return true // 保持异步响应通道
})
