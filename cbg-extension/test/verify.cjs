// verify.cjs - 在 Node 中用 jsdom 加载真实 content.js，校验抓取逻辑
// 不依赖浏览器：用模拟的藏宝阁 DOM 验证 selectors/解析/页面类型/登录态识别。
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('/Users/zhy/.workbuddy/binaries/node/workspace/node_modules/jsdom')

const EXT = path.resolve(__dirname, '..')
const contentSrc = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8')

// 每个场景：HTML 文件 + 模拟访问的 URL（决定 ordersn/server_id/pageKind）
const scenarios = [
  {
    name: '装备详情页(已登录)',
    html: 'fixtures/equip_detail.html',
    url: 'https://xyq.cbg.163.com/cgi-bin/equip.py?act=view&ordersn=CBGTEST001&server_id=1',
    expect: (s) => {
      const a = []
      a.push(['kind=equip_detail', s.kind === 'equip_detail'])
      a.push(['loggedIn=true', s.loggedIn === true])
      a.push(['ordersn=CBGTEST001', s.equip && s.equip.ordersn === 'CBGTEST001'])
      a.push(['装备名解析', s.equip && /无级别/.test(s.equip.equip_name || '')])
      a.push(['现价=1234.5', s.equip && s.equip.current_price === 1234.5])
      a.push(['同类最低=1180', s.equip && s.equip.same_type_lowest === 1180])
      a.push(['服务器名=烟雨江南', s.equip && s.equip.server_name === '烟雨江南'])
      a.push(['成交2笔', s.deals && s.deals.length === 2])
      a.push(['成交价=1200/1210', s.deals && s.deals.length === 2 && s.deals[0].deal_price === 1200 && s.deals[1].deal_price === 1210])
      return a
    },
  },
  {
    name: '我的装备页(批量导入)',
    html: 'fixtures/my_equips.html',
    url: 'https://xyq.cbg.163.com/cgi-bin/userinfo.py?act=my_equips',
    expect: (s) => {
      const a = []
      a.push(['kind=my_equips', s.kind === 'my_equips'])
      a.push(['items>=1', s.items && s.items.length >= 1])
      a.push(['去重后=2条', s.items && s.items.length === 2])
      const sn = (s.items || []).map((i) => i.ordersn).sort()
      a.push(['ordersn 去重', JSON.stringify(sn) === JSON.stringify(['SN_A', 'SN_B'])])
      a.push(['SN_A 带服务器名', (s.items || []).some((i) => i.ordersn === 'SN_A' && i.server_name === '烟雨江南')])
      return a
    },
  },
  {
    name: '卖家标签提取(真实结构)',
    // 迪总在真实详情页用检查元素定位：<li><strong>卖家：</strong>樱语墨落．ら</li>
    html: 'fixtures/seller_label.html',
    url: 'https://xyq.cbg.163.com/equip?s=976&eid=202605281900113-976-A8IJ1F3LVVJU&client_type=web',
    expect: (s) => {
      const a = []
      a.push(['kind=equip_detail', s.kind === 'equip_detail'])
      a.push(['卖家名解析', s.equip && s.equip.equip_name === '樱语墨落．ら'])
      a.push(['现价=520(带（元）主价优先, 排除推荐760)', s.equip && s.equip.current_price === 520])
      return a
    },
  },
  {
    name: '其他页(未登录首页)',
    html: 'fixtures/other.html',
    url: 'https://xyq.cbg.163.com/',
    expect: (s) => {
      const a = []
      a.push(['kind=other', s.kind === 'other'])
      a.push(['loggedIn=false', s.loggedIn === false])
      a.push(['无 equip', !s.equip])
      a.push(['无 items', !s.items || s.items.length === 0])
      return a
    },
  },
  {
    name: '角色卖号详情页(新版 eid URL)',
    html: 'fixtures/role_eid.html',
    // 真实藏宝阁新版详情页：路径 /equip，唯一 ID 用 eid，服务器用 s
    url: 'https://xyq.cbg.163.com/equip?s=976&eid=202601280400113-976-WB9MZOZJTN3V&client_type=web',
    expect: (s) => {
      const a = []
      a.push(['kind=equip_detail', s.kind === 'equip_detail'])
      a.push(['loggedIn=true', s.loggedIn === true])
      a.push(['ordersn=eid值', s.equip && s.equip.ordersn === '202601280400113-976-WB9MZOZJTN3V'])
      a.push(['server_id=976', s.equip && s.equip.server_id === '976'])
      a.push(['角色名解析', s.equip && /化生寺/.test(s.equip.equip_name || '')])
      a.push(['现价=2500', s.equip && s.equip.current_price === 2500])
      a.push(['同类最低=2400', s.equip && s.equip.same_type_lowest === 2400])
      a.push(['成交2笔', s.deals && s.deals.length === 2])
      a.push(['成交价=2300/2280', s.deals && s.deals[0].deal_price === 2300 && s.deals[1].deal_price === 2280])
      return a
    },
  },
  {
    name: '搜索/列表结果页(成批采集)',
    html: 'fixtures/listing.html',
    url: 'https://xyq.cbg.163.com/cgi-bin/equip.py?act=search&server_id=976&query=%E6%AD%A6%E5%99%A8',
    expect: (s) => {
      const a = []
      a.push(['kind=listing', s.kind === 'listing'])
      const items = s.listItems || []
      a.push(['识别到3件', items.length === 3])
      const byEid = {}
      items.forEach((it) => { byEid[it.eid] = it })
      a.push(['eid=AAA 价格520', byEid['20260323-AAA'] && byEid['20260323-AAA'].price === 520])
      a.push(['eid=AAA 服务器=无与伦比', byEid['20260323-AAA'] && byEid['20260323-AAA'].server_name === '无与伦比'])
      a.push(['eid=AAA 名字=流云剑', byEid['20260323-AAA'] && byEid['20260323-AAA'].name === '流云剑'])
      a.push(['eid=AAA 属性含伤害', byEid['20260323-AAA'] && byEid['20260323-AAA'].attrs && byEid['20260323-AAA'].attrs['伤害'] === '620'])
      a.push(['eid=CCC 服务器=钓鱼岛', byEid['20260323-CCC'] && byEid['20260323-CCC'].server_name === '钓鱼岛'])
      a.push(['eid=CCC 有缩略图', byEid['20260323-CCC'] && !!byEid['20260323-CCC'].detail_url])
      return a
    },
  },
  {
    name: '玉魄搜索结果页(真实 tr 卡片结构)',
    html: 'fixtures/yupo_listing.html',
    url: 'https://xyq.cbg.163.com/cgi-bin/query.py?act=yupo_search&base_attrs1=%7B%22201%22%3A8%7D&base_attrs2=%7B%22201%22%3A8%7D',
    expect: (s) => {
      const a = []
      a.push(['kind=listing', s.kind === 'listing'])
      const items = s.listItems || []
      a.push(['识别到7件', items.length === 7])
      const byEid = {}
      items.forEach((it) => { byEid[it.eid] = it })
      const e1 = byEid['202606031800113-976-I56SZPDMWOAY']
      a.push(['eid1 价格=2900', e1 && e1.price === 2900])
      a.push(['eid1 名字=上古玉魄·阳', e1 && e1.name === '上古玉魄·阳'])
      a.push(['eid1 server_id=976', e1 && e1.server_id === '976'])
      a.push(['eid1 灵尘等级=6(来自textarea JSON)', e1 && e1.attrs && e1.attrs['灵尘等级'] === 6])
      a.push(['eid1 附加属性含"伤害 +10"', e1 && e1.attrs && /伤害 \+10/.test(e1.attrs['附加属性'] || '')])
      a.push(['eid1 附加属性=伤害 +10 / 伤害 +9(来自minghun.base)', e1 && e1.attrs && e1.attrs['附加属性'] === '伤害 +10 / 伤害 +9'])
      a.push(['eid1 基础属性含"封印命中等级"(来自init.desc)', e1 && e1.attrs && /封印命中等级/.test(e1.attrs['基础属性'] || '')])
      a.push(['eid1 特效=法伤化劲 +1%(effect.desc)', e1 && e1.attrs && e1.attrs['特效'] === '法伤化劲 +1%'])
      a.push(['eid1 奇袭=奇袭法术 +1%(effect.desc2)', e1 && e1.attrs && e1.attrs['奇袭'] === '奇袭法术 +1%'])
      a.push(['eid1 有详情链接', e1 && /eid=202606031800113-976-I56SZPDMWOAY/.test(e1.detail_url || '')])
      const e2 = byEid['202606102100113-976-VE0UJ8M5UN6J']
      a.push(['eid2 价格=5500', e2 && e2.price === 5500])
      a.push(['eid2 灵尘等级=9', e2 && e2.attrs && e2.attrs['灵尘等级'] === 9])
      const e3 = byEid['202604290600113-976-5RNUJKJEQ9PJ']
      a.push(['eid3 价格=2571.4', e3 && e3.price === 2571.4])
      // eid5：真实 overall_search 结构（无 .equip_name 元素，名字只在 data_equip_name 属性）
      const e5 = byEid['202601291900113-127-WF62QTLNVDWP']
      a.push(['eid5 名字=上古玉魄·阳(走data_equip_name属性路径)', e5 && e5.name === '上古玉魄·阳'])
      a.push(['eid5 灵尘等级=8(来自other_info textarea)', e5 && e5.attrs && e5.attrs['灵尘等级'] === 8])
      a.push(['eid5 特效=法伤化劲 +2%(来自effect.desc)', e5 && e5.attrs && e5.attrs['特效'] === '法伤化劲 +2%'])
      a.push(['eid5 奇袭=奇袭法术 +2%(来自effect.desc2)', e5 && e5.attrs && e5.attrs['奇袭'] === '奇袭法术 +2%'])
      a.push(['eid5 基础属性=封印命中等级 +12(来自init.desc)', e5 && e5.attrs && e5.attrs['基础属性'] === '封印命中等级 +12'])
      a.push(['eid5 server_id=127', e5 && e5.server_id === '127'])
      a.push(['eid5 无 .equip_name 兜底时名字仍正确', e5 && e5.name === '上古玉魄·阳' && !(e5.name && e5.name.indexOf('￥') >= 0)])
      // eid6：纯 DOM 卡片（无 equip_desc/other_info textarea），灵尘等级数字 + 奇袭<p> 同列，
      //   特效在【下一列】<td><p>法伤化劲 +2%</p></td>。验证从真实两列结构兜底抠出 等级/奇袭/特效。
      const e6 = byEid['202608200000113-200-DOMONLYTEST']
      a.push(['eid6 名字=上古玉魄·阴(走data_equip_name属性路径)', e6 && e6.name === '上古玉魄·阴'])
      a.push(['eid6 价格=3000', e6 && e6.price === 3000])
      a.push(['eid6 灵尘等级=10(从灵尘<td>数字兜底)', e6 && e6.attrs && e6.attrs['灵尘等级'] === 10])
      a.push(['eid6 奇袭=奇袭法术 +2%(从灵尘<td>的<p>兜底)', e6 && e6.attrs && e6.attrs['奇袭'] === '奇袭法术 +2%'])
      a.push(['eid6 特效=法伤化劲 +2%(从下一列<td>兜底)', e6 && e6.attrs && e6.attrs['特效'] === '法伤化劲 +2%'])
      a.push(['eid6 未被附加属性<td>的<p>误抓(奇袭≠伤害)', e6 && e6.attrs && e6.attrs['奇袭'] === '奇袭法术 +2%' && e6.attrs['奇袭'].indexOf('伤害') < 0])
      // eid7：迪总贴的真实全字段示例（hole.val=12 / effect.desc=法伤化劲 / desc2=奇袭法术）
      const e7 = byEid['202608191600113-795-MVX1FHIXICEN']
      a.push(['eid7 名字=上古玉魄·阳', e7 && e7.name === '上古玉魄·阳'])
      a.push(['eid7 价格=70999', e7 && e7.price === 70999])
      a.push(['eid7 灵尘等级=12(来自hole.val)', e7 && e7.attrs && e7.attrs['灵尘等级'] === 12])
      a.push(['eid7 特效=法伤化劲 +3.1%(来自effect.desc)', e7 && e7.attrs && e7.attrs['特效'] === '法伤化劲 +3.1%'])
      a.push(['eid7 奇袭=奇袭法术 +3%(来自effect.desc2)', e7 && e7.attrs && e7.attrs['奇袭'] === '奇袭法术 +3%'])
      a.push(['eid7 基础属性=速度 +8(来自init.desc)', e7 && e7.attrs && e7.attrs['基础属性'] === '速度 +8'])
      a.push(['eid7 附加属性含"伤害 +10"(色值标签已清理)', e7 && e7.attrs && /伤害 \+10 \[\+72\]/.test(e7.attrs['附加属性'] || '')])
      return a
    },
  },
]

let allPass = true
for (const sc of scenarios) {
  const html = fs.readFileSync(path.join(__dirname, sc.html), 'utf8')
  const dom = new JSDOM(html, { url: sc.url, runScripts: 'outside-only' })
  const win = dom.window
  // 模拟 chrome 扩展 API（content.js 使用 getURL/sendMessage/onMessage）
  win.chrome = {
    runtime: {
      getURL: (p) => p,
      sendMessage: () => {},
      onMessage: { addListener: () => {} },
    },
  }
  let err = null
  try {
    win.eval(contentSrc)
    // 强制重新扫描并取结果
    if (typeof win.__cbgDebug === 'function') win.__cbgDebug()
  } catch (e) {
    err = e
  }
  const scan = win.__cbgLastScan || null
  console.log('\n=== ' + sc.name + ' ===')
  if (err) {
    allPass = false
    console.log('  ✗ content.js 执行抛错: ' + err.message)
    continue
  }
  const checks = sc.expect(scan)
  for (const [label, ok] of checks) {
    if (!ok) allPass = false
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + label)
  }
}

console.log('\n' + (allPass ? '全部场景通过 ✅' : '存在失败场景 ❌'))
process.exit(allPass ? 0 : 1)
