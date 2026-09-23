/**
 * 消息推送服务（复刻 / 替代原站「发送通知」）
 *
 * 支持三种渠道（页面内单选其一）：
 *
 *  1) 企业微信群机器人 webhook（pushWecom）
 *     - 企业微信 webhook 不支持浏览器 CORS 预检（OPTIONS 直接 403，无 Access-Control-Allow-Origin）。
 *     - 改用 mode:'no-cors' + Content-Type:'text/plain'：text/plain 属「简单请求」不触发预检，
 *       浏览器仍真实发出请求，服务端正常解析（实测 dummy key 返回 invalid key，证明已送达）。
 *     - 代价：no-cors 下拿不到响应，前端无法确认投递结果——fire-and-forget。
 *
 *  2) QQ 邮箱（pushQqMail） 浏览器无法直连 SMTP，由自建 backend_notify 代发。
 *
 *  3) 微信（pushWechat） 微信测试号模板消息，由自建 backend_notify 代发，按备注名匹配 openid。
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

/**
 * 校验微信 openid（关注测试号后分配，28 位左右字母数字）
 */
export function isValidWechatOpenid(openid: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test((openid || '').trim())
}

/**
 * 微信测试号（公众号测试号）模板消息推送。
 *
 * 浏览器无法直连微信 API（CORS + appsecret 不能暴露），故 POST 到自建 backend_notify 代发；
 * appID / appsecret / 模板ID 只配在后端；接收人只填「备注名」，openid 映射由后端维护
 * （外网用户看不到 openid，也不能自行新增，需联系管理员登记）。前端能拿到真实回执。
 *
 * @param receiver 接收人备注名（后端 /api/wechat/receivers 里登记的名称）
 * @param title 模板 first 字段（标题）
 * @param content 模板正文
 * @param apiBase 微信推送接口地址，默认 http://127.0.0.1:8011/api/notify/wechat
 */
export async function pushWechat(
  receiver: string,
  title: string,
  content: string,
  apiBase = 'http://127.0.0.1:8011/api/notify/wechat'
): Promise<PushResult> {
  const name = (receiver || '').trim()
  if (!name) return { ok: false, err: '接收人备注名为空（请输入管理员分配给你的接收人名称）' }
  const base = (apiBase || '').trim()
  if (!base) return { ok: false, err: '微信接口地址为空' }
  try {
    const resp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiver: name, title, content })
    })
    const data = await resp.json().catch(() => null)
    // 后端成功返回 {"success": true, ...}
    if (data && data.success === true) return { ok: true }
    return { ok: false, err: data?.msg || `推送失败（HTTP ${resp.status}）` }
  } catch (e) {
    return { ok: false, err: (e as Error)?.message || 'network error' }
  }
}
