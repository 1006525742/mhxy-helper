// 本地访问统计埋点（零依赖，失败静默，绝不影响业务）
// 每次路由切换调用 trackEvent(module, path)，上报到 /api/analytics/track。
// 用户以匿名随机 ID（localStorage）标识，无 PII。

const VID_KEY = 'mhxy_analytics_vid'
const SID_KEY = 'mhxy_analytics_sid'
const ENDPOINT = '/api/analytics/track'

function uuid(): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* fallthrough to fallback */
    }
  }
  // 非安全上下文（如 http://局域网IP）crypto.randomUUID 不可用时的兜底
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function getVid(): string {
  try {
    let v = localStorage.getItem(VID_KEY)
    if (!v) {
      v = uuid()
      localStorage.setItem(VID_KEY, v)
    }
    return v
  } catch {
    return uuid()
  }
}

function getSid(): string {
  try {
    let v = sessionStorage.getItem(SID_KEY)
    if (!v) {
      v = uuid()
      sessionStorage.setItem(SID_KEY, v)
    }
    return v
  } catch {
    return uuid()
  }
}

/**
 * 上报一次事件。module=路由名，path=完整路径。
 * count：一次事件代表的次数（>1 用于批量上报，如敲木鱼连点），服务端按 SUM(count) 统计。
 */
export function trackEvent(module: string, path: string, type = 'page_view', count = 1): void {
  try {
    const payload = JSON.stringify({
      module,
      path,
      type,
      count: count > 0 ? count : 1,
      vid: getVid(),
      sid: getSid(),
      ts: Date.now(),
      referer: document.referrer || '',
      ua: navigator.userAgent,
    })
    // 优先 sendBeacon（更可靠，不阻塞导航）；失败则降级 fetch(keepalive)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }))
        return
      } catch {
        /* fallthrough */
      }
    }
    fetch(ENDPOINT, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 静默：统计失败绝不影响网站 */
  }
}
