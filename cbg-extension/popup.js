// popup.js - 藏宝阁助手弹窗逻辑
const $ = function (s) {
  return document.querySelector(s)
}
function msg(t) {
  $('#msg').textContent = t
}
function fmtPrice(n) {
  return n == null ? '—' : '¥' + Number(n).toLocaleString('zh-CN')
}

function send(type, extra) {
  return new Promise(function (res) {
    let done = false
    const timer = setTimeout(function () {
      if (done) return
      done = true
      res({ ok: false, error: '采集超时（>150s）：请确认藏宝阁页面已登录、扩展已重载，或重新打开藏宝阁页面再试' })
    }, 150000)
    chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) {
      if (done) return
      done = true
      clearTimeout(timer)
      res(r)
    })
  })
}

async function getStatus() {
  return send('GET_STATUS')
}
async function getPage() {
  return send('GET_PAGE')
}
async function listWatch() {
  return send('LIST_WATCH')
}
async function listSubs() {
  return send('LIST_SUBS')
}
async function getHistory(ordersn) {
  return send('GET_HISTORY', { ordersn: ordersn })
}
async function getDeals(ordersn) {
  return send('GET_DEALS', { ordersn: ordersn })
}

function renderItem(it, history, deals) {
  const li = document.createElement('li')

  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = it.equip_name || it.ordersn
  li.appendChild(name)

  const meta = document.createElement('div')
  meta.className = 'meta'
  let txt = (it.server_name || '') + '  ·  目标 ' + fmtPrice(it.target_price)
  if (history && history.points && history.points.length) {
    const last = history.points[history.points.length - 1]
    txt +=
      '\n现价 ' +
      fmtPrice(last.current_price) +
      '  /  同类最低 ' +
      fmtPrice(last.same_type_lowest)
  }
  if (deals && deals.deals && deals.deals.length) {
    const min = Math.min.apply(
      null,
      deals.deals.map(function (d) {
        return d.deal_price
      })
    )
    txt += '\n成交 ' + deals.deals.length + ' 笔，最低 ' + fmtPrice(min)
  }
  meta.textContent = txt
  meta.style.whiteSpace = 'pre-line'
  li.appendChild(meta)

  // 删除按钮
  const del = document.createElement('button')
  del.textContent = '删除'
  del.style.marginTop = '6px'
  del.style.flex = 'none'
  del.onclick = async function () {
    await send('DEL_WATCH', { ordersn: it.ordersn })
    msg('已删除：' + (it.equip_name || it.ordersn))
    refresh()
  }
  li.appendChild(del)
  return li
}

// 装备详情页：显示"订阅本装备"，已订阅则隐藏
async function updateSubscribeRow(watchItems) {
  const row = $('#subscribeRow')
  const subscribed = (watchItems || []).map(function (w) {
    return w.ordersn
  })
  const pg = await getPage()
  const page = (pg && pg.page) || {}
  if (page.kind === 'equip_detail' && page.ordersn && subscribed.indexOf(page.ordersn) < 0) {
    row.classList.add('show')
    row._page = page
  } else {
    row.classList.remove('show')
    row._page = null
  }
}

async function refresh() {
  const st = await getStatus()
  const statusEl = $('#status')
  if (st.loggedIn) {
    statusEl.textContent = '状态：已登录（数据隔离中）'
    statusEl.className = 'ok'
  } else {
    statusEl.textContent = '状态：未登录（请先在藏宝阁页面登录）'
    statusEl.className = 'no'
  }

  // 登录态备份信息
  const lb = await send('GET_LOGIN_BACKUP')
  const bi = $('#loginBackupInfo')
  if (lb && lb.at) {
    bi.textContent = '已备份（' + fmtBackupTime(lb.at) + '）'
  } else {
    bi.textContent = '未备份'
  }
  // 上次保活信息
  const ka = await send('GET_KEEPALIVE')
  const ki = $('#keepAliveInfo')
  if (ka && ka.at) {
    ki.textContent = fmtBackupTime(ka.at)
  } else {
    ki.textContent = '—'
  }

  const w = await listWatch()
  const items = (w && w.items) || []
  const ul = $('#list')
  ul.innerHTML = ''
  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = '暂无订阅。浏览藏宝阁装备/角色页或"我的装备"即可自动记录。'
    ul.appendChild(empty)
  } else {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const [history, deals] = await Promise.all([
        getHistory(it.ordersn),
        getDeals(it.ordersn),
      ])
      ul.appendChild(renderItem(it, history, deals))
    }
  }

  await updateSubscribeRow(items)
  await updateCaptureRow()
  await renderSubs()
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function fmtBackupTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = function (n) { return String(n).padStart(2, '0') }
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

