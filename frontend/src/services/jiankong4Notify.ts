/**
 * 消息推送服务（复刻 / 替代原站「发送通知」）
 *
 * 支持三种渠道：
 *
 *  1) 企业微信群机器人 webhook（pushWecom）
 *     - 企业微信 webhook 不支持浏览器 CORS 预检（OPTIONS 直接 403，无 Access-Control-Allow-Origin）。
 *     - 改用 mode:'no-cors' + Content-Type:'text/plain'：text/plain 属「简单请求」不触发预检，
 *       浏览器仍真实发出请求，服务端正常解析（实测 dummy key 返回 invalid key，证明已送达）。
 *     - 代价：no-cors 下拿不到响应，前端无法确认投递结果——fire-and-forget。
 *
 *  2) PushPlus（pushPushPlus）  https://www.pushplus.plus
 *     - 实测支持浏览器 CORS 预检（OPTIONS 返回 Access-Control-Allow-Origin 等头），
 *       可用标准 application/json + 正常 fetch 直连，前端能读到结构化 JSON 响应、确认成功/失败。
 *     - 免费实名用户每天 200 条，个人挂机监控足够；消息推送到微信公众号（在个人微信里收）。
 */

export interface PushResult {
  ok: boolean
  err?: string
}

/** 校验用户填写的 webhook 是否为合法的企业微信机器人地址 */
export function isValidWecomWebhook(url: string): boolean {
  const u = (url || '').trim()
  if (!u) return false
  if (!/^https:\/\//.test(u)) return false
  return u.includes('qyapi.weixin.qq.com') && u.includes('key=')
}

/** 校验 PushPlus token（非空即可，通常 32 位 hex） */
export function isValidPushPlusToken(token: string): boolean {
  return (token || '').trim().length > 0
}

/**
 * 向企业微信群机器人推送一条文本消息。
 * @param webhookUrl 形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 * @param content 文本正文（\n 换行，上限 2048 字节）
 */
export async function pushWecom(webhookUrl: string, content: string): Promise<PushResult> {
  if (!isValidWecomWebhook(webhookUrl)) {
    return { ok: false, err: 'webhook 地址不合法（需为 qyapi.weixin.qq.com 且含 key=）' }
  }
  try {
    await fetch(webhookUrl.trim(), {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content }
      })
    })
    // no-cors：网络成功即视为已发出（无法读取响应体）
    return { ok: true }
  } catch (e) {
    return { ok: false, err: (e as Error)?.message || 'network error' }
  }
}

/**
 * 推送消息到 PushPlus（默认微信公众号渠道，在个人微信里收）。
 * @param token 用户 token（pushplus.plus 个人中心复制）
 * @param title 标题（不能含换行）
 * @param content 正文（html 模板，支持 <br/> 换行）
 * @param channel 渠道，默认 wechat（微信公众号）
 */
export async function pushPushPlus(
  token: string,
  title: string,
  content: string,
  channel = 'wechat'
): Promise<PushResult> {
  const t = (token || '').trim()
  if (!t) return { ok: false, err: 'PushPlus token 为空' }
  try {
    const resp = await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t, title, content, channel, template: 'html' })
    })
    const data = await resp.json().catch(() => null)
    // PushPlus 成功返回 code === 200
    if (data && data.code === 200) return { ok: true }
    return { ok: false, err: data?.msg || `推送失败（HTTP ${resp.status}）` }
  } catch (e) {
    return { ok: false, err: (e as Error)?.message || 'network error' }
  }
}

/**
 * 校验 QQ 号（纯数字，5~12 位）
 */
export function isValidQqNumber(qq: string): boolean {
  return /^\d{5,12}$/.test((qq || '').trim())
}

/**
 * QQ 邮箱推送（复刻原站 /api/Email?QQ=xxx&type=xxx 那套「填 QQ 号 → 发到 QQ号@qq.com」）。
 *
 * 浏览器无法直连 SMTP，故 POST 到自建 backend_notify 服务代发；
 * 发件邮箱与 SMTP 授权码只配在后端，不进浏览器。
 *
 * @param qq 接收提醒的 QQ 号（实际收件人为 `${qq}@qq.com`）
 * @param title 邮件标题
 * @param content 正文（\n 换行，由后端转 <br/>）
 * @param apiBase 邮件接口地址，默认 http://127.0.0.1:8011/api/notify/qqmail（与 backend_notify 端口一致）
 */
export async function pushQqMail(
  qq: string,
  title: string,
  content: string,
  apiBase = 'http://127.0.0.1:8011/api/notify/qqmail'
): Promise<PushResult> {
  const q = (qq || '').trim()
  if (!isValidQqNumber(q)) return { ok: false, err: 'QQ 号不合法（应为 5~12 位纯数字）' }
  const base = (apiBase || '').trim()
  if (!base) return { ok: false, err: '邮件接口地址为空' }
  try {
    const resp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qq: q, title, content, type: 'jiankong4' })
    })
    const data = await resp.json().catch(() => null)
    // 后端成功返回 {"success": true, ...}（对齐原站 /api/Email 响应结构）
    if (data && data.success === true) return { ok: true }
    return { ok: false, err: data?.msg || data?.errmsg || `推送失败（HTTP ${resp.status}）` }
  } catch (e) {
    return { ok: false, err: (e as Error)?.message || 'network error' }
  }
}
