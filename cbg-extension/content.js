// content.js - 运行在藏宝阁页面（隔离的 content script 上下文）
// 职责：注入 bridge.js；识别页面类型；从已渲染 DOM 提取数据；上报 background。
// 说明：本文件不持有 cookie/密码，登录态由用户在官网自己产生。数据仅通过
//       background 上报到本机 8006 后端（按 user_token 隔离）。
//
// 校准：打开藏宝阁页面后按 F12 → Console，输入 __cbgDebug() 可重新提取并打印
//       当前页识别到的字段，对照真实 DOM 微调下方选择器。

;(function () {
  const BRIDGE = 'CBG_BRIDGE'
  let scanned = false

  function injectBridge() {
    const s = document.createElement('script')
    // 加版本号防缓存：重载扩展后确保加载最新的 bridge.js（含 DECODE 解密）
    s.src = chrome.runtime.getURL('bridge.js') + '?v=2'
    s.onload = function () {
      s.remove()
    }
    ;(document.head || document.documentElement).appendChild(s)
  }

  // ---- 登录态检测（DOM 信号 + cookie 信号，两者任一即可）----
  function isLoggedIn() {
    if (
      document.querySelector('a[href*="act=my_equips"]') ||
      document.querySelector('.user-info') ||
      document.querySelector('#user_info') ||
      document.querySelector('.login-name') ||
      document.querySelector('.user-bar')
    ) {
      return true
    }
    const c = document.cookie || ''
    if (/wb_gameid=/.test(c) || /P_INFO=/.test(c) || /NTES_PASSPORT=/.test(c)) {
      return true
    }
    return false
  }

  function getParam(name) {
    return new URLSearchParams(location.search).get(name)
  }

  // 兼容藏宝阁新旧详情页参数：新版用 /equip?s=&eid=，老式用 ...&ordersn=&server_id=
  function getOrdersn() {
    return getParam('ordersn') || getParam('eid')
  }
  function getServerId() {
    return getParam('server_id') || getParam('s')
  }

  function parsePrice(text) {
    if (!text) return null
    const m = String(text).match(/[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
    return m ? parseFloat(m[1].replace(/,/g, '')) : null
  }

  // 在候选选择器里取第一个命中的文本（trim），exclude 含这些子串的跳过
  function pickText(selectors, exclude) {
    exclude = exclude || []
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i])
      const t = el && (el.textContent || '').trim()
      if (!t) continue
      if (exclude.some(function (w) { return t.indexOf(w) >= 0 })) continue
      return t
    }
    return null
  }

  // 同上，但限定在 root 容器内查找（用于主商品区，避免推荐列表干扰）；纯数字文本跳过
  function pickTextWithin(root, selectors, exclude) {
    if (!root) return null
    exclude = exclude || []
    for (let i = 0; i < selectors.length; i++) {
      const el = root.querySelector(selectors[i])
      const t = el && (el.textContent || '').trim()
      if (!t) continue
      if (/^\d+$/.test(t)) continue
      if (exclude.some(function (w) { return t.indexOf(w) >= 0 })) continue
      return t
    }
    return null
  }

  // 按字段标签（如"卖家""角色名""昵称"）从 li/td/.row 中提取冒号后的内容。
  // 比脆弱的绝对路径 selector 稳健：藏宝阁常用 <li><strong>标签：</strong>值</li> 结构。
  function extractFieldByLabel(labels) {
    const els = Array.prototype.slice.call(
      document.querySelectorAll('li, td, .row, div, p, span')
    )
    for (let i = 0; i < els.length; i++) {
      const t = (els[i].textContent || '').replace(/\s+/g, '').trim()
      if (!t || t.length > 60) continue
      // 只匹配 label 在文本开头的元素，避免命中父容器（如包裹 li 的大 div）
      let bestLab = null
      for (let j = 0; j < labels.length; j++) {
        const lab = labels[j]
        if (t.indexOf(lab) === 0 && (!bestLab || lab.length > bestLab.length)) {
          bestLab = lab
        }
      }
      if (bestLab) {
        const val = t.replace(bestLab, '').replace(/^[:：]\s*/, '').trim()
        if (val) return val
      }
    }
    return null
  }

  // 在候选选择器里取第一个命中的价格
  function pickPrice(selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i])
      const p = el && parsePrice(el.textContent)
      if (p != null) return p
    }
    return null
  }

  // 主商品信息区（藏宝阁详情头部）的常见容器，用于定位"当前商品"的价格/服务器，
  // 避免抓到页面下方的推荐列表
  function mainBox() {
    const sels = [
      '.detail-info', '.goods-info', '.equip-info', '.role-info', '.character-info',
      '.equip-detail', '.goods-detail', '.detail-wrap', '.info-wrap', '.product-info',
      '.commodity-info', '.item-info', '.trade-info', '.sale-info',
    ]
    for (let i = 0; i < sels.length; i++) {
      const el = document.querySelector(sels[i])
      if (el) return el
    }
    return null
  }

  // 智能取价：
  //   1) 主价强特征：文本带 "（元）" 单位标注（藏宝阁当前商品主价规范写法，
  //      如 "￥520.00（元）"）。推荐列表/同类对比价通常不带此后缀，据此排除干扰。
  //   2) 兜底：主商品区内 .price 优先；最后取排除干扰项后的最大金额。
  function smartPrice() {
    const all = priceCandidates().filter(function (c) {
      if (c.price == null) return false
      const t = c.text || ''
      return !/(钱包|余额|原价|基础|折合|参考|服务费|优惠|定金|预付|押金|总计|合计|手续费|担保)/.test(t)
    })
    if (!all.length) {
      return pickPrice(['#equip_price', '.price', '.goods-price', '.price-num', '.now-price', '[class*="price"]'])
    }
    const yuan = all.filter(function (c) { return /（元）|\(元\)/.test(c.text || '') })
    if (yuan.length) {
      yuan.sort(function (a, b) { return b.price - a.price })
      return yuan[0].price
    }
    const box = mainBox()
    if (box) {
      const p = parsePrice(
        ((box.querySelector('.price') || box.querySelector('#equip_price') || box.querySelector('.now-price') || {}).textContent || '')
      )
      if (p != null) return p
    }
    all.sort(function (a, b) { return b.price - a.price })
    return all[0].price
  }

  // 探测页面上所有"像是价格"的元素，供校准（__cbgDebug 会打印）
  function priceCandidates() {
    const sels = [
      '#equip_price',
      '.price',
      '.goods-price',
      '.price-num',
      '.now-price',
      '.amount',
      '[class*="price"]',
      '[class*="Price"]',
      '[class*="amount"]',
      '[class*="Amount"]',
      '[class*="jine"]',
      '[class*="Jine"]',
    ]
    const out = []
    const seen = new Set()
    for (let i = 0; i < sels.length; i++) {
      const nodes = document.querySelectorAll(sels[i])
      for (let n = 0; n < nodes.length; n++) {
        const txt = ((nodes[n].textContent || '').replace(/\s+/g, ' ').trim())
        if (!txt || seen.has(txt)) continue
        seen.add(txt)
        out.push({ sel: sels[i], text: txt.slice(0, 40), price: parsePrice(txt) })
      }
    }
    return out
  }

  // 清理服务器名：去掉"梦幻西游"游戏名、按 "-" 拆分只取第一段
  function cleanServerName(s) {
    if (!s) return s
    s = s.replace(/梦幻西游/g, '').replace(/[－-]/g, ' ').trim()
    s = (s.split(/\s+/)[0] || '').trim()
    return s || null
  }

  // 探测页面上所有"像是名称"的元素，供校准角色名/服务器名（__cbgDebug 会打印）
  function nameCandidates() {
    const sels = [
      'h1', 'h2', '.title', '.name', '.role-name', '.server-name',
      '.server', '#server_name', '#equip_name', '.goods-name', '.goods-title',
      '.account-name', '.nickname', '.crumb', '.breadcrumb', '.column-title',
      '.detail-title', '.seller-name',
    ]
    const out = []
    const seen = new Set()
    for (let i = 0; i < sels.length; i++) {
      const nodes = document.querySelectorAll(sels[i])
      for (let n = 0; n < nodes.length; n++) {
        const txt = ((nodes[n].textContent || '').replace(/\s+/g, ' ').trim())
        if (!txt || seen.has(txt)) continue
        if (/(钱包|余额|>>|登录|退出|藏宝阁|客服|购物车|搜索)/.test(txt)) continue
        seen.add(txt)
        out.push({ sel: sels[i], text: txt.slice(0, 40) })
      }
    }
    if (document.title && !seen.has(document.title)) {
      out.push({ sel: 'title', text: document.title.slice(0, 60) })
    }
    return out
  }

  // 尝试从页面推断服务器名（精准锁定"当前商品"所在服务器，排除推荐区）
  function guessServerName() {
    const fromUrl = getParam('server_name')
    if (fromUrl) return cleanServerName(fromUrl)
    const sid = getServerId()
    // 当前商品的服务器链接，其 href 必含当前 server_id（s= 或 server_id=）
    const servers = Array.prototype.slice.call(
      document.querySelectorAll('a.server, .server, .server-name, #server_name, a[class*="server"]')
    )
    for (let i = 0; i < servers.length; i++) {
      const href = servers[i].getAttribute('href') || ''
      if (sid && (href.indexOf('s=' + sid) >= 0 || href.indexOf('server_id=' + sid) >= 0)) {
        const t = (servers[i].textContent || '').trim()
        if (t) return cleanServerName(t)
      }
    }
    // 兜底：主商品区内的 .server（推荐列表通常在区外）
    const box = mainBox()
    if (box) {
      const s = box.querySelector('.server') || box.querySelector('.server-name') || box.querySelector('#server_name')
      if (s && (s.textContent || '').trim()) return cleanServerName(s.textContent.trim())
    }
    // 再兜底：第一个非链接的 .server
    for (let i = 0; i < servers.length; i++) {
      if (servers[i].tagName === 'A') continue
      const t = (servers[i].textContent || '').trim()
      if (t) return cleanServerName(t)
    }
    if (servers.length) return cleanServerName((servers[0].textContent || '').trim())
    const t = document.title || ''
    const m = t.match(/([\u4e00-\u9fa5]{2,8})\s*服务器/)
    if (m) return cleanServerName(m[1])
    return null
  }

  // ---- 装备/角色详情页提取 ----
  function extractEquipDetail() {
    const ordersn = getOrdersn()
    if (!ordersn) return null
    const server_id = getServerId()

    // 角色/商品标识：
    //   1) 优先取真正的"角色名/昵称"字段
    //   2) 卖号场景下商品无独立角色名时，退而取"卖家"字段（卖家即该商品标识）
    //   3) 仍取不到再退回基于 class 的选择器探测
    const NICK = ['.role-name', '.role-nickname', '.nickname', '.character-name', '.name-card',
      '.player-name', '.rolename', '.c-nickname', '.nick', '.goods-name', '.goods-title',
      'h1.goods-title', '.item-name', '.prop-name', '#equip_name', '.equip-name', 'h1']
    const NICK_EXCLUDE = ['钱包', '余额', '>>', '登录', '退出', '藏宝阁', '客服', '物品详细信息', '角色', '账号']
    let equip_name = extractFieldByLabel([
      '角色名', '昵称', '角色昵称', '游戏昵称', '角色ID',
      '卖家', '出售方', '卖家昵称', '发布人',
    ])
    const box = mainBox()
    if (!equip_name && box) equip_name = pickTextWithin(box, NICK, NICK_EXCLUDE)
    if (!equip_name) equip_name = pickText(NICK, NICK_EXCLUDE)

    // 价格：用探测器收集所有类价格元素，排除干扰项后取主价
    let current_price = smartPrice()
    if (current_price == null) {
      const leaf = Array.prototype.find.call(
        document.querySelectorAll('*'),
        function (e) {
          return /价格|￥|¥/.test(e.textContent || '') && e.children.length === 0
        }
      )
      if (leaf) current_price = parsePrice(leaf.textContent)
    }

    // 同类/全服最低价：页面常含"同类最低""全服最低""比价"等字样
    let same_type_lowest = null
    const lowCands = Array.prototype.slice
      .call(document.querySelectorAll('*'))
      .filter(function (e) {
        const txt = e.textContent || ''
        // 必须同时含关键字和金额数字，排除仅含"同类最低"字样的标签（其金额在兄弟节点）
        return (
          /同类最低|全服最低|全服在售最低|比价/.test(txt) &&
          /\d/.test(txt) &&
          txt.length < 200
        )
      })
    // 取最内层候选（排除包含其他候选的祖先容器，避免取到整页/父级里的 .num）
    const lowEl = lowCands.find(function (c) {
      return !lowCands.some(function (o) {
        return o !== c && c.contains(o)
      })
    })
    if (lowEl) {
      // 优先：从关键字后取第一个金额，避免被页面里现价的 .num 干扰
      const m = (lowEl.textContent || '').match(
        /(?:同类最低|全服最低|全服在售最低|比价)[^\d]*([\d,]+(?:\.\d+)?)/
      )
      if (m) {
        same_type_lowest = parseFloat(m[1].replace(/,/g, ''))
      } else {
        const numEl = lowEl.querySelector('.num') || lowEl.querySelector('[class*="num"]')
        same_type_lowest = numEl ? parsePrice(numEl.textContent) : parsePrice(lowEl.textContent)
      }
    }

    let status = '在售'
    const body = document.body ? document.body.textContent || '' : ''
    if (/已成交|已购买|交易完成|已售出/.test(body)) status = '已售'
    else if (/已下架|已过期|已结束/.test(body)) status = '已下架'

    return {
      ordersn: ordersn,
      server_id: server_id,
      server_name: guessServerName(),
      equip_name: equip_name,
      current_price: current_price,
      same_type_lowest: same_type_lowest,
      status: status,
    }
  }

  // ---- 批量核验在售状态：在已登录域 fetch 详情页，正则判状态 ----
  async function checkStatusList(items) {
    const results = []
    for (const it of (items || [])) {
      const eid = it && it.eid
      if (!eid) {
        results.push({ eid: eid || '', status: '未知' })
        continue
      }
      const sid = it.server_id || ''
      const url =
        'https://xyq.cbg.163.com/equip?s=' +
        encodeURIComponent(sid) +
        '&eid=' +
        encodeURIComponent(eid)
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        const buf = await res.arrayBuffer()
        const text = new TextDecoder('gbk').decode(buf)
        let status = '在售'
        if (/已成交|已购买|交易完成|已售出/.test(text)) status = '已售'
        else if (/已下架|已过期|已结束|商品不存在|不存在|已失效/.test(text))
          status = '已下架'
        results.push({ eid: eid, status: status })
      } catch (e) {
        results.push({ eid: eid, status: '未知', error: String(e) })
      }
    }
    return results
  }

  // ---- 搜索/列表结果页：成批提取所有物品卡片 ----
  // 做法：找到页面内所有指向详情页的链接（/equip?s=&eid= 或 ordersn=），
  // 以其最近似"卡片容器"的祖先为一件物品，从卡片内取价格/名称/服务器/属性。
  // 详情页与列表页的区别：列表页存在多个详情链接。校准见 __cbgDebug() 打印的 listItems。
  function detailLinkOf(card) {
    return card.querySelector('a[href*="eid="], a[href*="ordersn="], a[href*="/equip"]')
  }

  function extractCardPrice(card) {
    const priceSels = [
      '.price', '.now-price', '.sale-price', '.goods-price', '.cur-price', '.p10000',
      '[class*="price"]', '[class*="Price"]', '[class*="amount"]', '[class*="Amount"]',
    ]
    let fallback = null
    for (let i = 0; i < priceSels.length; i++) {
      const nodes = card.querySelectorAll(priceSels[i])
      for (let n = 0; n < nodes.length; n++) {
        const t = (nodes[n].textContent || '').replace(/\s+/g, '')
        const p = parsePrice(t)
        if (p == null) continue
        // 优先带 ¥/元/价的，最像售价
        if (/[¥￥元价]/.test(t)) return p
        if (fallback == null) fallback = p
      }
    }
    if (fallback != null) return fallback
    // 兜底：卡片文本里找"¥数字"或"数字元"
    const m = (card.textContent || '').match(/[¥￥]\s*([\d,]+(?:\.\d+)?)/)
    if (m) return parseFloat(m[1].replace(/,/g, ''))
    return null
  }

  function extractCardServer(card, u) {
    const fromUrl = u.searchParams.get('server_name')
    if (fromUrl) return cleanServerName(fromUrl)
    const s = card.querySelector('.server, .server-name, [class*="server"], a.server')
    if (s && (s.textContent || '').trim()) return cleanServerName(s.textContent.trim())
    return null
  }

  function extractCardThumb(card) {
    // 角色/装备/玉魄卡头像是卡片主体图。提取策略（按优先级，向后兼容旧逻辑）：
    //  1) 带标识属性的主体 <img>（data_equip_name / data_highlights / 头像类 class）
    //  2) 任意有效的 <img>（兼容懒加载 data-src/data-original/data-lazy-src/data-srcset 等）
    //  3) CSS background-image 兜底（角色卡常用 background 而非 <img> 显示头像）
    const BAD = /^(data:|about:)/i
    const NON_ITEM = /logo|favicon|qrcode|wechat|footer|banner|advert|bg[-_]?icon/i
    const pickImg = function (img) {
      if (!img) return null
      const srcs = [
        img.getAttribute('data-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-lazyload'),
        img.getAttribute('data-img'),
        img.getAttribute('data-image'),
        img.getAttribute('data-url'),
        img.getAttribute('_src'),
        img.getAttribute('data-srcset'),
        img.src,
      ]
      for (let i = 0; i < srcs.length; i++) {
        let s = (srcs[i] || '').trim()
        if (!s || BAD.test(s) || NON_ITEM.test(s)) continue
        const m = s.match(/https?:\/\/\S+/) // data-srcset 可能是 "url 2x, url 1x"
        if (m) s = m[0].replace(/[)"',\s]+$/, '')
        if (s.indexOf('http') === 0) return s
      }
      return null
    }
    // 1) 带标识属性的主体图
    const main = card.querySelector(
      'img[data_equip_name], img[data-equip-name], img[data_highlights], ' +
      'img[class*="head"], img[class*="face"], img[class*="avatar"], img[class*="role"], img[class*="pic"]'
    )
    const s1 = pickImg(main)
    if (s1) return s1
    // 2) 任意有效图（兼容各类懒加载属性）
    const imgs = card.querySelectorAll('img')
    for (let i = 0; i < imgs.length; i++) {
      const s = pickImg(imgs[i])
      if (s) return s
    }
    // 3) CSS background-image 兜底（聚焦头像类元素，避免误取装饰背景）
    const bgSel = '[class*="head"],[class*="face"],[class*="avatar"],[class*="img"],[class*="pic"],[class*="role"],[style*="background"]'
    const nodes = [card].concat(Array.prototype.slice.call(card.querySelectorAll(bgSel)))
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const bi = (n.style && (n.style.backgroundImage || n.style.background)) || ''
      const attr = n.getAttribute ? (n.getAttribute('style') || '') : ''
      const m = (bi + ' ' + attr).match(/url\(['"]?(https?:\/\/[^'")]+)['"]?\)/)
      if (m && m[1] && !NON_ITEM.test(m[1])) return m[1]
    }
    return null
  }

  // 去掉藏宝阁属性文本里的色值标签，如 "#cEE82EE[+36]" → "[+36]"
  function cleanColorTag(s) {
    if (s == null) return s
    return String(s).replace(/#c[0-9A-Fa-f]{6}/g, '').replace(/\s+/g, ' ').trim()
  }

  // 解析 equip_desc / other_info textarea 里的 JSON。
  // 真实全服搜索页 equip_desc 是 `#r<json>{...}</json>` 包裹（字段在 minghun 下）；
  // other_info 顶层是纯 JSON，但其 desc 字段值里又嵌了 <json>...</json>，故优先整体 JSON.parse，失败再抽包裹。
  function parseEquipDescText(raw) {
    if (!raw) return null
    let s = String(raw).trim()
    // 优先整体 JSON.parse：other_info 顶层纯 JSON、旧版 equip_desc 纯 JSON 都能直接成功
    try { return JSON.parse(s) } catch (e) { /* 不是纯 JSON，继续 */ }
    // 真实 equip_desc：`#r<json>{...}</json>` 包裹，抽出内部 JSON 再解析
    const m = s.match(/#r\s*<json>([\s\S]*?)<\/json>/i) || s.match(/<json>([\s\S]*?)<\/json>/i)
    if (m) {
      try { return JSON.parse(m[1].trim()) } catch (e) { return null }
    }
    return null
  }

  // 从 hole.desc 文本（如 "灵尘等级 12" 或带色值标签）提取灵尘等级数字。
  // 藏宝阁 minghun.hole 只有 desc 字段（官方 parse_yupo_desc 用 hole.desc，无 val）。
  function parseLingChenLevel(desc) {
    if (desc == null) return null
    const t = String(desc).replace(/#c[0-9A-Fa-f]{6}/g, '').replace(/\s+/g, '')
    const m = t.match(/(\d+)/)
    return m ? parseInt(m[1], 10) : null
  }

  // 真实藏宝阁玉魄搜索结果：灵尘等级与特效是【两列】。
  //   - 灵尘等级列：<td>正整数(等级) + <p>(奇袭/化劲 sub-effect，可不止一行)</p></td>
  //   - 特效列：紧邻灵尘等级列的【下一列】 <td><p>法伤化劲 +X%</p></td>
  // 例（用户贴的真实 DOM）：
  //   <td> 12 <p>奇袭法术 +3%</p> </td>   ← 灵尘等级 12 + 奇袭
  //   <td> <p>法伤化劲 +3.1%</p> </td>    ← 特效（独立列，不是灵尘里的 <p>）
  // 注意：附加属性列也用 <p>（如 <td><p>伤害+10</p><p>伤害+8</p></td>），但其直接文本不是正整数，
  //       靠「直接文本必须是正整数」排除，避免误抓。
  function extractLevelEffectCell(card) {
    if (!card) return null
    const tds = card.querySelectorAll('td')
    for (let i = 0; i < tds.length; i++) {
      const td = tds[i]
      const ps = td.querySelectorAll('p')
      // 灵尘等级单元格：去掉所有 <p> 后的直接文本必须是正整数
      const clone = td.cloneNode(true)
      const cp = clone.querySelectorAll('p')
      for (let k = 0; k < cp.length; k++) cp[k].parentNode.removeChild(cp[k])
      const numText = (clone.textContent || '').replace(/\s+/g, '')
      if (!/^\d+$/.test(numText) || numText === '0') continue
      // 该单元格内的 <p> 是「灵尘附属效果」（奇袭/化劲），可多行，不是特效
      const lingchenExtra = []
      for (let k = 0; k < ps.length; k++) {
        const t = cleanColorTag(ps[k].textContent)
        if (t) lingchenExtra.push(t)
      }
      // 特效在灵尘等级列的下一列（排除掉价格列）
      let effect = ''
      const nextTd = tds[i + 1]
      if (nextTd && !nextTd.querySelector('.p10000, .p100000, [class*="price"]')) {
        const np = nextTd.querySelectorAll('p')
        const lines = []
        np.forEach(function (p) {
          const t = cleanColorTag(p.textContent)
          if (t) lines.push(t)
        })
        if (!lines.length) {
          const nt = cleanColorTag(nextTd.textContent)
          // 特效列兜底：文本必须像特效（含 % / 化劲 / 无痕 / 磐石 / 奇袭），
          // 避免把纯文本的服务器名列误当特效。
          if (nt && /%|化劲|无痕|磐石|奇袭/.test(nt)) lines.push(nt)
        }
        effect = lines.join(' / ')
      }
      return { level: parseInt(numText, 10), lingchenExtra: lingchenExtra.join(' / '), effect: effect }
    }
    return null
  }

  // 角色搜索结果页：门派编号 -> 名称（对照 other_info JSON 的 iSchool 字段）
  const SCHOOL_MAP = {
    1: '大唐官府', 2: '化生寺', 3: '女儿村', 4: '方寸山', 5: '天宫',
    6: '普陀山', 7: '龙宫', 8: '五庄观', 9: '狮驼岭', 10: '魔王寨',
    11: '阴曹地府', 12: '盘丝洞', 13: '神木林', 14: '凌波城', 15: '无底洞',
    16: '女魃墓', 17: '天机城', 18: '花果山', 19: '东海渊', 20: '九黎城', 21: '弥勒山',
  }

  // 解析角色 other_info JSON（角色搜索结果页）为展示属性：
  //   iSchool/iGrade/cName、iExptSki1-5（攻/防/法/抗/猎修）+ iMaxExpt（上限）、
  //   iBeastSki1-4（召唤兽攻击/防御/法术/法抗控制）、AchPointTotal、xianyu、summary。
  //   亮点在 <img data_highlights>（JSON 数组 [[名称,值,{}],...]）。
  function parseRoleAttrs(oj, imgEl) {
    if (!oj || oj.iSchool == null || oj.cName == null) return null
    const out = {}
    out['门派'] = SCHOOL_MAP[oj.iSchool] || ('门派' + oj.iSchool)
    if (oj.iGrade != null) out['等级'] = oj.iGrade
    if (oj.cName != null) out['角色名'] = String(oj.cName)
    // 人物修炼：iExptSki1=攻修 2=防修 3=法修 4=抗法 5=猎术；显示 当前/上限（与官网一致）
    const pair = (v, max) => (v == null ? null : (max != null ? v + '/' + max : String(v)))
    const eg = pair(oj.iExptSki1, oj.iMaxExpt1); if (eg) out['攻修'] = eg
    const ef = pair(oj.iExptSki2, oj.iMaxExpt2); if (ef) out['防修'] = ef
    const es = pair(oj.iExptSki3, oj.iMaxExpt3); if (es) out['法修'] = es
    const ek = pair(oj.iExptSki4, oj.iMaxExpt4); if (ek) out['抗法'] = ek
    const el = pair(oj.iExptSki5, oj.iMaxExpt5); if (el) out['猎术'] = el
    // 召唤兽控制修炼
    if (oj.iBeastSki1 != null) out['攻击控制'] = oj.iBeastSki1
    if (oj.iBeastSki2 != null) out['防御控制'] = oj.iBeastSki2
    if (oj.iBeastSki3 != null) out['法术控制'] = oj.iBeastSki3
    if (oj.iBeastSki4 != null) out['法抗控制'] = oj.iBeastSki4
    // all_skills：{"技能ID":等级,...}。师门技能无独立字段，简化方案：
    // 等级最高的前 7 个技能视为师门技能（估价用）；强壮/神速固定 ID 163/164。
    // 原始 all_skills 一并存入 attrs，供后端做更精细的估价/校准。
    if (oj.all_skills != null) {
      let sk = null
      try { sk = typeof oj.all_skills === 'string' ? JSON.parse(oj.all_skills) : oj.all_skills } catch (e) {}
      if (sk && typeof sk === 'object') {
        const levels = Object.keys(sk)
          .map(function (k) { return parseInt(k, 10) })
          .filter(function (id) { return id !== 163 && id !== 164 }) // 排除强壮/神速
          .map(function (id) { return { id: id, lv: sk[String(id)] != null ? sk[String(id)] : sk[id] } })
          .filter(function (x) { return x.lv > 0 })
          .sort(function (a, b) { return b.lv - a.lv })
        // 师门技能 1-7：等级最高的 7 个（龙宫示例：九龙诀/呼风唤雨/龙腾/破浪诀/逆鳞/游龙术/龙附）
        for (let i = 0; i < Math.min(7, levels.length); i++) {
          out['师门技能' + (i + 1)] = levels[i].lv
        }
        if (sk['163'] != null) out['强壮'] = sk['163']
        if (sk['164'] != null) out['神速'] = sk['164']
      }
    }
    if (oj.AchPointTotal != null) out['成就'] = oj.AchPointTotal
    if (oj.xianyu != null) out['仙玉'] = oj.xianyu
    if (oj.summary) out['简介'] = String(oj.summary)
    // 亮点：img data_highlights JSON（如 [["满强身",25,{}]]）
    try {
      const hl = imgEl && imgEl.getAttribute('data_highlights')
      if (hl) {
        const arr = JSON.parse(hl)
        if (Array.isArray(arr) && arr.length) {
          out['亮点'] = arr.map(function (h) { return Array.isArray(h) ? String(h[0]) : String(h) }).join('、')
        }
      }
    } catch (e) { /* 亮点解析失败忽略 */ }
    return out
  }

  // 从卡片内抓属性摘要：玉魄/装备列表页属性藏在 <textarea id="equip_desc_..."> 的 JSON 里
  function extractCardAttrs(card, a) {
    // 收集卡片内所有 textarea，按 id 区分 equip_desc / other_info
    const tas = card ? card.querySelectorAll('textarea') : []
    let equip = null, other = null
    tas.forEach(function (t) {
      const id = (t.id || '').toLowerCase()
      if (id.indexOf('equip_desc') >= 0) equip = t
      else if (id.indexOf('other_info') >= 0) other = t
    })
    if ((!equip || !equip.value) && a) {
      const ta = a.querySelector('textarea')
      if (ta) {
        const id = (ta.id || '').toLowerCase()
        if (id.indexOf('equip_desc') >= 0) equip = ta
        else if (id.indexOf('other_info') >= 0) other = ta
      }
    }
    const out = {}
    // 角色搜索结果页：other_info JSON 含 iSchool/cName/iGrade 等，优先按角色解析
    if (other && other.value) {
      try {
        const oj = JSON.parse(other.value)
        if (oj && oj.iSchool != null && oj.cName != null) {
          const img = card.querySelector('img[data_equip_name], img[data-equip-name], img[data_highlights]')
          const roleAttrs = parseRoleAttrs(oj, img)
          if (roleAttrs) return roleAttrs
        }
      } catch (e) { /* 非 JSON 或非角色，继续走玉魄/装备解析 */ }
    }
    const ej = parseEquipDescText(equip && equip.value)
    if (ej) {
      const mh = (ej && ej.minghun) || {}
      const init = mh.init || ej.init
      const base = mh.base || ej.base
      const eff = mh.effect || ej.effect
      const hole = mh.hole || ej.hole
      if (init && init.desc) out['基础属性'] = cleanColorTag(init.desc)
      let baseArr = []
      if (Array.isArray(base) && base.length) {
        baseArr = base.map(function (b) { return cleanColorTag(b.desc != null ? b.desc : b) }).filter(Boolean)
      } else if (Array.isArray(ej.agg_added_attrs) && ej.agg_added_attrs.length) {
        baseArr = ej.agg_added_attrs.map(cleanColorTag)
      }
      if (baseArr.length) out['附加属性'] = baseArr.join(' / ')
      // 特效 = effect.desc（主特效，如 法伤化劲）；effect.desc2 是奇袭，属灵尘列，另存为「奇袭」
      if (eff && eff.desc) out['特效'] = cleanColorTag(eff.desc)
      if (eff && eff.desc2) out['奇袭'] = cleanColorTag(eff.desc2)
      // 灵尘等级 = hole.desc 文本提取（官方 parse_yupo_desc 用 hole.desc，无 val 字段），回落 minghun_level
      const lvl = (hole && hole.val != null) ? hole.val
        : (hole && hole.desc) ? parseLingChenLevel(hole.desc)
        : (ej.minghun_level != null ? ej.minghun_level : null)
      if (lvl != null && lvl !== 0) out['灵尘等级'] = lvl
    }
    // 灵尘等级补充：other_info textarea 顶层/嵌套 minghun（equip_desc 里常缺 hole）
    if (out['灵尘等级'] == null) {
      const oj = parseEquipDescText(other && other.value)
      if (oj) {
        const oh = (oj.minghun && oj.minghun.hole) || {}
        const lvl = (oh.val != null) ? oh.val
          : (oh.desc) ? parseLingChenLevel(oh.desc)
          : (oj.minghun_level != null ? oj.minghun_level : null)
        if (lvl != null && lvl !== 0) out['灵尘等级'] = lvl
      }
    }
    // 兜底：真实藏宝阁把「灵尘等级数字 + 奇袭<p>」放在同一 <td>，特效在【下一列】。
    //       JSON 缺字段时从这里补全（等级 / 奇袭 / 特效 各自独立）。
    const le = extractLevelEffectCell(card)
    if (le) {
      if (out['灵尘等级'] == null && le.level != null) out['灵尘等级'] = le.level
      if (out['奇袭'] == null && le.lingchenExtra) out['奇袭'] = le.lingchenExtra
      if (out['特效'] == null && le.effect) out['特效'] = le.effect
    }
    if (Object.keys(out).length) return out

    // 个别没有 textarea 的普通装备列表，回退到可见属性区的正则提取（listing.html 场景）。
    const box =
      card.querySelector('.attrs, .attr, .prop, .attribute, .desc, .info, [class*="attr"], [class*="prop"], [class*="desc"]')
    const boxText = box ? (box.textContent || '') : ''
    const pool = (boxText + ' ' + (card.textContent || '')).replace(/\s+/g, ' ')
    const keys = ['等级', '伤害', '命中', '防御', '法术', '速度', '体力', '魔力', '耐力', '力量', '敏捷', '特技', '特效', '套装', '部位', '类型', '门派', '种族', '攻修', '法修', '抗修', '气血', '魔法', '愤怒', '修炼']
    const fb = {}
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const m = pool.match(new RegExp(k + '\\s*[:：]?\\s*([\\d+]+|[^\\s,，。]+)'))
      if (m && m[1]) fb[k] = m[1].trim()
    }
    return fb
  }

  // 物品名：优先 <img data_equip_name>（最可靠），其次 .equip_name / .name 文本；
  // 兜底去掉隐藏 textarea/script 后的卡片可见文本。绝不用 a.textContent（会混入详情 JSON 乱码）。
  function extractCardName(card, a) {
    const img = card.querySelector('img[data_equip_name], img[data-equip-name], img[data_highlights]') || (a && a.querySelector('img[data_equip_name], img[data-equip-name]'))
    if (img) {
      const v = (img.getAttribute('data_equip_name') || img.getAttribute('data-equip-name') || '').trim()
      if (v) return v.slice(0, 60)
    }
    const nm = card.querySelector('td.equip_name, .equip_name, .name, [class*="equip_name"]')
    if (nm && nm.textContent.trim()) return nm.textContent.trim().slice(0, 60)
    if (a) {
      const at = (a.textContent || '').replace(/\s+/g, ' ').trim()
      if (at && !at.startsWith('{') && at !== '物品') return at.slice(0, 60)
    }
    const clone = card.cloneNode(true)
    clone.querySelectorAll('textarea, script, style').forEach(function (n) { n.remove() })
    const txt = (clone.textContent || '').replace(/\s+/g, ' ').trim()
    if (txt && !txt.startsWith('{')) return txt.slice(0, 60)
    return null
  }

  // ---- recommend.py 直调：全服搜索页是 SPA，URL 不变，真正的搜索靠 recommend.py 请求（需登录态）。
  // 这里在藏宝阁页面上下文 fetch recommend.py（同源自动带 cookie），解析返回 JSON 的 equip 数组。
  // recommend.py 返回每个 equip 字段（对照 search_result_templ 模板 + calcEquipLinkInfo）：
  //   eid / serverid / server_name / area_name / equip_name / equip_type / price(分) /
  //   other_info(JSON字符串，desc 字段是 #r<json>{minghun...}</json>) / game_ordersn / equip_face_img / kindid ...
  function parseRecommendAttrs(equip) {
    const out = {}
    let mh = null
    let otherTop = null
    try {
      const raw = equip.other_info
      if (raw) {
        otherTop = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (otherTop && otherTop.desc) {
          const d = parseEquipDescText(otherTop.desc)
          mh = (d && d.minghun) || null
        }
      }
    } catch (e) { /* ignore */ }
    if (!mh && equip.equip_desc) {
      const d = parseEquipDescText(equip.equip_desc)
      mh = (d && d.minghun) || d
    }
    // 临时诊断：解析失败时带出原始结构，定位 other_info/equip_desc 真实字段（定位后删除）
    if (!mh) {
      const oi = equip.other_info ? String(equip.other_info) : ''
      out['_dbg_keys'] = Object.keys(equip).join(',')
      out['_dbg_oi_len'] = oi.length
      out['_dbg_oi_head'] = oi.slice(0, 60)
      out['_dbg_oi_tail'] = oi.slice(-20)
      out['_dbg_other_info'] = oi  // 完整值，便于本地复现解密
      out['_dbg_equip_desc'] = equip.equip_desc ? String(equip.equip_desc).slice(0, 300) : null
    }
    if (mh) {
      const init = mh.init
      const base = mh.base
      const eff = mh.effect
      const hole = mh.hole
      if (init && init.desc) out['基础属性'] = cleanColorTag(init.desc)
      let baseArr = []
      if (Array.isArray(base) && base.length) {
        baseArr = base.map(function (b) { return cleanColorTag(b.desc != null ? b.desc : b) }).filter(Boolean)
      } else if (otherTop && Array.isArray(otherTop.agg_added_attrs) && otherTop.agg_added_attrs.length) {
        baseArr = otherTop.agg_added_attrs.map(cleanColorTag)
      }
      if (baseArr.length) out['附加属性'] = baseArr.join(' / ')
      if (eff && eff.desc) out['特效'] = cleanColorTag(eff.desc)
      if (eff && eff.desc2) out['奇袭'] = cleanColorTag(eff.desc2)
      // 灵尘等级 = hole.desc 文本提取（官方 hole 无 val），回落 other_info 顶层 minghun_level
      const lvl = (hole && hole.val != null) ? hole.val
        : (hole && hole.desc) ? parseLingChenLevel(hole.desc)
        : (otherTop && otherTop.minghun_level != null ? otherTop.minghun_level : null)
      if (lvl != null && lvl !== 0) out['灵尘等级'] = lvl
    }
    return out
  }

  // 本地解密 other_info（藏宝阁 LPC 加密串）。
  // 算法（已本地完整复现验证）：@密钥@base64数据@ → 拆密钥 → atob(base64) 得到 JS 字符串字面量
  // （如 ")\u001a..."）→ new Function 求值成字符串 → 与密钥逐字符 XOR → 明文 JSON。
  // 密钥内嵌在加密串两个 @ 之间，不依赖 cookie，故可在 content script 里直接解，无需 bridge。
  function decodeDesc(s) {
    s = String(s).trim()
    if (!/^@[\s\S]*@$/.test(s)) return s
    let key = ''
    s = s.replace(/^@|@$/g, '')
    if (/^[^@]+@[\s\S]+/.test(s)) {
      const i = s.indexOf('@')
      key = s.substring(0, i)
      s = s.substring(i + 1)
    }
    let content = null
    try {
      // atob 结果是 JS 字符串字面量（如 ")\u001a..."），用 JSON.parse 求值成字符串内容。
      // 不能用 eval/new Function——content script 的 isolated world 受扩展 CSP 限制禁止 eval。
      content = JSON.parse(atob(s))
    } catch (e) {
      return s
    }
    if (content && typeof content === 'object' && content.d) content = content.d
    let out = ''
    for (let i = 0; i < content.length; i++) {
      out += String.fromCharCode(content.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return out
  }

  function decodeOtherInfos(arr) {
    if (!arr || !arr.length) return Promise.resolve({ result: arr, debug: null })
    const result = arr.map(function (x) {
      try { return decodeDesc(x) } catch (e) { return x }
    })
    const debug = {
      local: true,
      changed: result[0] !== arr[0],
      resHead: result[0] ? String(result[0]).slice(0, 100) : '',
    }
    return Promise.resolve({ result: result, debug: debug })
  }

  // recommend.py 的 equip 对象 → 标准 capture item
  function mapRecommendEquip(equip) {
    const serverid = equip.serverid != null ? String(equip.serverid)
      : (equip.server_id != null ? String(equip.server_id) : '')
    const eid = equip.eid || ''
    return {
      eid: eid,
      server_id: serverid || null,
      server_name: equip.server_name || null,
      name: equip.equip_name || null,
      price: equip.price != null ? equip.price / 100 : null, // 分 → 元
      attrs: parseRecommendAttrs(equip),
      thumb_url: equip.equip_face_img ? 'https://cbg-xyq.res.netease.com/images/small/' + equip.equip_face_img : null,
      detail_url: serverid && eid ? 'https://xyq.cbg.163.com/equip?s=' + serverid + '&eid=' + eid : '',
      // 诊断字段（后端忽略）：用于 [ROLE_MATCH] 反推官方到底用 icon 还是 equip_face_img
      _diag_icon: equip.icon != null ? String(equip.icon) : null,
      _diag_face: equip.equip_face_img != null ? String(equip.equip_face_img) : null,
    }
  }

  function extractListItems() {
    const links = Array.prototype.slice.call(
      document.querySelectorAll('a[href*="eid="], a[href*="ordersn="], a[href*="/equip"]')
    )
    if (!links.length) return []
    const cardSels = [
      'tr', 'li', '.item', '.card', '.goods', '.equip', '.product', '.commodity', '.list-item',
      '[class*="item"]', '[class*="goods"]', '[class*="card"]', '[class*="equip"]',
      '[class*="product"]', '[class*="commodity"]', '[class*="list-item"]',
    ]
    const cards = []
    const seenCards = new Set()
    for (let i = 0; i < links.length; i++) {
      let card = null
      for (let s = 0; s < cardSels.length; s++) {
        const c = links[i].closest(cardSels[s])
        if (c) { card = c; break }
      }
      if (!card) card = links[i].parentElement
      if (card && !seenCards.has(card)) {
        seenCards.add(card)
        cards.push(card)
      }
    }
    const items = []
    const seenEid = {}
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]
      const a = detailLinkOf(card)
      if (!a) continue
      const u = new URL(a.href, location.href)
      const eid = u.searchParams.get('eid') || u.searchParams.get('ordersn')
      if (!eid || seenEid[eid]) continue
      const price = extractCardPrice(card)
      if (price == null) continue // 没有价格的元素不算商品卡
      seenEid[eid] = true
      const name = extractCardName(card, a)
      items.push({
        eid: eid,
        server_id: u.searchParams.get('s') || u.searchParams.get('server_id') || null,
        // 只存真实中文服务器名；拿不到（单服列表页只有数字 data_serverid）就留空，前端按 server_id 反查中文名
        server_name: extractCardServer(card, u) || null,
        name: name,
        price: price,
        attrs: extractCardAttrs(card, a),
        thumb_url: extractCardThumb(card),
        detail_url: a.href,
      })
    }
    return items
  }

  // ---- "我的装备"列表提取（每个 item 是带 ordersn 的链接）----
  function extractMyEquips() {
    const links = Array.prototype.slice.call(
      document.querySelectorAll('a[href*="ordersn="], a[href*="eid="]')
    )
    const items = []
    const seen = {}
    for (let i = 0; i < links.length; i++) {
      const a = links[i]
      const u = new URL(a.href, location.href)
      const ordersn = u.searchParams.get('ordersn') || u.searchParams.get('eid')
      if (!ordersn || seen[ordersn]) continue
      seen[ordersn] = true
      items.push({
        ordersn: ordersn,
        server_id: u.searchParams.get('server_id') || u.searchParams.get('s'),
        server_name:
          u.searchParams.get('server_name') || a.getAttribute('data-server') || guessServerName() || '',
        equip_name: (a.textContent || '').trim().slice(0, 60) || undefined,
      })
    }
    return items
  }

  // ---- 成交记录提取（详情页若已渲染"成交记录"区域）----
  function extractDeals() {
    const ordersn = getOrdersn()
    if (!ordersn) return null
    const deals = []
    const rows = Array.prototype.slice.call(
      document.querySelectorAll(
        'table tr, .deal-list li, .record li, .deal-record li, .history-list li, .deal-item'
      )
    )
    for (let i = 0; i < rows.length; i++) {
      const t = (rows[i].textContent || '').replace(/\s+/g, ' ').trim()
      const dm = t.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/)
      if (!dm) continue
      // 价格：优先在含"成交/价/¥"的单元格里取，避免把日期里的年份误当价格
      let price = null
      const cells = rows[i].querySelectorAll('td, .price, [class*="price"]')
      for (let c = 0; c < cells.length; c++) {
        const ct = cells[c].textContent || ''
        if (/成交|价|¥|￥/.test(ct)) {
          // 先去掉日期串，避免把年份(如 2026)误当成交价
          const cleaned = ct.replace(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/, '')
          const p = parsePrice(cleaned)
          if (p != null) {
            price = p
            break
          }
        }
      }
      // 兜底：去掉日期后再取首个金额
      if (price == null) price = parsePrice(t.replace(dm[0], ''))
      if (price != null) {
        deals.push({
          deal_ts: new Date(dm[1].replace(/-/g, '/')).getTime() / 1000,
          deal_price: price,
        })
      }
    }
    return deals.length ? { ordersn: ordersn, deals: deals } : null
  }

  function pageKind() {
    const path = location.pathname + location.search
    if (/act=my_equips/.test(path)) return 'my_equips'
    // 详情页：老式 cgi-bin/...&ordersn= 或 新版 /equip?s=&eid=（藏宝阁新版详情页用 eid，路径为 /equip）
    if (/ordersn=/.test(path) || /eid=/.test(path) || location.pathname === '/equip') return 'equip_detail'
    return 'other'
  }

  function report(msg) {
    chrome.runtime.sendMessage(msg)
  }

  function scan() {
    const loggedIn = isLoggedIn()
    report({ type: 'STATUS', loggedIn: loggedIn })

    const kind = pageKind()
    let captured = { kind: kind, loggedIn: loggedIn }
    if (kind === 'equip_detail') {
      captured.priceCandidates = priceCandidates()
      captured.nameCandidates = nameCandidates()
    }
    if (kind === 'my_equips') {
      const items = extractMyEquips()
      captured.items = items
      if (items.length) {
        report({ type: 'BRIDGE_DATA', payload: { kind: 'my_equips_items', items: items } })
      }
    } else if (kind === 'equip_detail') {
      const eq = extractEquipDetail()
      captured.equip = eq
      if (eq && eq.current_price != null) {
        report({ type: 'BRIDGE_DATA', payload: { kind: 'equip_detail', item: eq } })
      }
      const dl = extractDeals()
      captured.deals = dl ? dl.deals : null
      if (dl) {
        report({ type: 'BRIDGE_DATA', payload: { kind: 'deals', ordersn: dl.ordersn, deals: dl.deals } })
      }
    } else {
      // other：详情页以外的页面（搜索结果/列表）。尝试成批提取物品卡片。
      const items = extractListItems()
      if (items.length) {
        captured.kind = 'listing'
        captured.listItems = items
        console.log('[CBG] listItems ' + JSON.stringify(items))
      } else {
        const myItems = extractMyEquips()
        if (myItems.length) captured.items = myItems
      }
    }

    // 调试：在 console 暴露最近一次提取结果
    window.__cbgLastScan = captured
    // 以纯文本打印候选，便于在 DevTools(isolated world) 无法访问 window.__cbgLastScan 时直接复制
    if (captured.nameCandidates && captured.nameCandidates.length) {
      console.log('[CBG] nameCandidates ' + JSON.stringify(captured.nameCandidates))
    }
    if (captured.priceCandidates && captured.priceCandidates.length) {
      console.log('[CBG] priceCandidates ' + JSON.stringify(captured.priceCandidates))
    }
    console.log('[CBG] scan', captured)
    return captured
  }

  function init() {
    injectBridge()
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      scan()
    } else {
      window.addEventListener('DOMContentLoaded', scan)
    }
    // 藏宝阁结果多为 AJAX 渲染（尤其玉魄搜索），初加载时卡片可能还没出来，分档补扫
    setTimeout(scan, 1500)
    setTimeout(scan, 3500)
    setTimeout(scan, 7000)
  }

  // ---- 给 popup / DevTools 用的接口 ----
  function currentPageInfo() {
    const kind = pageKind()
    const info = { kind: kind, loggedIn: isLoggedIn() }
    if (kind === 'equip_detail') {
      const eq = extractEquipDetail()
      if (eq) {
        info.ordersn = eq.ordersn
        info.server_id = eq.server_id
        info.server_name = eq.server_name
        info.equip_name = eq.equip_name
        info.current_price = eq.current_price
      }
    } else {
      const list = extractListItems()
      if (list.length) {
        info.kind = 'listing'
        info.itemCount = list.length
        // 自动标签：玉魄阴阳/类型（取首个玉魄物品名，如「上古玉魄·阳」），供弹窗预填采集标签
        let hasYupo = false, hasRole = false
        for (let i = 0; i < list.length; i++) {
          const n = list[i].name || list[i].equip_name || ''
          const attrs = list[i].attrs || {}
          // 玉魄特征：名字含「玉魄」，或属性含玉魄专属字段（灵尘等级/基础属性/附加属性/奇袭）
          if (n.indexOf('玉魄') >= 0 || '灵尘等级' in attrs || '基础属性' in attrs || '附加属性' in attrs || '奇袭' in attrs) {
            info.yupoType = n || '玉魄'
            hasYupo = true
            break
          }
          // 角色检测：attrs 含 门派/攻修/法修 等角色特有字段
          if ('门派' in attrs || '攻修' in attrs || '法修' in attrs || '等级' in attrs) {
            hasRole = true
          }
        }
        // 角色搜索结果页：自动设置角色标签（URL 或 attrs 判断）
        const path = location.pathname + location.search
        if (/show_role_search_result|overall_search_role/.test(path) || hasRole) {
          info.roleLabel = '角色'
        }
      }
    }
    return info
  }

  // 带超时的 fetch：避免网易接口无响应时 chrome.tabs.sendMessage 永久挂起（表现为「采集超时」）。
  function fetchWithTimeout(url, opts, ms) {
    ms = ms || 15000
    const ctrl = new AbortController()
    const tid = setTimeout(function () { ctrl.abort() }, ms)
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .then(function (r) { clearTimeout(tid); return r })
      .catch(function (e) {
        clearTimeout(tid)
        if (e && e.name === 'AbortError') throw new Error('请求超时（>' + (ms / 1000) + 's）：' + url)
        throw e
      })
  }

  // 防重复注册：background 可能通过 chrome.scripting.executeScript 强制重注入本文件，
  // 用一次性标志保证 onMessage 监听器只注册一次（避免重复响应导致 sendResponse 通道错乱）。
  if (!window.__cbgInjected) {
    window.__cbgInjected = true
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    ;(async function () {
    if (!msg) return false
    if (msg.type === 'SCAN_PAGE') {
      const r = scan()
      sendResponse({ ok: true, kind: r.kind, loggedIn: r.loggedIn })
      return true
    }
    if (msg.type === 'GET_PAGE') {
      sendResponse({ ok: true, page: currentPageInfo() })
      return true
    }
    if (msg.type === 'CHECK_STATUS') {
      checkStatusList(msg.items).then(function (results) {
        sendResponse({ ok: true, results: results })
      })
      return true
    }
    if (msg.type === 'LIST_SCAN') {
      const items = extractListItems()
      sendResponse({ ok: true, items: items, count: items.length })
      return true
    }
    if (msg.type === 'FETCH_RECOMMEND') {
      // 在藏宝阁页面上下文直调 recommend.py（同源带登录 cookie），返回结构化玉魄列表。
      // msg.fetchAll=true 时循环翻页采集所有页（pager.total_pages 决定页数）。
      const url = msg.url
      if (!url) {
        sendResponse({ ok: false, error: '缺少 recommend URL' })
        return false
      }
      const fetchAll = !!msg.fetchAll

      // 单页：fetch + 解密 other_info + map 成 item
      function fetchOnePage(pageUrl) {
        return fetchWithTimeout(pageUrl, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        }, 15000)
          .then(function (r) { return r.json() })
          .then(function (json) {
            if (json.status !== 1) {
              throw new Error((json && json.msg) || (json && json.status_code) || ('status ' + json.status))
            }
            const equips = Array.isArray(json.equip_list) ? json.equip_list : []
            return decodeOtherInfos(equips.map(function (e) { return e.other_info || '' })).then(function (r) {
              const decoded = (r && r.result) || []
              equips.forEach(function (e, i) { if (decoded[i]) e.other_info = decoded[i] })
              const items = equips.map(mapRecommendEquip).filter(function (i) { return i.eid })
              return { items: items, pager: json.pager || null }
            })
          })
      }

      function withPage(pageUrl, page) {
        const u = new URL(pageUrl)
        u.searchParams.set('page', String(page))
        return u.toString()
      }

      function totalPagesOf(pager) {
        if (!pager) return 1
        const n = pager.total_pages || pager.num_end || pager.total_page || pager.num_pages
        if (!n || n < 1) return 1
        return Math.min(n, 50) // 防御：最多 50 页，避免异常翻页
      }

      function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

      if (!fetchAll) {
        fetchOnePage(url)
          .then(function (res) { sendResponse({ ok: true, items: res.items, count: res.items.length, paging: res.pager }) })
          .catch(function (e) { sendResponse({ ok: false, error: e.message }) })
        return true
      }

      // fetchAll：循环翻页采集所有页；页间加延时降低风控；遇验证码/错误停止翻页但保留已采集
      fetchOnePage(withPage(url, 1))
        .then(function (first) {
          const allItems = first.items.slice()
          const pager = first.pager
          const total = totalPagesOf(pager)
          let stop = false
          let warn = ''
          const pages = []
          for (let p = 2; p <= total; p++) pages.push(p)
          return pages.reduce(function (chain, p) {
            return chain.then(function () {
              if (stop) return
              return sleep(1200) // 页间延时 1.2s，降低触发验证码风控的概率
                .then(function () { return fetchOnePage(withPage(url, p)) })
                .then(function (res) { allItems.push.apply(allItems, res.items) })
                .catch(function (e) {
                  stop = true
                  warn = e.message
                })
            })
          }, Promise.resolve()).then(function () {
            sendResponse({ ok: true, items: allItems, count: allItems.length, paging: pager, warn: warn })
          })
        })
        .catch(function (e) { sendResponse({ ok: false, error: e.message }) })
      return true
    }

    // 从 large_equip_desc（Python-repr 风格伪 JSON，如 "iExptSki1":25）提取数值字段。
    // 该串不是合法 JSON（([...]) 包裹），用正则按 key 提取。
    function pickDescNum(s, key) {
      const m = s.match(new RegExp('"' + key + '"\\s*:\\s*(-?\\d+)'))
      return m ? parseInt(m[1], 10) : null
    }
    function pickDescStr(s, key) {
      const m = s.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"'))
      return m ? m[1] : null
    }

    // 把一条角色原始数据（来自内嵌 JSON）转成统一 item 结构。
    // 属性主要来自 large_equip_desc（伪 JSON，含修炼/控制/技能），与手动采集的
    // parseRoleAttrs 字段保持一致，保证列表列展示一致。
    function parseRoleItem(d) {
      if (!d) return null
      // eid 优先用 d.eid（新格式，可用于 equip?s=&eid= 跳转链接）
      const eid = d.eid || d.game_ordersn || d.ordersn || null
      if (!eid) return null
      const desc = d.large_equip_desc || ''
      // 首次进入时打印接口返回的全部字段名，便于核对到底有哪些头像相关字段可用
      if (!window.__cbgRoleFieldsLogged) {
        window.__cbgRoleFieldsLogged = true
        console.log('[ROLE_FIELDS] 接口返回字段:', Object.keys(d).join(', '))
      }
      // 头像候选列表（2026-08-30 重构，字段无关、逐一试探取真实图）：
      // 不再赌单个字段——把多个可能的头像 id 都发给后端，由后端 download_thumb 按
      // 「role_icon/small/<id>.gif」逐一请求，取第一个真实存在的图（404 自动跳过下一个）。
      // 候选优先级：
      //   1) equip_face_img 的数字部分（官方最可靠：造型 id，如 35.gif / 229.gif）
      //   2) d.icon（部分角色此值 404，作补充）
      //   3) d.icon_url / d.thumb_url（接口直给完整 URL）
      //   4) iSchool 门派通用图标（iSchool*2-1 男）
      // 关于大图/小图：列表用 role_icon/small/<id>.gif（50×50，.role-thumb 仅 40×40，
      //   用 bigface 多下 6 倍流量无清晰度收益），故统一取小图。
      const SECT_ICON_BASE = 'https://cbg-xyq.res.netease.com/images/role_icon/small/'
      const iSchoolNum = pickDescNum(desc, 'iSchool')
      const candidates = []
      function __pushId(x) {
        if (x == null) return
        const s = String(x).trim()
        if (/^\d+$/.test(s)) candidates.push(SECT_ICON_BASE + s + '.gif')
      }
      function __pushFull(u) {
        if (u == null) return
        const s = String(u).trim()
        if (/^https?:\/\//i.test(s)) candidates.push(s)
      }
      // 1) equip_face_img 数字部分（329_3746.gif / 55970 / 35 等 → 取数字）
      if (d.equip_face_img != null) {
        const fs = String(d.equip_face_img).trim()
        if (!/blank_role/i.test(fs)) {
          const fm = fs.match(/(\d+)(?:_\d+)?\.gif$/i) || fs.match(/(\d+)/)
          if (fm) __pushId(fm[1]); else __pushFull(fs)
        }
      }
      // 2) d.icon
      __pushId(d.icon)
      // 3) 接口直给的完整 URL
      __pushFull(d.icon_url); __pushFull(d.thumb_url)
      // 4) iSchool 门派通用图标
      if (iSchoolNum != null && iSchoolNum > 0) __pushId(iSchoolNum * 2 - 1)
      const thumbUrl = candidates.length ? candidates[0] : null
      // 伪 JSON 中 all_skills 是 (["216":95,...])，提取为 {id:lv}
      let skills = null
      try {
        const sm = desc.match(/"all_skills":\(([\s\S]*?)\),/)
        if (sm) {
          skills = {}
          const re = /"(\d+)":(\d+)/g
          let mm
          while ((mm = re.exec(sm[1]))) skills[mm[1]] = parseInt(mm[2], 10)
        }
      } catch (e) {}
      // 组装与 parseRoleAttrs 相同结构的 oj，再走同一套解析
      // 角色等级：藏宝阁角色列表项的等级通常在顶层字段（grade/level/role_level/iGrade），
      // 优先用顶层值；large_equip_desc.iGrade 常与列表不一致（偏低/过时），仅作兜底。
      const topGrade = [d.grade, d.level, d.role_level, d.iGrade]
        .map(function (x) { return Number(x) })
        .find(function (x) { return x > 0 && x <= 200 })
      const oj = {
        iSchool: pickDescNum(desc, 'iSchool'),
        iGrade: topGrade != null ? topGrade : pickDescNum(desc, 'iGrade'),
        cName: pickDescStr(desc, 'cName'),
        iExptSki1: pickDescNum(desc, 'iExptSki1'),
        iExptSki2: pickDescNum(desc, 'iExptSki2'),
        iExptSki3: pickDescNum(desc, 'iExptSki3'),
        iExptSki4: pickDescNum(desc, 'iExptSki4'),
        iExptSki5: pickDescNum(desc, 'iExptSki5'),
        iMaxExpt1: pickDescNum(desc, 'iMaxExpt1'),
        iMaxExpt2: pickDescNum(desc, 'iMaxExpt2'),
        iMaxExpt3: pickDescNum(desc, 'iMaxExpt3'),
        iMaxExpt4: pickDescNum(desc, 'iMaxExpt4'),
        iMaxExpt5: pickDescNum(desc, 'iMaxExpt5'),
        iBeastSki1: pickDescNum(desc, 'iBeastSki1'),
        iBeastSki2: pickDescNum(desc, 'iBeastSki2'),
        iBeastSki3: pickDescNum(desc, 'iBeastSki3'),
        iBeastSki4: pickDescNum(desc, 'iBeastSki4'),
        AchPointTotal: pickDescNum(desc, 'AchPointTotal'),
        xianyu: pickDescNum(desc, 'xianyu'),
        summary: d.desc_sumup || null,
        all_skills: skills,
      }
      let attrs = null
      if (oj.iSchool != null || oj.cName != null) attrs = parseRoleAttrs(oj, null)
      if (!attrs) attrs = {}
      // 兜底：large_equip_desc 解析失败时，用列表字段补基础属性
      if (attrs['门派'] == null && d.equip_type_name) attrs['门派'] = d.equip_type_name
      // 注意：不再用 d.equip_level 兜底等级——该字段常是角色佩戴装备的等级（偏低，如 150 实为 175），
      // 会导致等级显示异常。等级以顶层 grade/level/role_level/iGrade 或 large_equip_desc.iGrade 为准。
      // 亮点：d.highlight 是 [[名称,权重,{}],...]，与手动采集 data_highlights 同构
      if (d.highlight && d.highlight.length) {
        attrs['亮点'] = d.highlight.map(function (h) { return Array.isArray(h) ? String(h[0]) : String(h) }).join('、')
      }
      const __it = {
        eid: String(eid),
        server_id: d.serverid != null ? String(d.serverid) : (d.server_id ? String(d.server_id) : null),
        server_name: d.server_name || null,
        name: d.seller_nickname || d.equip_name || d.name || '',
        price: d.price != null ? Math.round(Number(d.price) / 100) : (d.price_ori != null ? Math.round(Number(d.price_ori) / 100) : null),
        attrs: attrs,
        thumb_url: thumbUrl ? String(thumbUrl) : null,
        detail_url: 'https://xyq.cbg.163.com/equip?s=' + (d.serverid || '') + '&eid=' + eid,
        // 诊断字段（后端忽略）：用于 [ROLE_MATCH] 反推官方到底用哪个字段
        _diag_icon: d.icon != null ? String(d.icon) : null,
        _diag_face: d.equip_face_img != null ? String(d.equip_face_img) : null,
        _diag_icon_url: d.icon_url != null ? String(d.icon_url) : null,
        _diag_thumb_url: d.thumb_url != null ? String(d.thumb_url) : null,
        // 头像候选列表（JSON 字符串）：后端逐一试探取真实图
        thumb_candidates: JSON.stringify(candidates),
      }
      ;(window.__cbgRoleItems = window.__cbgRoleItems || []).push(__it)
      return __it
    }

    // ===== 决定性取证：把页面【真实渲染】的头像 <img> src（官方展示的地址）与 API 字段配对 =====
    // 一次采集即可看出官方到底用 d.icon 还是 equip_face_img 作头像 id。
    function __stripFace(s) {
      if (!s) return null
      s = String(s).trim()
      if (/blank_role/i.test(s)) return null
      let m = s.match(/(\d+)(?:_\d+)?\.gif$/i)
      if (m) return m[1]
      m = s.match(/(\d+)/)
      return m ? m[1] : null
    }
    function __domAvatarId(src) {
      if (!src) return null
      const m = String(src).match(/\/images\/(?:role_icon\/small|role_icon\/big|bigface|big|small)\/(\d+)(?:_\d+)?\.gif/i)
      return m ? m[1] : null
    }
    function __eidOfEl(el) {
      let n = el
      for (let k = 0; k < 8 && n; k++) {
        let a = null
        if (n.tagName === 'A' && /eid=/.test(n.href || '')) a = n
        else if (n.querySelector) a = n.querySelector('a[href*="eid="]')
        if (a && /eid=/.test(a.href || '')) {
          const m = (a.href || '').match(/eid=([^&?#]+)/)
          if (m) return decodeURIComponent(m[1])
        }
        n = n.parentElement
      }
      return null
    }
    function logRoleAvatarMatches(items) {
      try {
        const imgs = Array.prototype.slice.call(document.images || []).filter(function (im) {
          const src = im.src || im.getAttribute('data-src') || im.getAttribute('data-original') || ''
          return /cbg-xyq\.res\.netease\.com/.test(src) && /(role_icon|bigface|\/small\/|\/big\/|face)/.test(src)
        })
        const domByEid = {}
        const domIdsInOrder = []
        imgs.forEach(function (im) {
          const src = im.src || im.getAttribute('data-src') || im.getAttribute('data-original') || ''
          const id = __domAvatarId(src)
          const eid = __eidOfEl(im)
          if (id) domIdsInOrder.push(id)
          if (eid && id && !domByEid[eid]) domByEid[eid] = { id: id, src: src }
        })
        console.log('[ROLE_MATCH] 页面真实头像img数=' + imgs.length + ' 命中eid=' + Object.keys(domByEid).length + ' / API角色数=' + (items ? items.length : 0))
        let iconHit = 0, faceHit = 0, iconUrlHit = 0, thumbUrlHit = 0, noneHit = 0
        let byIndex = 0
        ;(items || []).forEach(function (it, idx) {
          // 优先按 eid 配对，找不到则按数组下标配对（兜底 DOM 结构差异）
          let dom = domByEid[it.eid]
          let via = 'eid'
          if (!dom && domIdsInOrder[idx]) { dom = { id: domIdsInOrder[idx] }; via = 'idx'; byIndex++ }
          if (!dom) return
          const icon = it._diag_icon != null ? String(it._diag_icon).trim() : ''
          const face = __stripFace(it._diag_face)
          const iconUrl = __stripFace(it._diag_icon_url)
          const thumbUrl = __stripFace(it._diag_thumb_url)
          const domId = dom.id
          let verdict
          if (icon && icon === domId) { verdict = 'icon✓'; iconHit++ }
          else if (face && face === domId) { verdict = 'face✓'; faceHit++ }
          else if (iconUrl && iconUrl === domId) { verdict = 'icon_url✓'; iconUrlHit++ }
          else if (thumbUrl && thumbUrl === domId) { verdict = 'thumb_url✓'; thumbUrlHit++ }
          else { verdict = 'DIFF(icon=' + icon + ',face=' + (face || '') + ',icon_url=' + (iconUrl || '') + ',thumb_url=' + (thumbUrl || '') + ')'; noneHit++ }
          console.log('[ROLE_MATCH] eid=' + it.eid + '[' + via + '] domId=' + domId + ' icon=' + icon + ' face=' + (face || '') + ' icon_url=' + (iconUrl || '') + ' thumb_url=' + (thumbUrl || '') + ' => ' + verdict)
        })
        console.log('[ROLE_MATCH] 统计: icon=' + iconHit + ' face=' + faceHit + ' icon_url=' + iconUrlHit + ' thumb_url=' + thumbUrlHit + ' 均未匹配=' + noneHit + ' (下标配对=' + byIndex + ')')
      } catch (e) {
        console.log('[ROLE_MATCH] 执行异常: ' + e.message)
      }
    }
    // 手动触发配对诊断（覆盖各种采集入口）：在 Console 输入 __cbgRunMatch()
    window.__cbgRunMatch = function () {
      if (!window.__cbgRoleItems || !window.__cbgRoleItems.length) {
        console.log('[ROLE_MATCH] 暂无累积的角色数据，请先触发一次采集')
        return
      }
      logRoleAvatarMatches(window.__cbgRoleItems)
    }

    if (msg.type === 'FETCH_ROLE_SEARCH') {
      console.log('[FETCH_ROLE_SEARCH] 收到消息, args:', JSON.stringify(msg.args))

      const baseArgs = msg.args
      if (!baseArgs) {
        sendResponse({ ok: false, error: '缺少 args 参数' })
        return true
      }

      // 角色搜索：调用 recommend.py JSONP 接口（和玉魄一样的数据源）
      // 参数：act=recommd_by_role, level_min, level_max, server_type, page, count
      // msg.fetchAll=true 时循环翻页采集所有页（与玉魄 FETCH_RECOMMEND 一致）。
      console.log('[FETCH_ROLE_SEARCH] 准备调用 recommend.py 接口')

      const params = new URLSearchParams()
      params.set('act', 'recommd_by_role')
      params.set('search_type', 'overall_search_role')
      params.set('view_loc', 'overall_search')
      params.set('page', '1')
      params.set('count', '50')

      // 从 args 映射参数
      if (baseArgs.level_min) params.set('level_min', baseArgs.level_min)
      if (baseArgs.level_max) params.set('level_max', baseArgs.level_max)
      if (baseArgs.server_type) params.set('server_type', baseArgs.server_type)
      if (baseArgs.serverid) params.set('serverid', baseArgs.serverid)
      // 价格范围（分，与 buildArgs 一致）：让官网侧先过滤一层，减少无效翻页
      if (baseArgs.price_min) params.set('price_min', baseArgs.price_min)
      if (baseArgs.price_max) params.set('price_max', baseArgs.price_max)
      // 门派（逗号分隔的 iSchool ID，与 buildArgs 一致）：官网侧先过滤一层
      if (baseArgs.school) params.set('school', baseArgs.school)
      if (baseArgs.school_change_list) params.set('school_change_list', baseArgs.school_change_list)

      const baseUrl = 'https://xyq.cbg.163.com/cgi-bin/recommend.py?' + params.toString()
      const fetchAll = !!msg.fetchAll

      // 90s 硬上限：无论翻页/网络如何，必在此前回 sendResponse，避免 background 的 sendMsgWithTimeout(50s)
      // 与 popup 的 150s 兜底之间形成"永久转圈"。settled 标志防止重复/延迟响应再次写入。
      let __settled = false
      let __deadlineTimer = null
      function finish(obj) {
        if (__settled) return
        __settled = true
        if (__deadlineTimer) clearTimeout(__deadlineTimer)
        try { sendResponse(obj) } catch (e) {}
      }
      __deadlineTimer = setTimeout(function () {
        finish({ ok: false, error: '采集整体超时（>110s）：网易接口卡顿或网络不畅，请稍后重试' })
      }, 110000)

      function roleSleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

      // 本地兜底过滤：保证采集结果与「去搜索」按相同条件严格一致。
      // recommd_by_role 未必可靠支持 price/school 等参数（旧版就丢过），故在扩展端二次校验，
      // 避免采进超出条件（价格/门派）的角色。it.price 为元；baseArgs.price_* 为分；
      // baseArgs.school / school_change_list 为逗号分隔的 iSchool ID；it.attrs['门派'] 为门派名。
      function rolePassFilters(it) {
        if (!it || !it.eid) return false
        if (it.price != null) {
          const fen = it.price * 100
          if (baseArgs.price_min && fen < Number(baseArgs.price_min)) return false
          if (baseArgs.price_max && fen > Number(baseArgs.price_max)) return false
        }
        const schoolNames = []
        if (baseArgs.school) baseArgs.school.split(',').forEach(function (id) { if (SCHOOL_MAP[id]) schoolNames.push(SCHOOL_MAP[id]) })
        if (baseArgs.school_change_list) baseArgs.school_change_list.split(',').forEach(function (id) { if (SCHOOL_MAP[id]) schoolNames.push(SCHOOL_MAP[id]) })
        if (schoolNames.length) {
          const s = it.attrs && it.attrs['门派']
          if (!s || schoolNames.indexOf(s) < 0) return false
        }
        return true
      }

      function withRolePage(page) {
        const u = new URL(baseUrl)
        u.searchParams.set('page', String(page))
        return u.toString()
      }

      function fetchRolePage(page) {
        console.log('[FETCH_ROLE_SEARCH] 请求 URL:', withRolePage(page))
        return fetchWithTimeout(withRolePage(page), {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        }, 15000)
          .then(function (res) {
            console.log('[FETCH_ROLE_SEARCH] 响应状态:', res.status)
            return res.text()
          })
          .then(function (text) {
            // JSONP 响应格式：callback({...})，尝试提取 JSON
            let json = null
            const jsonpMatch = text.match(/^[^(]+\(([\s\S]+)\)$/)
            if (jsonpMatch) {
              try { json = JSON.parse(jsonpMatch[1]) } catch (e) {}
            } else {
              try { json = JSON.parse(text) } catch (e) {}
            }
            if (!json) throw new Error('无法解析响应数据')
            const roleList = json.equip_list || json.result || json.role_list || []
            if (!roleList.length && json.status !== undefined && json.status !== 1) {
              throw new Error(json.msg || json.status_code || '请求失败')
            }
            const items = roleList.map(parseRoleItem).filter(rolePassFilters)
            return { items: items, pager: json.pager || null }
          })
      }

      function roleTotalPages(pager) {
        if (!pager) return 1
        const n = pager.total_pages || pager.num_end || pager.total_page || pager.num_pages
        if (!n || n < 1) return 1
        return Math.min(n, 50) // 防御：最多 50 页
      }

      // 会话预热：先 POST show_role_search_result 建立搜索会话（与网站「去搜索」完全同一条路），
      // 规避网易对冷会话（后台新开标签页、长期未访问）裸 GET recommd_by_role 的风控拦截
      // （返回「请绑定将军令，重新登录后再继续访问」通用页）。POST 成功即把登录会话活跃度续上，
      // 后续 GET recommd_by_role 才会返回正常 JSON。即便 POST 失败也继续尝试 GET，不阻断采集。
      function warmUpSession() {
        const warmArgs = {}
        if (baseArgs.level_min) warmArgs.level_min = Number(baseArgs.level_min)
        if (baseArgs.level_max) warmArgs.level_max = Number(baseArgs.level_max)
        if (baseArgs.price_min) warmArgs.price_min = Number(baseArgs.price_min) // 已是分（buildArgs 已元×100），勿再乘
        if (baseArgs.price_max) warmArgs.price_max = Number(baseArgs.price_max)
        if (baseArgs.school) warmArgs.school = baseArgs.school
        if (baseArgs.server_type) warmArgs.server_type = baseArgs.server_type
        const fd = new URLSearchParams()
        fd.set('act', 'show_role_search_result')
        fd.set('args', JSON.stringify(warmArgs))
        console.log('[FETCH_ROLE_SEARCH] 预热 POST show_role_search_result, args:', fd.get('args'))
        return fetchWithTimeout('https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_role_search_result', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
          body: fd.toString(),
        }, 15000)
          .then(function (res) { console.log('[FETCH_ROLE_SEARCH] 预热 POST 状态:', res.status); return res.text() })
          .then(function (t) { console.log('[FETCH_ROLE_SEARCH] 预热 POST 返回前 200 字:', String(t).slice(0, 200)); return true })
          .catch(function (e) { console.warn('[FETCH_ROLE_SEARCH] 预热 POST 失败(仍继续 GET):', e.message); return false })
      }

      if (!fetchAll) {
        warmUpSession()
          .then(function () { return fetchRolePage(1) })
          .then(function (res) {
            finish({ ok: true, items: res.items, count: res.items.length, paging: res.pager })
          })
          .catch(function (e) { finish({ ok: false, error: e.message }) })
        return true
      }

      // fetchAll：循环翻页直到末页；页间延时降低风控；出错停止但保留已采集。
      // 不单纯依赖 pager.total_pages（不同接口字段名不一致，识别不到会只采首页），
      // 改用「上一页不足一页量即末页」判定；pager 能识别页数时以它为硬上限，否则以 MAX_PAGES 兜底。
      // 反爬：一次采集最多翻 12 页（原 30 页过猛，短时间打出大量请求是触发藏宝阁风控的主因之一）
      const MAX_PAGES = 12
      warmUpSession()
        .then(function () { return fetchRolePage(1) })
        .then(function (first) {
          const allItems = first.items.slice()
          const pager = first.pager
          // 决定性取证：把页面真实渲染的头像与 API 字段（icon / equip_face_img）配对打印
          try { logRoleAvatarMatches(first.items) } catch (e) { console.log('[ROLE_MATCH] 调用异常: ' + e.message) }
          const pageSize = first.items.length || 1
          const pagerPages = roleTotalPages(pager)
          // pager 字段名在网易不同接口下不稳定，不可全信；以空页/重复页为主判定，pager 仅作参考上限
          const upper = pagerPages > 1 ? Math.min(pagerPages, MAX_PAGES) : MAX_PAGES
          let stop = false
          let warn = ''
          let prevSig = null
          let p = 2
          function nextPage() {
            if (stop || p > upper) return Promise.resolve()
            // 反爬节流：固定短间隔最容易被判定为机器行为。改为 2.0~3.5s 随机抖动，
            // 且每满 5 页再额外长休息 5~8s。此前 700ms 固定间隔过密，
            // 是触发藏宝阁风控（用户一度登不上）的诱因之一。
            const jitter = 2000 + Math.floor(Math.random() * 1500)
            const longRest = (p - 1) % 5 === 0 ? 5000 + Math.floor(Math.random() * 3000) : 0
            return roleSleep(jitter + longRest)
              .then(function () { return fetchRolePage(p) })
              .then(function (res) {
                console.log('[FETCH_ROLE_SEARCH] 第', p, '页', res.items.length, '条')
                if (!res.items.length) {
                  stop = true // 空页即末页
                  return
                }
                // 重复页检测：网易对超出实际页数的 page 常返回重复首页数据，据此提前停止避免无意义翻页
                const sig = res.items.map(function (it) { return it.eid }).join(',')
                if (sig === prevSig) {
                  stop = true
                  warn = '检测到重复页（已到末页），停止翻页'
                  return
                }
                prevSig = sig
                allItems.push.apply(allItems, res.items)
                p++
                return nextPage()
              })
              .catch(function (e) {
                stop = true
                // 命中风控（将军令/验证码/重新登录）时立即停止翻页、不再继续打请求，
                // 避免进一步加重封禁；已采集到的数据照常保留入库。
                warn = /将军令|验证码|重新登录|登录过期|captcha/i.test(e.message || '')
                  ? '⚠️ 命中藏宝阁风控，已立即停止翻页（请隔一段时间再试）'
                  : e.message
              })
          }
          return nextPage().then(function () {
            finish({ ok: true, items: allItems, count: allItems.length, paging: pager, warn: warn })
          })
        })
        .catch(function (e) {
          console.error('[FETCH_ROLE_SEARCH] 请求失败:', e.message)
          finish({ ok: false, error: e.message })
        })

      return true
    }
    })()
    // 异步 handler 内会调用 sendResponse，返回 true 保持响应通道
    return true
  })
  }

  // 调试入口：DevTools 里输入 __cbgDebug() 重新提取并打印
  window.__cbgDebug = function () {
    const r = scan()
    console.table && console.table(r.equip || r.items || r.deals || r)
    return r
  }

  init()
})()