async function renderSubs() {
  const r = await listSubs()
  const subs = (r && r.subscriptions) || []
  const ul = $('#subList')
  ul.innerHTML = ''
  if (!subs.length) {
    const e = document.createElement('div')
    e.className = 'empty'
    e.textContent = '暂无自动订阅。在藏品库页「保存为订阅」即可定时采集。'
    ul.appendChild(e)
    return
  }
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i]
    // 解析订阅类型，列表里显示徽章，避免和玉魄订阅点混
    let subTypeLabel = ''
    try {
      const c = JSON.parse(s.conditions_json || '{}')
      if (c.type === 'role') subTypeLabel = '角色'
      else if (c.type === 'yupo') subTypeLabel = '玉魄'
      else if (c.type) subTypeLabel = c.type
      else if (/show_role_search_result/.test(s.search_url || '')) subTypeLabel = '角色'
      else if (/yupo/i.test(s.search_url || '')) subTypeLabel = '玉魄'
      else subTypeLabel = '玉魄'
    } catch (e) {}
    const li = document.createElement('li')
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = s.name || ('#订阅' + s.id)
    li.appendChild(name)
    if (subTypeLabel) {
      const badge = document.createElement('span')
      badge.textContent = subTypeLabel
      const isRole = subTypeLabel === '角色'
      badge.style.cssText = 'display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;vertical-align:middle;' + (isRole ? 'background:rgba(34,211,238,0.18);color:#22d3ee;border:1px solid rgba(34,211,238,0.4)' : 'background:rgba(234,179,8,0.18);color:#eab308;border:1px solid rgba(234,179,8,0.4)')
      li.appendChild(badge)
    }
    const meta = document.createElement('div')
    meta.className = 'meta'
    let m = s.enabled ? '启用' : '已暂停'
    if (s.last_run) m += ' · 上次 ' + fmtTime(s.last_run)
    m += ' · 每 ' + (s.interval_minutes || 60) + ' 分'
    if (s.server_name) m += ' · ' + s.server_name
    meta.textContent = m
    li.appendChild(meta)
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.gap = '8px'
    row.style.marginTop = '6px'
    const btn = document.createElement('button')
    btn.textContent = '立即采集'
    btn.onclick = async function () {
      btn.disabled = true
      btn.textContent = '采集中…'
      const rr = await send('RUN_SUBSCRIPTION', { sub: s })
      btn.disabled = false
      btn.textContent = '立即采集'
      if (rr && rr.error) {
        msg('采集失败：' + rr.error)
      } else {
        msg('订阅「' + (s.name || s.id) + '」采集完成：扫描 ' + ((rr && rr.scanned) || 0) + ' 件，入库 ' + ((rr && rr.captured) || 0) + ' 件')
      }
    }
    const del = document.createElement('button')
    del.textContent = '删除'
    del.onclick = async function () {
      await send('DEL_SUB', { id: s.id })
      msg('已删除订阅：' + (s.name || s.id))
      renderSubs()
    }
    row.appendChild(btn)
    row.appendChild(del)
    li.appendChild(row)
    ul.appendChild(li)
  }
}

// 列表/搜索结果页：显示"采集本页全部物品"；玉魄页自动预填标签（阴阳/类型）
let labelEdited = false
$('#captureLabel').addEventListener('input', function () {
  labelEdited = true
})
async function updateCaptureRow() {
  const row = $('#captureRow')
  const pg = await getPage()
  const page = (pg && pg.page) || {}
  if (page.kind === 'listing' && page.itemCount > 0) {
    row.classList.add('show')
    row._count = page.itemCount
    const lbl = $('#captureLabel')
    // 玉魄页：用户未手动改过标签时，自动预填为玉魄阴阳/类型（如「上古玉魄·阳」）
    if (!labelEdited && page.yupoType) lbl.value = page.yupoType
    // 角色页：用户未手动改过标签时，自动预填为「角色」
    if (!labelEdited && page.roleLabel) lbl.value = page.roleLabel
  } else {
    row.classList.remove('show')
  }
}

async function scanCurrent() {
  const tabs = await new Promise(function (res) {
    chrome.tabs.query({ active: true, currentWindow: true }, res)
  })
  const tab = tabs[0]
  if (!tab || !/xyq\.cbg\.163\.com/.test(tab.url || '')) {
    msg('请先打开藏宝阁页面再扫描')
    return
  }
  chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' }, function (r) {
    if (chrome.runtime.lastError) {
      msg('扫描失败：' + chrome.runtime.lastError.message)
      return
    }
    msg(r && r.ok ? '已扫描：' + (r.kind || '未知页') : '扫描失败')
    setTimeout(refresh, 800)
  })
}

$('#scan').onclick = scanCurrent
$('#refresh').onclick = refresh

