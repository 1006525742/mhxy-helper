// bridge.js - 注入到藏宝阁页面上下文（page context）
// 作用：在同源页面里发起请求，自动带上用户的 cookie（无 CORS 问题），
//       并通过 window.postMessage 与 content.js 通信。
//
// 关于签名：藏宝阁多数 act=ajax_* 接口需要 token/timestamp/verify 签名，
// 该签名由官方前端自带。本桥接层运行在官方页面上下文里，可以复用页面自己的
// 请求机制；对需要主动拉取的接口，sign() 默认返回未签名参数（见下方说明）。
// 主数据链路（content.js 抓取已渲染 DOM）完全不需要签名即可工作。

;(function () {
  const BRIDGE_ID = 'CBG_BRIDGE'

  // ---------------------------------------------------------------------------
  // 签名（占位 + 文档）
  // 163 的 verify 算法是混淆的。规则参考：通常 verify = md5(timestamp + salt)，
  // 其中 salt 由页面运行时持有。最稳妥的做法是复用页面自带签名——如果你在
  // DevTools 里看到类似 window.NetEase.sign / MooTools 的 Request 包装，可在
  // 此处调用它。下面给出未签名默认实现，便于对"不强制验签"的接口做主动拉取。
  // ---------------------------------------------------------------------------
  function getServerTime() {
    // CBG 页面常暴露服务器时间，可在此读取；默认用本地时间
    return Math.floor(Date.now() / 1000)
  }

  function sign(act, params) {
    const ts = getServerTime()
    // TODO(可选): 如需主动拉取带验签接口，在此根据页面全局变量实现 verify。
    // 例如: verify = md5(ts + pageSalt)
    return Object.assign({ act: act, timestamp: ts, verify: '' }, params || {})
  }

  // 同源 GET；cookie 自动随请求发送
  async function cbgFetch(act, params, opts) {
    opts = opts || {}
    const q = sign(act, params)
    const cgi = opts.cgi || 'equip.py'
    const url =
      'https://xyq.cbg.163.com/cgi-bin/' +
      cgi +
      '?' +
      new URLSearchParams(q).toString()
    const res = await fetch(url, {
      credentials: 'include',
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch (e) {
      return { __html: text }
    }
  }

  // 暴露给页面/DevTools 调试用
  window.__cbgBridge = {
    cbgFetch: cbgFetch,
    sign: sign,
    version: '0.1.0',
  }

  // content.js 通过 postMessage 请求本桥接层发起请求 / 解密 other_info
  window.addEventListener('message', function (e) {
    const d = e.data
    if (!d || d.__cbgBridge !== BRIDGE_ID) return
    if (d.cmd === 'FETCH') {
      cbgFetch(d.act, d.params, d.opts)
        .then(function (r) {
          window.postMessage({ __cbgBridge: BRIDGE_ID, id: d.id, result: r }, '*')
        })
        .catch(function (err) {
          window.postMessage(
            { __cbgBridge: BRIDGE_ID, id: d.id, error: String(err) },
            '*'
          )
        })
    }
    // 解密 other_info：调用页面自带的 decode_desc（LPC 加密串，依赖 cookie _k）
    if (d.cmd === 'DECODE') {
      const arr = d.items || []
      const hasDecode = typeof window.decode_desc === 'function'
      const out = arr.map(function (x) {
        try {
          return window.decode_desc ? window.decode_desc(x) : x
        } catch (err) {
          return x
        }
      })
      window.postMessage(
        {
          __cbgBridge: BRIDGE_ID,
          id: d.id,
          result: out,
          debug: {
            hasDecode: hasDecode,
            inLen: arr[0] ? String(arr[0]).length : 0,
            inHead: arr[0] ? String(arr[0]).slice(0, 30) : '',
            inTail: arr[0] ? String(arr[0]).slice(-12) : '',
            outHead: out[0] ? String(out[0]).slice(0, 120) : '',
            changed: out[0] !== arr[0],
          },
        },
        '*'
      )
    }
  })

  // 通知 content.js 桥接已就绪
  window.postMessage({ __cbgBridge: BRIDGE_ID, ready: true }, '*')
})()