// 登录态备份 / 恢复
$('#backupLoginBtn').onclick = async function () {
  const r = await send('BACKUP_LOGIN')
  if (r && r.ok) {
    msg('已备份登录态（' + r.count + ' 个 Cookie）')
  } else {
    msg('备份失败：' + ((r && r.error) || '未知'))
  }
  refresh()
}
$('#restoreLoginBtn').onclick = async function () {
  const r = await send('RESTORE_LOGIN')
  if (r && r.ok) {
    msg('已尝试恢复 ' + r.count + ' 个 Cookie，请刷新藏宝阁页面确认（若仍提示未登录，说明服务端会话已过期，需真登录）')
  } else {
    msg('恢复失败：' + ((r && r.error) || '未知'))
  }
  refresh()
}
$('#keepAliveBtn').onclick = async function () {
  const r = await send('KEEPALIVE_NOW')
  if (r && r.ok) {
    msg('已保活（服务端会话已续命），下次约 20 分钟后自动保活')
  } else if (r && r.skipped === 'not_logged_in') {
    msg('当前未登录，无法保活，请先登录并点「备份当前登录」')
  } else if (r && r.skipped === 'disabled') {
    msg('保活已关闭')
  } else {
    msg('保活失败：' + ((r && r.error) || '未知'))
  }
  refresh()
}

$('#captureBtn').onclick = async function () {
  const tabs = await new Promise(function (res) {
    chrome.tabs.query({ active: true, currentWindow: true }, res)
  })
  const tab = tabs[0]
  if (!tab || !/xyq\.cbg\.163\.com/.test(tab.url || '')) {
    msg('请先打开藏宝阁页面再采集')
    return
  }
  // 根据URL判断页面类型
  const url = tab.url || ''
  let itemType = 'equip'  // 默认装备
  if (/show_role_search_result|overall_search_role/.test(url)) {
    itemType = 'role'
  } else if (/overall_search_yupo|recommend\.py.*yupo/.test(url) || /玉魄/.test(url)) {
    itemType = 'yupo'
  } else if (/show_overall_search_pet|pet_search/.test(url)) {
    itemType = 'pet'
  }
  // 获取页面信息，让 content script 也能判断类型（解决 POST 表单后 URL 不含 act 参数的问题）
  let page = null
  try {
    const pg = await send('GET_PAGE')
    page = (pg && pg.page) || {}
    // content script 检测到角色/玉魄标签时，优先使用
    if (page.roleLabel) itemType = 'role'
    else if (page.yupoType) itemType = 'yupo'
  } catch (e) {}
  chrome.tabs.sendMessage(tab.id, { type: 'LIST_SCAN' }, async function (r) {
    if (chrome.runtime.lastError) {
      msg('采集失败：' + chrome.runtime.lastError.message)
      return
    }
    const items = (r && r.items) || []
    if (!items.length) {
      msg('本页没识别到物品卡片，确认是搜索/列表结果页，或翻到底等加载完')
      return
    }
    const label = ($('#captureLabel').value || '').trim() || '未分类'
    const rr = await send('CAPTURE_ITEMS', { label: label, item_type: itemType, items: items })
    if (rr && rr.ok) {
      msg('已采集 ' + (rr.captured || items.length) + ' 件到藏品库（标签：' + label + '，类型：' + itemType + '）')
    } else {
      msg('采集失败：' + ((rr && rr.error) || '未知'))
    }
  })
}

$('#refreshStatusBtn').onclick = async function () {
  msg('正在刷新在售状态…（需已登录的藏宝阁页面）')
  const r = await send('REFRESH_STATUS')
  if (r && r.ok) {
    msg('刷新完成：共 ' + (r.done || 0) + ' 件，回写 ' + (r.updated || 0) + ' 件')
  } else {
    msg('刷新失败：' + ((r && r.error) || '未知') + '（请先打开已登录的藏宝阁页面）')
  }
}

$('#subscribeBtn').onclick = async function () {
  const row = $('#subscribeRow')
  const page = row._page
  if (!page || !page.ordersn) {
    msg('当前页未识别到装备，无法订阅')
    return
  }
  const tp = parseFloat($('#targetPrice').value)
  const r = await send('ADD_WATCH', {
    ordersn: page.ordersn,
    server_id: page.server_id || null,
    server_name: page.server_name || null,
    equip_name: page.equip_name || null,
    target_price: isNaN(tp) ? null : tp,
  })
  if (r && r.ok) {
    msg('已订阅盯价：' + (page.equip_name || page.ordersn))
    row.classList.remove('show')
    refresh()
  } else {
    msg('订阅失败：' + ((r && r.error) || '未知'))
  }
}

refresh()
