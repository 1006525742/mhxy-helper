<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { cbgApi } from '@/services/cbgApi'
import RoleSearchView from '@/views/RoleSearchView.vue'

// 藏品库顶部搜索面板切换：玉魄 / 角色（侧边栏切换）
const activeSearchTab = ref<'yupo' | 'role'>('yupo')

// 保存/恢复标签页状态
const TAB_STORAGE_KEY = 'cbg_active_tab'
watch(activeSearchTab, (v) => {
  localStorage.setItem(TAB_STORAGE_KEY, v)
})

interface CapturedItem {
  id?: number
  eid: string
  server_id?: string | null
  server_name?: string | null
  name?: string | null
  price?: number | null
  first_price?: number | null
  attrs_json?: string | null
  thumb_url?: string | null
  local_thumb?: string | null
  detail_url?: string | null
  capture_label?: string | null
  captured_at?: number
  dropped?: boolean
  status?: string
  item_type?: string | null  // yupo / role / equip / pet ...
}

interface LabelInfo {
  capture_label: string
  cnt: number
  min_price: number | null
  max_price: number | null
  last_at: number | null
}

const labels = ref<LabelInfo[]>([])
const items = ref<CapturedItem[]>([])
const activeLabel = ref<string>('all')
const server = ref('')
const kw = ref('')
const minPrice = ref<string>('')
const maxPrice = ref<string>('')
const sort = ref<string>('time_desc')
const statusFilter = ref('')
const msg = ref('')
const yupoOpen = ref(false) // 「去藏宝阁搜玉魄」面板默认收起

async function loadLabels() {
  try {
    const r = await cbgApi.listLabels('role')
    labels.value = r.labels || []
  } catch (e) {
    /* ignore */
  }
}

async function loadItems() {
  const params: Record<string, string | number> = {}
  if (activeLabel.value && activeLabel.value !== 'all') params.label = activeLabel.value
  if (server.value.trim()) params.server = server.value.trim()
  if (kw.value.trim()) params.kw = kw.value.trim()
  if (minPrice.value) params.min_price = Number(minPrice.value)
  if (maxPrice.value) params.max_price = Number(maxPrice.value)
  params.sort = sort.value
  // 玉魄页面只查玉魄类型（精确隔离，避免混入 equip/pet 等兜底类型）
  params.item_type = 'yupo'
  try {
    const r = await cbgApi.listItems(params)
    items.value = r.items || []
  } catch (e) {
    msg.value = '加载失败：' + (e as Error).message
  }
}

// 缩略图：优先用本机后端托管的本地图，绕开网易 CDN 防盗链；失败再回退远程，再失败则隐藏
function thumbSrc(it: CapturedItem): string {
  if (it.local_thumb) return '/api/cbg/thumb/' + it.local_thumb
  return it.thumb_url || ''
}
function onImgError(e: Event, it: CapturedItem) {
  const el = e.target as HTMLImageElement
  if (it.thumb_url && el.src !== it.thumb_url) {
    el.src = it.thumb_url
  } else {
    el.style.display = 'none'
  }
}

function parseAttrs(it: CapturedItem): Record<string, string> {
  if (!it.attrs_json) return {}
  try {
    const o = JSON.parse(it.attrs_json)
    return typeof o === 'object' && o ? o : {}
  } catch {
    return {}
  }
}

// 判断是否为玉魄（藏品库需按藏宝阁真实列分列展示）
function isYupo(it: CapturedItem): boolean {
  // 优先看 item_type 字段
  if (it.item_type === 'yupo') return true
  if (it.item_type && it.item_type !== 'yupo') return false  // 明确指定非玉魄类型
  // 无 item_type 时，回退到属性判断（兼容旧数据）
  if ((it.name || '').includes('玉魄')) return true
  const a = parseAttrs(it)
  return '灵尘等级' in a || '基础属性' in a || '附加属性' in a || '奇袭' in a
}
// 判断是否为角色
function isRole(it: CapturedItem): boolean {
  if (it.item_type === 'role') return true
  if (it.item_type && it.item_type !== 'role') return false
  // 无 item_type 时，根据 attrs 判断：角色属性含 门派/等级/攻修 等；玉魄含灵尘等级等
  const a = parseAttrs(it)
  if ('门派' in a || '攻修' in a || '法修' in a) return true
  return !('灵尘等级' in a || '基础属性' in a || '附加属性' in a || '奇袭' in a || (it.name || '').includes('玉魄'))
}
// 列表含玉魄时，藏品表格切换为藏宝阁同款四列（基础属性/附加属性/灵尘等级/特效）
const hasYupo = computed(() => filteredItems.value.some(isYupo))
function attrVal(it: CapturedItem, k: string): string {
  const a = parseAttrs(it)
  const v = a[k]
  return v == null ? '-' : String(v)
}
// 附加属性按 / 分割成多行
function attrLines(it: CapturedItem, k: string): string[] {
  const a = parseAttrs(it)
  const v = a[k]
  if (v == null) return ['-']
  return String(v).split('/').map(s => s.trim()).filter(s => s)
}

// 按 server_id 反查中文服务器名（藏品库里 server_name 缺失时兜底，避免显示编号）
function serverLabelById(id?: string | null): string {
  if (!id) return ''
  const f = serverMap.value.servers.find((s) => s.server_id === String(id))
  return f ? f.server_name : `服务器${id}`
}

function fmtPrice(p?: number | null): string {
  if (p == null) return '-'
  return '¥' + Number(p)
}

function fmtTime(ts?: number | null): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 在售状态徽标样式
function statusClass(s?: string): string {
  const v = s || '在售'
  if (v === '已售') return 'st-sold'
  if (v === '已下架') return 'st-off'
  return 'st-on'
}

// 刷新在售状态：真正查询只能在已登录的藏宝阁页面由插件完成，这里引导用户并打开首页
function guideRefresh() {
  msg.value = '刷新需在已登录的藏宝阁页面：点浏览器工具栏「藏宝阁助手」插件 → 弹窗里点「刷新藏品库状态」。已为你打开藏宝阁首页。'
  window.open('https://xyq.cbg.163.com/', '_blank', 'noopener')
}

// 点击整行 → 直接跳到藏宝阁该物品详情页
function openCbg(it: CapturedItem) {
  if (it.detail_url) window.open(it.detail_url, '_blank', 'noopener')
}

// ---- 藏宝阁「上古玉魄」真实筛选选项（来自 advance_search_panel 实际 HTML）----
const ATTRS = [
  { v: 101, t: '气血' }, { v: 102, t: '防御' }, { v: 103, t: '法防' }, { v: 104, t: '抗物理' },
  { v: 105, t: '抗法术' }, { v: 106, t: '抗封印' }, { v: 107, t: '格挡' }, { v: 108, t: '气血回复' },
  { v: 109, t: '抗固伤' }, { v: 201, t: '伤害' }, { v: 202, t: '速度' }, { v: 203, t: '法术伤害' },
  { v: 204, t: '狂暴' }, { v: 205, t: '物理暴击' }, { v: 206, t: '法术暴击' }, { v: 207, t: '封印命中' },
  { v: 208, t: '法伤结果' }, { v: 209, t: '穿刺' }, { v: 210, t: '治疗能力' }, { v: 211, t: '固伤暴击' },
]
const YUPO_TYPE = [{ v: 61717, t: '上古玉魄·阴' }, { v: 61718, t: '上古玉魄·阳' }]
const EFFECTS = [
  { v: 1, t: '奇袭法术' }, { v: 4, t: '物伤化劲' }, { v: 5, t: '法伤化劲' },
  { v: 6, t: '固伤化劲' }, { v: 7, t: '坚固无痕' }, { v: 8, t: '坚如磐石' },
]
const TEJI = [
  { v: 61750, t: '野兽之力' }, { v: 61751, t: '放下屠刀' }, { v: 61752, t: '光辉之甲' },
  { v: 61753, t: '破甲术' }, { v: 61754, t: '玄鸟之灵' }, { v: 61755, t: '伯牙绝弦' },
  { v: 61756, t: '妙法之护' }, { v: 61757, t: '攻心术' }, { v: 61758, t: '流云诀' }, { v: 61759, t: '凝滞术' },
]
const DAOJU = [
  { v: 61738, t: '小还丹' }, { v: 61739, t: '千年保心丹' }, { v: 61740, t: '蛇蝎美人' },
  { v: 61741, t: '金香玉' }, { v: 61742, t: '红雪散' }, { v: 61743, t: '风水混元丹' },
  { v: 61744, t: '定神香' }, { v: 61745, t: '十香返生丸' }, { v: 61746, t: '紫心玉露丸' },
  { v: 61747, t: '黑玉云苓膏' }, { v: 61748, t: '百炼金乌丸' }, { v: 61749, t: '回春龙沙散' },
]

// 完整区服映射：64 大区 / 335 服，来自藏宝阁 server_list_data.js，已落盘 public/cbg_servers.json
interface ServerInfo { server_id: string; server_name: string; area_name: string; area_id: string }
interface ServerMap { source: string; areas: { area_id: string; area_name: string }[]; servers: ServerInfo[] }
const serverMap = ref<ServerMap>({ source: '', areas: [], servers: [] })
const selArea = ref('58')        // 默认「无与伦比」
const selServerId = ref('976')   // 默认「梦幻西游」
const selServerName = computed(() => {
  const f = serverMap.value.servers.find((s) => s.server_id === selServerId.value)
  return f ? f.server_name : (selServerId.value ? `服务器${selServerId.value}` : '')
})
const selAreaName = computed(() => {
  const f = serverMap.value.areas.find((a) => a.area_id === selArea.value)
  return f ? f.area_name : (selArea.value ? `区${selArea.value}` : '')
})
async function loadServerMap() {
  try {
    const r = await fetch('/cbg_servers.json')
    if (r.ok) serverMap.value = await r.json()
  } catch (e) {
    /* 离线时降级为手填 server_id */
  }
}
// ---- 服务器开服时间/服龄映射（server_id -> {date, age, source}）----
interface ServerAgeInfo { name?: string; area?: string; date?: string; age?: string; source?: string }
const serverAges = ref<Record<string, ServerAgeInfo>>({})
async function loadServerAges() {
  try {
    const r = await fetch('/cbg_server_ages.json')
    if (r.ok) serverAges.value = await r.json()
  } catch (e) {
    /* 忽略 */
  }
}
// 服龄档位 -> 中文标签（对齐藏宝阁「开服时间」三档）
const AGE_LABEL: Record<string, string> = {
  old: '3年以上服',
  mid: '1-3年服',
  new: '1年内服',
}
function serverAgeLabel(sid?: string | null): string {
  if (!sid) return ''
  const a = serverAges.value[String(sid)]
  return a && a.age ? (AGE_LABEL[a.age] || '') : ''
}
// 服龄徽标配色：old 沉稳/ mid 中性 / new 醒目
function serverAgeClass(sid?: string | null): string {
  if (!sid) return ''
  const a = serverAges.value[String(sid)]
  return a && a.age ? ('age-' + a.age) : ''
}
// ---- 选服弹窗（仿藏宝阁跨服购买弹窗）----
const serverDialogOpen = ref(false)
const dialogArea = ref('58')      // 弹窗内当前大区
const dialogKeyword = ref('')     // 弹窗内服务器搜索关键字
// 弹窗内服务器列表：按大区过滤 + 按关键字模糊匹配（有搜索词时跨全部大区）
const dialogServers = computed<ServerInfo[]>(() => {
  let list = serverMap.value.servers
  if (dialogArea.value && !dialogKeyword.value.trim()) {
    list = list.filter((s) => s.area_id === dialogArea.value)
  }
  const kw = dialogKeyword.value.trim()
  if (kw) list = list.filter((s) => s.server_name.includes(kw))
  return list
})
function openServerDialog() {
  dialogArea.value = selArea.value
  dialogKeyword.value = ''
  serverDialogOpen.value = true
}
function pickServer(s: ServerInfo) {
  selArea.value = s.area_id
  selServerId.value = s.server_id
  serverDialogOpen.value = false
}

// 去搜表单状态（对应玉魄搜索页字段）
const yupo = reactive({
  scope: 'cross' as 'single' | 'cross', // 默认走全服搜索页（cross）；single=单服(按所选服务器)
  yupo_equip_type: '' as string | number,
  init_attr: '' as string | number, init_val: '',
  total_attr: '' as string | number, total_val: '',
  base1: '' as string | number, base1_val: '',
  base2: '' as string | number, base2_val: '',
  mh_level: '', mh_ext: false,
  effect: '' as string | number, effect_val: '',
  teji: '' as string | number, daoju: '' as string | number,
  fair_show: false,
  min_price: '', max_price: '',
})
// 相同属性多选（灵尘+1/灵尘+2），对应藏宝阁 CommonAttr: [[1,"灵尘+1"],[2,"灵尘+2"]]
const sameProps = ref<string[]>([])

// ---- 搜索条件本地存储 ----
const YUPO_STORAGE_KEY = 'cbg_yupo_conditions'
function saveYupoConditions() {
  const data = {
    yupo: { ...yupo },
    sameProps: sameProps.value,
    serverTypes: serverTypes.value,
    selScopeArea: selScopeArea.value,
    selScopeServer: selScopeServer.value,
    selArea: selArea.value,
    selServerId: selServerId.value,
  }
  localStorage.setItem(YUPO_STORAGE_KEY, JSON.stringify(data))
}
function loadYupoConditions() {
  try {
    const raw = localStorage.getItem(YUPO_STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.yupo) {
      Object.assign(yupo, data.yupo)
      // 确保 scope 是合法值
      if (data.yupo.scope !== 'single' && data.yupo.scope !== 'cross') {
        yupo.scope = 'cross'
      }
    }
    if (Array.isArray(data.sameProps)) sameProps.value = data.sameProps
    if (Array.isArray(data.serverTypes)) serverTypes.value = data.serverTypes
    if (data.selScopeArea) selScopeArea.value = data.selScopeArea
    if (data.selScopeServer) selScopeServer.value = data.selScopeServer
    if (data.selArea) selArea.value = data.selArea
    if (data.selServerId) selServerId.value = data.selServerId
  } catch (e) {
    /* 解析失败忽略 */
  }
}
function clearYupoConditions() {
  // 重置 yupo 对象
  yupo.scope = 'cross'
  yupo.yupo_equip_type = ''
  yupo.init_attr = ''; yupo.init_val = ''
  yupo.total_attr = ''; yupo.total_val = ''
  yupo.base1 = ''; yupo.base1_val = ''
  yupo.base2 = ''; yupo.base2_val = ''
  yupo.mh_level = ''; yupo.mh_ext = false
  yupo.effect = ''; yupo.effect_val = ''
  yupo.teji = ''; yupo.daoju = ''
  yupo.fair_show = false
  yupo.min_price = ''; yupo.max_price = ''
  sameProps.value = []
  serverTypes.value = []
  selScopeArea.value = ''
  selScopeServer.value = ''
  localStorage.removeItem(YUPO_STORAGE_KEY)
  msg.value = '已清空所有搜索条件'
}
function toggleSameProp(v: string) {
  const i = sameProps.value.indexOf(v)
  if (i >= 0) sameProps.value.splice(i, 1)
  else sameProps.value.push(v)
}
// 跨服「服务器范围」块（对齐藏宝阁真实页面）：开服时间 + 指定区服
// 开服时间三档可多选，对应藏宝阁 ServerTypes: [[3,3年以上服],[2,1到3年服],[1,1年内服]]
const serverTypes = ref<string[]>([])   // 多选：'3'(3年以上) / '2'(1到3年) / '1'(1年内)
function toggleServerType(v: string) {
  const i = serverTypes.value.indexOf(v)
  if (i >= 0) serverTypes.value.splice(i, 1)
  else serverTypes.value.push(v)
}
const selScopeArea = ref('')       // 指定区服-区
const selScopeServer = ref('')     // 指定区服-服务器
const scopeServers = computed<ServerInfo[]>(() => {
  let list = serverMap.value.servers
  if (selScopeArea.value) list = list.filter((s) => s.area_id === selScopeArea.value)
  return list
})
// 「选择已登录服务器」：把范围服务器直接设为当前已选服（即选择服务器块里的服）
function pickLoginServer() {
  selScopeArea.value = selArea.value
  selScopeServer.value = selServerId.value
}

// 生成 recommend.py 的完整请求 URL（全服搜索真正发起的请求，需登录态，由插件直调）。
// 全服搜索页 show_overall_search_yupo 是 SPA，URL 不变；真实搜索靠 recommend.py 返回 JSON。
// 参数已按迪总贴的真实 Request URL 校准：
//   act=recommd_by_role / search_type=yupo_search / view_loc=overall_search / count=15 / page=1
//   属性值是字符串 {"202":"1"}（非数字）；特效值 ×10 {"1":10}；价格 ×100(元→分)
//   same_prop_cnt 相同属性多选；server_type 开服时间多选(3=3年以上/2=1到3年/1=1年内)
function buildCbgSearchUrl(): string {
  const y = yupo
  const cross = y.scope === 'cross'
  const p: string[] = []
  // 普通属性 JSON：值用【字符串】（藏宝阁真实请求 init_attrs={"202":"1"}）
  const attrJSON = (code: unknown, val: string): string | null => {
    if (!code || !val) return null
    return encodeURIComponent(JSON.stringify({ [String(code)]: String(val) }))
  }
  if (cross) {
    // 全服搜索走 recommend.py（推荐接口，返回结构化 JSON）
    p.push('act=recommd_by_role')
    p.push('page=1')
    p.push('count=15')
    p.push('search_type=yupo_search')
    p.push('view_loc=overall_search')
  }
  if (y.yupo_equip_type) p.push('equip_type=' + y.yupo_equip_type)
  const initJ = attrJSON(y.init_attr, y.init_val); if (initJ) p.push('init_attrs=' + initJ)
  const totalJ = attrJSON(y.total_attr, y.total_val); if (totalJ) p.push('total_attrs=' + totalJ)
  const b1 = attrJSON(y.base1, y.base1_val); if (b1) p.push('base_attrs1=' + b1)
  const b2 = attrJSON(y.base2, y.base2_val); if (b2) p.push('base_attrs2=' + b2)
  // 相同属性多选（灵尘+1/灵尘+2）
  if (sameProps.value.length) p.push('same_prop_cnt=' + sameProps.value.join(','))
  if (y.mh_level) p.push('minghun_level_min=' + encodeURIComponent(y.mh_level))
  if (y.mh_ext) p.push('include_ext_mh_lv=1')
  // 特效：值 ×10（如 1 → 10），且是数字
  if (y.effect && y.effect_val) {
    const effJ = encodeURIComponent(JSON.stringify({ [String(y.effect)]: Number(y.effect_val) * 10 }))
    p.push('minghun_effect=' + effJ)
  }
  if (y.teji) p.push('special_teji=' + y.teji)
  if (y.daoju) p.push('special_daoju=' + y.daoju)
  // 出售状态：全服页「已上架/公示期」多选(全选不传参)；前端「显示公示期」checkbox
  //   - 不勾选(默认)=只看已上架 → pass_fair_show=1
  //   - 勾选=含公示期(全选) → 不传参
  if (cross) {
    if (!y.fair_show) p.push('pass_fair_show=1')
  } else {
    if (y.fair_show) p.push('chk_include_fair_show=1')
  }
  // 价格：全服页 price_min/price_max 且 ×100(元→分)，单服页 min_price/max_price 原样
  if (y.min_price) {
    if (cross) p.push('price_min=' + String(Math.round(Number(y.min_price) * 100)))
    else p.push('min_price=' + y.min_price)
  }
  if (y.max_price) {
    if (cross) p.push('price_max=' + String(Math.round(Number(y.max_price) * 100)))
    else p.push('max_price=' + y.max_price)
  }
  // 开服时间三档多选（仅全服页）：server_type=3,2,1（3=3年以上 / 2=1到3年 / 1=1年内）
  if (cross && serverTypes.value.length) p.push('server_type=' + serverTypes.value.join(','))
  // 服务器：全服页 serverid，单服页 server_id（选了指定区服才带，全服不限则不带）
  const sid = cross ? selScopeServer.value : selServerId.value
  if (sid) p.push((cross ? 'serverid' : 'server_id') + '=' + encodeURIComponent(sid))
  const base = cross
    ? 'https://xyq.cbg.163.com/cgi-bin/recommend.py'
    : 'https://xyq.cbg.163.com/cgi-bin/query.py?act=yupo_search'
  return base + (cross ? '?' : '&') + p.join('&')
}
function goCbgSearch() {
  saveYupoConditions()  // 搜索前保存条件
  // 跳转到全服搜索页（纯 URL，条件在页面上手动选；搜索靠页内 recommend.py 请求）
  const cross = yupo.scope === 'cross'
  const base = cross
    ? 'https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_overall_search_yupo'
    : buildCbgSearchUrl()
  window.open(base, '_blank', 'noopener')
}

// ---- 自动采集订阅 ----
interface Subscription {
  id: number
  name: string
  server_id?: string | null
  server_name?: string | null
  search_url?: string
  conditions_json?: string | null
  label?: string | null
  interval_minutes?: number
  enabled?: boolean
  last_run?: number | null
  next_run?: number | null
  last_result?: string | null
  created_at?: number
}
const subs = ref<Subscription[]>([])
const subForm = reactive({ name: '', label: '', interval_minutes: 60 })
const nowSec = ref(Math.floor(Date.now() / 1000))

// 上次采集结果 → 可读文本（last_result 是 {"scanned":N,"captured":N,"error":...}）
function subResultText(s: Subscription): string {
  if (!s.last_result) return ''
  try {
    const r = JSON.parse(s.last_result)
    if (r.error) return '上次采集失败：' + r.error
    return '上次采到 ' + (r.captured || 0) + ' 件'
  } catch {
    return ''
  }
}

// 当前筛选对应的服务器（与 buildCbgSearchUrl 同口径）：全服只认「指定区服」，不限则空
function subServerId(): string {
  return yupo.scope === 'cross' ? selScopeServer.value : selServerId.value
}
function subServerName(): string {
  const sid = subServerId()
  const f = serverMap.value.servers.find((s) => s.server_id === String(sid))
  return f ? f.server_name : (selServerName.value || '')
}

async function loadSubs() {
  try {
    const r = await cbgApi.listSubscriptions()
    // 只展示本页（玉魄/装备）订阅，角色订阅由角色页单独展示，两边各管各的互不相串。
    // 判定依据同样是 conditions_json.type（与角色页 loadRoleSubs 的 c.type==='role' 互补）。
    subs.value = (r.subscriptions || [])
      .filter((s: any) => {
        try {
          const c = JSON.parse(s.conditions_json || '{}')
          return c.type !== 'role'
        } catch {
          return true // 无 conditions_json 的老订阅按玉魄处理
        }
      })
      .map((s: Subscription) => ({ ...s, enabled: !!s.enabled }))
  } catch (e) {
    /* ignore */
  }
}

async function saveAsSubscription() {
  const url = buildCbgSearchUrl()
  if (!url) {
    msg.value = '无法生成搜索链接，请先选好服务器与条件'
    return
  }
  const name = subForm.name.trim() || (subServerName() + '·玉魄订阅')
  const label = subForm.label.trim() || name
  const conditions = {
    scope: yupo.scope,
    server_id: subServerId(),
    server_name: subServerName(),
    serverTypes: [...serverTypes.value],
    sameProps: [...sameProps.value],
    selScopeArea: selScopeArea.value,
    selScopeServer: selScopeServer.value,
    yupo: JSON.parse(JSON.stringify(yupo)),
  }
  try {
    await cbgApi.addSubscription({
      name,
      server_id: subServerId(),
      server_name: subServerName(),
      search_url: url,
      conditions_json: JSON.stringify(conditions),
      label,
      interval_minutes: Number(subForm.interval_minutes) || 60,
      enabled: true,
    })
    msg.value = `已保存订阅「${name}」，浏览器开着且已登录藏宝阁时将每 ${subForm.interval_minutes} 分钟自动采集。`
    subForm.name = ''
    subForm.label = ''
    await loadSubs()
  } catch (e) {
    msg.value = '保存订阅失败：' + (e as Error).message
  }
}

async function runSubNow(id: number) {
  try {
    await cbgApi.runSubscriptionNow(id)
    msg.value = '已触发，等待插件执行（约 1 分钟内，浏览器需开着藏宝阁页面）…'
    await loadSubs()
    const before = subs.value.find((s) => s.id === id)?.last_run
    // 轮询等待插件执行完成（alarm 每 1 分钟 tick，最多等 ~75 秒）
    let done = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      await loadSubs()
      const s = subs.value.find((x) => x.id === id)
      if (s && s.last_run && s.last_run !== before) { done = true; break }
    }
    if (done) {
      const s = subs.value.find((x) => x.id === id)
      const txt = s ? subResultText(s) : ''
      msg.value = txt || '采集完成，刷新藏品列表查看'
    } else {
      msg.value = '已排队但插件尚未执行：请确认插件已加载、藏宝阁页面开着并已登录'
    }
    await loadSubs()
    await loadItems()
  } catch (e) {
    msg.value = '触发失败：' + (e as Error).message
  }
}

async function delSub(id: number) {
  if (!confirm('确定删除该订阅？已采集的藏品不会删除。')) return
  try {
    await cbgApi.delSubscription(id)
    subs.value = subs.value.filter((s) => s.id !== id)
  } catch (e) {
    msg.value = '删除失败：' + (e as Error).message
  }
}

async function toggleSub(sub: Subscription) {
  const next = !sub.enabled
  sub.enabled = next
  try {
    await cbgApi.updateSubscription(sub.id, { enabled: next })
  } catch (e) {
    sub.enabled = !next
    msg.value = '切换失败：' + (e as Error).message
  }
}

// 订阅下次执行倒计时（依赖 nowSec 每 30s 刷新）
function subNextText(sub: Subscription): string {
  if (sub.next_run == null) return '待首次执行'
  const diff = Math.floor(sub.next_run - nowSec.value)
  if (diff <= 0) return '已到期 · 待执行'
  if (diff < 60) return `约 ${diff} 秒后`
  if (diff < 3600) return `约 ${Math.floor(diff / 60)} 分钟后`
  return `约 ${(diff / 3600).toFixed(1)} 小时后`
}
function subNextClass(sub: Subscription): string {
  if (sub.next_run == null) return 'sub-pending'
  return Math.floor(sub.next_run - nowSec.value) <= 0 ? 'sub-due' : 'sub-wait'
}

// 解析订阅 conditions_json，生成「订阅了什么」的可读标签（常驻显示在卡片上）
function subConditions(sub: any): string[] {
  const out: string[] = []
  if (!sub || !sub.conditions_json) return out
  let c: any = null
  try { c = JSON.parse(sub.conditions_json) } catch (e) { return out }
  if (!c) return out
  const attrName = (v: any) => {
    const o = ATTRS.find((x: any) => String(x.v) === String(v)); return o ? o.t : String(v)
  }
  const findName = (list: any[], v: any) => {
    const o = list.find((x: any) => String(x.v) === String(v)); return o ? o.t : String(v)
  }
  // 搜索范围
  if (c.scope === 'single') out.push('单服(按所选服)')
  else if (c.scope === 'cross') out.push('全服搜索')
  // 开服时间三档
  const ageMap: Record<string, string> = { '3': '3年以上服', '2': '1-3年服', '1': '1年内服' }
  if (Array.isArray(c.serverTypes) && c.serverTypes.length) {
    out.push('服龄: ' + c.serverTypes.map((x: string) => ageMap[x] || x).join('/'))
  }
  // 指定区服
  if (c.selScopeServer) out.push('指定服: ' + (c.selScopeServer_name || c.selScopeServer))
  // 相同属性(灵尘+1/+2)
  const sameMap: Record<string, string> = { '1': '灵尘+1', '2': '灵尘+2' }
  if (Array.isArray(c.sameProps) && c.sameProps.length) {
    out.push('灵尘: ' + c.sameProps.map((x: string) => sameMap[x] || x).join('/'))
  }
  const y = c.yupo || {}
  if (y.yupo_equip_type) out.push(findName(YUPO_TYPE, y.yupo_equip_type))
  if (y.init_attr) out.push('基础' + attrName(y.init_attr) + '≥' + (y.init_val || ''))
  if (y.total_attr) out.push('总' + attrName(y.total_attr) + '≥' + (y.total_val || ''))
  if (y.base1) out.push('附加1 ' + attrName(y.base1) + '≥' + (y.base1_val || ''))
  if (y.base2) out.push('附加2 ' + attrName(y.base2) + '≥' + (y.base2_val || ''))
  if (y.effect) {
    const e = EFFECTS.find((x: any) => String(x.v) === String(y.effect))
    out.push('特效 ' + (e ? e.t : y.effect) + (y.effect_val ? '≥' + y.effect_val : ''))
  }
  if (y.mh_level) out.push('等级≥' + y.mh_level)
  if (y.mh_ext) out.push('含额外灵尘')
  if (y.teji) out.push('奇袭 ' + findName(TEJI, y.teji))
  if (y.daoju) out.push('道具 ' + findName(DAOJU, y.daoju))
  if (y.min_price || y.max_price) {
    const fmt = (v: any) => (v ? Number(v).toLocaleString() + '元' : '不限')
    out.push('价格 ' + fmt(y.min_price) + ' - ' + fmt(y.max_price))
  }
  if (y.fair_show) out.push('含公示期')
  return out
}

async function delOne(eid: string) {
  await cbgApi.delItem(eid)
  await loadItems()
  await loadLabels()
}

async function delLabelFn(label: string) {
  if (!confirm(`确定删除标签「${label}」下的全部 ${countOfLabel(label)} 件物品？`)) return
  await cbgApi.delLabel(label)
  if (activeLabel.value === label) activeLabel.value = 'all'
  await loadItems()
  await loadLabels()
}

function countOfLabel(label: string): number {
  const l = labels.value.find((x) => x.capture_label === label)
  return l ? l.cnt : 0
}

function resetFilters() {
  activeLabel.value = 'all'
  server.value = ''
  kw.value = ''
  minPrice.value = ''
  maxPrice.value = ''
  sort.value = 'time_desc'
  ageFilter.value = ''
  loadItems()
}

async function seedDemo() {
  const demo = [
    { eid: 'demo-AAA', server_id: '976', server_name: '无与伦比', name: '流云剑', price: 520, first_price: 560, attrs: { 等级: '150', 伤害: '620', 特技: '破血狂攻' }, detail_url: 'https://xyq.cbg.163.com/equip?s=976&eid=demo-AAA' },
    { eid: 'demo-BBB', server_id: '976', server_name: '无与伦比', name: '斩妖剑', price: 880, first_price: 880, attrs: { 等级: '150', 伤害: '700' }, detail_url: 'https://xyq.cbg.163.com/equip?s=976&eid=demo-BBB' },
    { eid: 'demo-CCC', server_id: '980', server_name: '钓鱼岛', name: '屠龙刀', price: 1500, first_price: 1620, attrs: { 等级: '160', 伤害: '820', 特效: '永不磨损' }, detail_url: 'https://xyq.cbg.163.com/equip?s=980&eid=demo-CCC' },
  ]
  await cbgApi.capture('示例·高伤武器', demo)
  await loadLabels()
  await loadItems()
  msg.value = '已填充 3 条示例（其中 2 条为降价）。点删除可清掉。'
}

// 状态为前端筛选（在售/已售/已下架），其余条件走后端
const ageFilter = ref('')  // 服龄筛选：'' / old / mid / new
const filteredItems = computed<CapturedItem[]>(() => {
  let list = items.value
  // 玉魄页面只显示玉魄/装备类，过滤掉角色数据
  list = list.filter((it) => !isRole(it))
  const f = statusFilter.value
  if (f) list = list.filter((it) => (it.status || '在售') === f)
  const af = ageFilter.value
  if (af) {
    list = list.filter((it) => {
      const a = serverAges.value[String(it.server_id)]
      return a && a.age === af
    })
  }
  return list
})

onMounted(async () => {
  await loadServerMap()
  await loadServerAges()
  // 恢复上次停留的标签页
  const savedTab = localStorage.getItem(TAB_STORAGE_KEY)
  if (savedTab === 'yupo' || savedTab === 'role') {
    activeSearchTab.value = savedTab
  }
  loadYupoConditions()  // 加载上次保存的搜索条件
  await loadLabels()
  await loadItems()
  await loadSubs()
  setInterval(() => { nowSec.value = Math.floor(Date.now() / 1000) }, 30000)
})
</script>

<template>
  <div class="lib-page">
    <!-- 左侧：藏宝阁搜索分类导航（对齐真实 .subNav） -->
    <aside class="cat-nav">
      <div class="subNav">
        <a href="#" :class="{ on: activeSearchTab === 'role' }" @click.prevent="activeSearchTab = 'role'">角色搜索</a>
        <a href="https://xyq.cbg.163.com/cgi-bin/equipquery.py?act=show_overall_search_equip" target="_blank" rel="noopener">装备搜索</a>
        <a href="https://xyq.cbg.163.com/cgi-bin/equipquery.py?act=show_overall_search_pet" target="_blank" rel="noopener">召唤兽搜索</a>
        <a href="https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_overall_search_yuanshen" target="_blank" rel="noopener">元身搜索</a>
        <a href="https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_pet_equip_search_form" target="_blank" rel="noopener">召唤兽装备搜索</a>
        <a href="https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_overall_search_lingshi" target="_blank" rel="noopener">灵饰搜索</a>
        <a href="#" :class="{ on: activeSearchTab === 'yupo' }" @click.prevent="activeSearchTab = 'yupo'">上古玉魄搜索</a>
      </div>
    </aside>
    <div class="lib-main">
    <div class="card">
      <h2>📦 藏宝阁藏品库</h2>
      <p class="muted">
        数据由浏览器插件在藏宝阁<strong>搜索/列表结果页</strong>点「采集本页全部物品」写入本机后端。
        这里就是你自己的私人藏品库，下次直接筛选查询，不用再翻藏宝阁。
        <strong>筛选后点击任意一行，即可直接跳到藏宝阁该物品详情页。</strong>
      </p>
      <button class="btn" style="margin-top:8px" @click="seedDemo">填充示例数据（先看效果）</button>
    </div>

    <template v-if="activeSearchTab === 'yupo'">
    <div class="card card-gold">
      <div class="yupo-head" @click="yupoOpen = !yupoOpen">
        <h2>🔍 按条件去藏宝阁搜「上古玉魄」</h2>
        <div class="yupo-head-right">
          <span class="yupo-toggle">{{ yupoOpen ? '收起 ▲' : '展开 ▼' }}</span>
          <button class="btn btn-gold btn-sm" @click.stop="goCbgSearch">去搜索 ↗</button>
        </div>
      </div>
      <div class="yupo-body" :class="{ open: yupoOpen }">
        <p class="muted yupo-intro">
          选好<strong>服务器与条件</strong>，点「去搜索」直接跳到<strong>带筛选的藏宝阁实时结果页</strong>。
          排版与藏宝阁玉魄搜索页一致：分组块 + 左列字段名、右列条件。玉魄属性参数（equip_type / init_attrs / base_attrs1 / minghun_effect …）已按真实 URL 校准。
        </p>

        <!-- 块1：选择服务器（同藏宝阁 divGride.searchForm 分组块） -->
        <div class="divGride searchForm">
          <div class="title"><h3>选择服务器</h3></div>
          <div class="grideCont">
            <table class="searcTb">
              <col width="120" /><col />
              <tr>
                <th>服务器类型</th>
                <td>
                  <button type="button" class="seg" :class="{ on: yupo.scope === 'single' }" @click="yupo.scope = 'single'">单服（按所选服）</button>
                  <button type="button" class="seg" :class="{ on: yupo.scope === 'cross' }" @click="yupo.scope = 'cross'">全服搜索</button>
                </td>
              </tr>
              <tr>
                <th>选择服务器</th>
                <td>
                  <button type="button" class="srv-trigger" @click="openServerDialog">
                    {{ selServerName || '点击选择' }}
                  </button>
          <span class="srv-hint">点此弹出区服选择（同藏宝阁跨服购买弹窗）</span>
        </td>
      </tr>
      <tr>
        <th>最近搜索</th>
        <td>
          <span v-if="selServerName" class="recent-chip">{{ selAreaName }}·{{ selServerName }}</span>
          <span v-else class="muted">暂无</span>
        </td>
      </tr>
    </table>
          </div>
        </div>

        <!-- 块2：玉魄种类 -->
        <div class="divGride searchForm">
          <div class="title"><h3>玉魄种类</h3></div>
          <div class="grideCont">
            <table class="searcTb">
              <col width="120" /><col />
              <tr>
                <th>类型</th>
                <td class="radio-td">
                  <label class="rdo"><input type="radio" value="" v-model="yupo.yupo_equip_type" /> 不限</label>
                  <label class="rdo" v-for="o in YUPO_TYPE" :key="o.v"><input type="radio" :value="o.v" v-model="yupo.yupo_equip_type" /> {{ o.t }}</label>
                </td>
              </tr>
            </table>
          </div>
        </div>

        <!-- 块3：玉魄属性（基础/附加1/2/综合/特效/灵尘/奇袭特技/奇袭道具/价格/出售状态） -->
        <div class="divGride searchForm">
          <div class="title"><h3>玉魄属性</h3></div>
          <div class="grideCont">
            <table class="searcTb">
              <col width="120" /><col />
              <tr>
                <th>基础属性</th>
                <td>
                  <select v-model="yupo.init_attr"><option value="">--不限--</option><option v-for="o in ATTRS" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                  &ge; <input class="mini" v-model="yupo.init_val" size="6" placeholder="阈值" />
                </td>
              </tr>
              <tr>
                <th>附加属性</th>
                <td>
                  <div class="sub-row"><span class="btnListTitle">1</span>
                    <select v-model="yupo.base1"><option value="">--不限--</option><option v-for="o in ATTRS" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                    &ge; <input class="mini" v-model="yupo.base1_val" size="6" placeholder="阈值" />
                  </div>
                  <div class="sub-row"><span class="btnListTitle">2</span>
                    <select v-model="yupo.base2"><option value="">--不限--</option><option v-for="o in ATTRS" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                    &ge; <input class="mini" v-model="yupo.base2_val" size="6" placeholder="阈值" />
                  </div>
                </td>
              </tr>
              <tr>
                <th>综合属性</th>
                <td>
                  <select v-model="yupo.total_attr"><option value="">--不限--</option><option v-for="o in ATTRS" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                  &ge; <input class="mini" v-model="yupo.total_val" size="6" placeholder="阈值" />
                </td>
              </tr>
              <tr>
                <th>相同属性</th>
                <td>
                  <ul class="btnList yp-range">
                    <li :class="{ on: sameProps.includes('1') }" @click="toggleSameProp('1')"><span>灵尘+1</span></li>
                    <li :class="{ on: sameProps.includes('2') }" @click="toggleSameProp('2')"><span>灵尘+2</span></li>
                  </ul>
                  <span class="muted" style="margin-left:8px;font-size:12px">可多选</span>
                </td>
              </tr>
              <tr>
                <th>特效</th>
                <td>
                  <select v-model="yupo.effect"><option value="">--不限--</option><option v-for="o in EFFECTS" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                  &ge; <input class="mini" v-model="yupo.effect_val" size="6" placeholder="阈值" />
                </td>
              </tr>
              <tr>
                <th>灵尘等级</th>
                <td>
                  &ge; <input class="mini" v-model="yupo.mh_level" size="6" placeholder="等级" />
                  <label class="chk"><input type="checkbox" v-model="yupo.mh_ext" /> 含额外灵尘</label>
                </td>
              </tr>
              <tr>
                <th>奇袭特技</th>
                <td>
                  <select v-model="yupo.teji"><option value="">--请选择--</option><option v-for="o in TEJI" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                </td>
              </tr>
              <tr>
                <th>奇袭道具</th>
                <td>
                  <select v-model="yupo.daoju"><option value="">--请选择--</option><option v-for="o in DAOJU" :key="o.v" :value="o.v">{{ o.t }}</option></select>
                </td>
              </tr>
              <tr>
                <th>价格</th>
                <td>
                  <input class="mini" v-model="yupo.min_price" size="6" placeholder="最低" /> -
                  <input class="mini" v-model="yupo.max_price" size="6" placeholder="最高" /> 元
                </td>
              </tr>
              <tr>
                <th>出售状态</th>
                <td>
                  <label class="chk"><input type="checkbox" v-model="yupo.fair_show" /> 显示公示期</label>
                </td>
              </tr>
          </table>
        </div>
      </div>

      <!-- 块4：服务器范围（对齐藏宝阁跨服搜索真实页面：开服时间 + 指定区服） -->
      <div class="divGride searchForm">
        <div class="title"><h3>服务器范围</h3></div>
        <div class="grideCont">
          <table class="searcTb">
            <col width="120" /><col />
            <tr>
              <th>开服时间</th>
              <td>
                <ul class="btnList yp-range">
                  <li :class="{ on: serverTypes.includes('3') }" @click="toggleServerType('3')"><span>3年以上服</span></li>
                  <li :class="{ on: serverTypes.includes('2') }" @click="toggleServerType('2')"><span>1到3年服</span></li>
                  <li :class="{ on: serverTypes.includes('1') }" @click="toggleServerType('1')"><span>1年内服</span></li>
                </ul>
                <span class="muted" style="margin-left:8px;font-size:12px">可多选</span>
              </td>
            </tr>
            <tr>
              <th>指定区服</th>
              <td>
                <select v-model="selScopeArea">
                  <option value="">--请选择区--</option>
                  <option v-for="a in serverMap.areas" :key="a.area_id" :value="a.area_id">{{ a.area_name }}</option>
                </select>
                区
                <select v-model="selScopeServer">
                  <option value="">--请选择服务器--</option>
                  <option v-for="s in scopeServers" :key="s.server_id" :value="s.server_id">{{ s.server_name }}</option>
                </select>
                服务器
                <button type="button" class="srv-trigger" style="margin-left:8px" @click="pickLoginServer">选择已登录服务器</button>
              </td>
            </tr>
          </table>
        </div>
      </div>

      <div class="yupo-foot">
          <button class="btn btn-gold" @click="goCbgSearch">去搜索 ↗</button>
          <button class="btn" @click="clearYupoConditions">清空条件</button>
          <span class="muted yupo-note">
            注：默认走<strong>全服搜索页</strong>（show_overall_search_yupo）。搜索条件自动保存到浏览器，下次打开还在。
          </span>
        </div>
      </div>
    </div>

    <!-- 自动采集订阅卡片 -->
    <div class="card card-sub">
      <h2>⏰ 自动采集订阅（定时去藏宝阁采）</h2>
      <p class="muted">
        把上方「去搜玉魄」的<strong>当前服务器 + 筛选条件</strong>存成一条订阅。浏览器开着且已登录藏宝阁时，
        扩展会按频率自动打开藏宝阁搜索页、采集并写回本页藏品库。
      </p>

      <div class="sub-form">
        <input v-model="subForm.name" class="sub-input" placeholder="订阅名称（如：梦幻西游·高灵尘阴魄）" />
        <input v-model="subForm.label" class="sub-input" placeholder="藏品标签（同条件归一类，留空用订阅名）" />
        <select v-model="subForm.interval_minutes" class="sub-select" title="采集频率">
          <option :value="15">每 15 分钟</option>
          <option :value="30">每 30 分钟</option>
          <option :value="60">每 1 小时</option>
          <option :value="120">每 2 小时</option>
          <option :value="360">每 6 小时</option>
        </select>
        <button class="btn btn-gold" @click="saveAsSubscription">保存为订阅</button>
      </div>

      <div v-if="subs.length" class="sub-list">
        <div v-for="s in subs" :key="s.id" class="sub-item" :class="{ off: !s.enabled }">
          <div class="sub-main">
            <div class="sub-title">
              <span class="sub-name">{{ s.name }}</span>
              <span class="sub-pill" :class="s.enabled ? 'on' : 'off'">{{ s.enabled ? '启用中' : '已暂停' }}</span>
            </div>
            <div class="sub-meta">
              <span>🖥 {{ s.server_name || s.server_id || '-' }}</span>
              <span>🏷 {{ s.label || '-' }}</span>
              <span>⏱ 每 {{ s.interval_minutes || 60 }} 分钟</span>
            </div>
            <div class="sub-meta">
              <span>下次：{{ fmtTime(s.next_run) }} <em :class="subNextClass(s)">{{ subNextText(s) }}</em></span>
              <span>上次：{{ s.last_run ? fmtTime(s.last_run) : '从未' }}</span>
            </div>
            <div v-if="subConditions(s).length" class="sub-conds">
              <span v-for="(c, i) in subConditions(s)" :key="i" class="cond-tag">{{ c }}</span>
            </div>
            <div v-if="subResultText(s)" class="sub-meta">
              <span :style="subResultText(s).indexOf('失败') >= 0 ? 'color:#e05555' : 'color:#4caf50'">{{ subResultText(s) }}</span>
            </div>
          </div>
          <div class="sub-ops">
            <label class="switch" title="启用 / 暂停">
              <input type="checkbox" :checked="s.enabled" @change="toggleSub(s)" />
              <span class="slider"></span>
            </label>
            <button class="btn-mini" @click="runSubNow(s.id)">立即采集</button>
            <button class="btn-mini btn-del" @click="delSub(s.id)">删除</button>
          </div>
        </div>
      </div>
      <p v-else class="muted">暂无订阅。选好服务器与玉魄条件后点「保存为订阅」即可。</p>
    </div>
      <!-- 藏品库列表区（标签筛选 + 已采集物品表）：玉魄专属，随玉魄标签整体收起 -->
      <div class="card">
      <div class="label-row">
        <button class="chip" :class="{ active: activeLabel === 'all' }" @click="activeLabel = 'all'; loadItems()">
          全部 ({{ labels.reduce((s, l) => s + l.cnt, 0) }})
        </button>
        <button
          v-for="l in labels"
          :key="l.capture_label"
          class="chip"
          :class="{ active: activeLabel === l.capture_label }"
          @click="activeLabel = l.capture_label; loadItems()"
        >
          {{ l.capture_label }} ({{ l.cnt }})
          <span class="chip-x" @click.stop="delLabelFn(l.capture_label)" title="删除该标签全部">✕</span>
        </button>
        <span v-if="!labels.length" class="muted">暂无采集标签，去藏宝阁列表页用插件采集吧</span>
      </div>

      <div class="filter-grid">
        <input v-model="server" placeholder="服务器（模糊）" @keyup.enter="loadItems()" />
        <input v-model="kw" placeholder="名称/属性关键字" @keyup.enter="loadItems()" />
        <input v-model="minPrice" placeholder="最低价" type="number" @keyup.enter="loadItems()" />
        <input v-model="maxPrice" placeholder="最高价" type="number" @keyup.enter="loadItems()" />
        <select v-model="sort" @change="loadItems()">
          <option value="time_desc">最近采集</option>
          <option value="price_asc">价格升序</option>
          <option value="price_desc">价格降序</option>
        </select>
        <select v-model="statusFilter" title="按在售状态筛选（前端过滤）">
          <option value="">全部状态</option>
          <option value="在售">在售</option>
          <option value="已售">已售</option>
          <option value="已下架">已下架</option>
        </select>
        <select v-model="ageFilter" title="按服务器开服时间筛选（3年以上/1-3年/1年内）">
          <option value="">全部服龄</option>
          <option value="old">3年以上服</option>
          <option value="mid">1-3年服</option>
          <option value="new">1年内服</option>
        </select>
        <button class="btn btn-primary" @click="loadItems()">查询</button>
        <button class="btn" @click="resetFilters()">重置</button>
        <button class="btn btn-gold" @click="guideRefresh()" title="需在已登录的藏宝阁页面：点浏览器插件弹窗的「刷新藏品库状态」">刷新在售状态</button>
      </div>
      <p class="count">共 {{ filteredItems.length }} 件</p>
    </div>

    <div class="card">
      <div class="tbl-wrap">
      <table v-if="filteredItems.length">
        <thead>
          <tr>
            <th>缩略图</th>
            <th v-if="!hasYupo">属性摘要</th>
            <template v-else>
              <th>基础属性</th>
              <th>附加属性</th>
              <th>灵尘等级</th>
              <th>特效</th>
            </template>
            <th>现价</th>
            <th>首采价</th>
            <th>服务器</th>
            <th>状态</th>
            <th>采集时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in filteredItems"
            :key="it.eid"
            :class="{ dropped: it.dropped, clickable: !!it.detail_url }"
            :title="it.detail_url ? '点击直达藏宝阁详情' : ''"
            @click="openCbg(it)"
          >
            <td>
              <div class="thumb-cell">
                <img v-if="thumbSrc(it)" :src="thumbSrc(it)" class="thumb" alt="" @error="onImgError($event, it)" />
                <span v-if="it.dropped" class="badge-drop">↓降价</span>
              </div>
            </td>
            <td v-if="!hasYupo" class="attrs">
              <span v-for="(v, k) in parseAttrs(it)" :key="k" class="attr-chip">{{ k }}:{{ v }}</span>
              <span v-if="!Object.keys(parseAttrs(it)).length" class="muted">-</span>
            </td>
            <template v-else>
              <td class="attr-col">{{ attrVal(it, '基础属性') }}</td>
              <td class="attr-col">
                <div v-for="(line, idx) in attrLines(it, '附加属性')" :key="idx" class="attr-line">{{ line }}</div>
              </td>
              <td class="attr-col num">
                {{ attrVal(it, '灵尘等级') }}
                <div v-if="attrVal(it, '奇袭') !== '-'" class="attr-sub">{{ attrVal(it, '奇袭') }}</div>
              </td>
              <td class="attr-col">{{ attrVal(it, '特效') }}</td>
            </template>
            <td class="price">{{ fmtPrice(it.price) }}</td>
            <td :class="{ cheap: it.dropped }">{{ fmtPrice(it.first_price) }}</td>
            <td>
              <div class="server-cell">
                <span>{{ serverLabelById(it.server_id) || it.server_name || '-' }}</span>
                <span v-if="serverAgeLabel(it.server_id)" class="age-badge" :class="serverAgeClass(it.server_id)">{{ serverAgeLabel(it.server_id) }}</span>
              </div>
            </td>
            <td><span class="st" :class="statusClass(it.status)">{{ it.status || '在售' }}</span></td>
            <td class="time">{{ fmtTime(it.captured_at) }}</td>
            <td class="ops" @click.stop>
              <a v-if="it.detail_url" :href="it.detail_url" target="_blank" rel="noopener" class="op-link" @click.stop>藏宝阁↗</a>
              <button class="btn-mini" @click.stop="delOne(it.eid)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无物品。到藏宝阁搜索/列表页，用插件「采集本页」即可入库。</p>
      </div>
    </div>
    </template>

    <RoleSearchView v-else />

    <p v-if="msg" class="msg">{{ msg }}</p>

    <!-- 选服弹窗（仿藏宝阁跨服购买：大区网格 + 服务器网格 + 搜索） -->
    <div v-if="serverDialogOpen" class="dialog-mask" @click.self="serverDialogOpen = false">
      <div class="dialogCont">
        <div class="dialog-title">
          <span>选择服务器</span>
          <button class="dialog-close" type="button" @click="serverDialogOpen = false">✕</button>
        </div>
        <div class="blockCont">
          <div>
            <div class="searchServerWrap">
              <input v-model="dialogKeyword" class="txt1" placeholder="服务器搜索" @input="dialogArea = ''" />
            </div>
          </div>
          <div class="area-list-panel">
            <a
              v-for="a in serverMap.areas"
              :key="a.area_id"
              href="#"
              class="area-item"
              :class="{ on: !dialogKeyword.trim() && dialogArea === a.area_id }"
              @click.prevent="dialogArea = a.area_id; dialogKeyword = ''"
            >{{ a.area_name }}</a>
          </div>
          <div class="server-list-panel">
            <a
              v-for="s in dialogServers"
              :key="s.server_id"
              href="#"
              class="server-item"
              :class="{ on: selServerId === s.server_id }"
              @click.prevent="pickServer(s)"
            >{{ s.server_name }}</a>
            <span v-if="!dialogServers.length" class="muted">无匹配服务器</span>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.lib-page {
  flex: 1;
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding: 8px;
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-mono);
}
.lib-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* ===== 左侧分类导航（像素赛博风） ===== */
.cat-nav {
  flex: 0 0 170px;
  align-self: flex-start;
  position: sticky;
  top: 8px;
}
.subNav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}
.subNav a {
  font-family: 'Press Start 2P', 'VT323', 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 0.5px;
  padding: 10px 10px 10px 12px;
  border: 2px solid transparent;
  border-radius: 3px;
  color: #4a5568;
  cursor: pointer;
  transition: 0.08s linear;
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  position: relative;
  text-decoration: none;
  text-transform: uppercase;
}
.subNav a:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.03);
  color: #7a8a9a;
}
/* ★ 选中状态：亮黄色底色 + 黑色像素文字 */
.subNav a.on {
  background: #ffd700;
  color: #0a0c12;
  border-color: #e6c200;
  box-shadow: 0 0 50px rgba(255, 215, 0, 0.12), inset 0 0 30px rgba(255, 215, 0, 0.04);
}
/* 马赛克斜框 — 选中项的外发光锯齿 */
.subNav a.on::before {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 5px;
  padding: 3px;
  background: repeating-linear-gradient(
    45deg,
    #ffd700 0px,
    #ffd700 3px,
    transparent 3px,
    transparent 6px
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  opacity: 0.6;
}
/* 选中项右侧像素三角 */
.subNav a.on::after {
  content: "►";
  position: absolute;
  right: 8px;
  font-size: 12px;
  color: #0a0c12;
  font-family: 'Press Start 2P', monospace;
  opacity: 0.7;
}
.card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 12px;
  overflow: hidden;
}
.card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    rgba(0, 229, 255, 0.03) 0,
    rgba(0, 229, 255, 0.03) 2px,
    transparent 2px,
    transparent 6px
  );
  pointer-events: none;
  z-index: 0;
}
.card > * { position: relative; z-index: 1; }
.card h2 {
  margin: 0 0 4px;
  color: var(--color-primary);
  font-family: var(--font-pixel), var(--font-cn);
  letter-spacing: 0.5px;
}
.muted { color: var(--color-text-muted); font-size: 12px; line-height: 1.5; }
.label-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; align-items: center; }
.chip {
  padding: 5px 12px; border: 1px solid var(--border-color);
  border-radius: 16px; background: var(--bg-card); cursor: pointer; font-size: 13px;
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  transition: 0.08s linear;
}
.chip:hover { color: var(--color-text); border-color: var(--border-strong); }
.chip.active { background: var(--color-accent); color: #1a1402; border-color: var(--color-accent); box-shadow: 0 0 18px rgba(255, 215, 0, 0.25); }
.chip-x { font-size: 11px; opacity: 0.7; }
.chip-x:hover { opacity: 1; }
.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.filter-grid input, .filter-grid select {
  padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;
  background: var(--bg-input); color: var(--color-text);
}
.filter-grid input:focus, .filter-grid select:focus {
  outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.12);
}
.btn { padding: 8px 14px; border: 2px solid var(--border-strong); border-radius: 3px; background: var(--bg-card); cursor: pointer; color: var(--color-text); font-family: var(--font-mono); letter-spacing: 0.5px; transition: 0.08s linear; }
.btn-primary { background: var(--color-primary); color: #06121a; border-color: var(--color-primary); box-shadow: 0 0 20px rgba(34, 211, 238, 0.15); }
.btn-primary:hover { background: #5fe3f5; box-shadow: 0 0 32px rgba(34, 211, 238, 0.4); }
.btn-gold { background: var(--color-accent); color: #1a1402; border-color: var(--color-accent); }
.btn-gold:hover { background: #fde047; box-shadow: 0 0 28px rgba(255, 215, 0, 0.35); }
.st { display: inline-block; padding: 2px 9px; border-radius: 11px; font-size: 12px; line-height: 1.6; white-space: nowrap; font-family: var(--font-mono); }
.st-on { background: rgba(52, 211, 153, 0.12); color: var(--color-success); border: 1px solid rgba(52, 211, 153, 0.3); }
.st-sold { background: rgba(244, 63, 94, 0.12); color: var(--color-danger); border: 1px solid rgba(244, 63, 94, 0.3); }
.st-off { background: rgba(255, 255, 255, 0.04); color: var(--color-text-muted); border: 1px solid var(--border-color); }
.card-gold { border-color: rgba(255, 215, 0, 0.25); background: linear-gradient(180deg, rgba(255, 215, 0, 0.04), rgba(255, 215, 0, 0.01)); }
.card-gold h2 { color: var(--color-accent); margin: 0; }
.yupo-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; cursor: pointer; user-select: none;
}
.yupo-head-right { display: flex; align-items: center; gap: 12px; }
.yupo-toggle { font-size: 12px; color: #a9821a; white-space: nowrap; }
.btn-sm { padding: 5px 12px; font-size: 13px; }
.yupo-body {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.32s ease, opacity 0.25s ease, margin-top 0.3s ease;
}
.yupo-body.open { max-height: 2600px; opacity: 1; margin-top: 12px; }
.yupo-intro { margin: 0 0 12px; }
.yupo-note { margin-left: 10px; }
.yupo-foot { margin-top: 12px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
/* ---- 搜索分组块：对齐藏宝阁 divGride.searchForm 真实排版（赛博暗化） ---- */
.divGride { padding: 1px; border: 1px solid var(--border-color); background-color: rgba(255,255,255,0.015); margin-bottom: 9px; border-radius: 3px; }
.divGride .title { padding: 6px 12px; background-color: rgba(34,211,238,0.08); text-align: center; border-bottom: 1px solid var(--border-color); }
.divGride .title h3 { margin: 0; font-size: 11px; font-weight: 700; color: var(--color-primary); font-family: var(--font-pixel), var(--font-cn); letter-spacing: 0.5px; text-transform: uppercase; }
.grideCont { padding: 8px 12px; }
.searcTb { width: 100%; border-collapse: collapse; }
.searcTb th { white-space: nowrap; font-weight: 700; text-align: right; line-height: 26px; vertical-align: top; padding: 0 12px 0 0; width: 120px; color: var(--color-text-muted); font-size: 13px; }
.searcTb td { font-size: 14px; padding: 8px 0; border-bottom: 1px dotted var(--border-color); text-align: left; vertical-align: top; color: var(--color-text); }
.searcTb tr:last-child td { border-bottom: none; }
.searcTb select { height: 26px; line-height: 26px; vertical-align: middle; border: 1px solid var(--border-color); border-radius: 3px; padding: 0 4px; background: var(--bg-input); color: var(--color-text); }
.searcTb .mini { width: 48px; height: 26px; border: 1px solid var(--border-color); border-radius: 3px; padding: 0 4px; vertical-align: middle; background: var(--bg-input); color: var(--color-text); }
.searcTb .sub-row { margin: 2px 0; }
.searcTb .sub-row + .sub-row { margin-top: 6px; }
.searcTb .btnListTitle { float: left; line-height: 26px; height: 26px; margin-right: 6px; color: var(--color-text-muted); }
.radio-td { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
.rdo { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; cursor: pointer; color: var(--color-text); }
.chk { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; cursor: pointer; margin-left: 10px; color: var(--color-text); }
.scope-label { font-size: 12px; color: var(--color-text-muted); }
.seg {
  padding: 6px 14px; border: 1px solid var(--border-color);
  border-radius: 16px; background: var(--bg-card); cursor: pointer; font-size: 13px;
  color: var(--color-text-muted); transition: 0.08s linear;
}
/* 订阅卡片：常驻显示「订了什么」 */
.sub-conds { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.cond-tag {
  font-size: 11px; line-height: 1.5; padding: 2px 8px; border-radius: 10px;
  background: rgba(34, 211, 238, 0.10); color: var(--color-primary);
  border: 1px solid rgba(34, 211, 238, 0.28); white-space: nowrap;
  font-family: var(--font-mono);
}
.seg:hover { color: var(--color-text); border-color: var(--border-strong); }
.seg.on { background: rgba(34,211,238,0.12); color: var(--color-primary); border-color: var(--color-primary); font-weight: 600; }
.srv-trigger {
  padding: 7px 16px; border: 1px solid var(--border-color); border-radius: 6px;
  background: var(--bg-input); color: var(--color-text); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: 0.08s linear;
}
.srv-trigger:hover { border-color: var(--color-primary); box-shadow: 0 0 18px rgba(34,211,238,0.15); }
.srv-hint { font-size: 12px; color: var(--color-text-muted); }
/* 玉魄种类/特效/奇袭/开服时间 等 btnList 选项（对齐藏宝阁真实页面 · 赛博） */
.btnList { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.btnList li { cursor: pointer; padding: 5px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card); font-size: 13px; line-height: 1.6; color: var(--color-text-muted); transition: 0.08s linear; }
.btnList li:hover { border-color: var(--border-strong); color: var(--color-text); }
.btnList li.on { background: rgba(34,211,238,0.12); color: var(--color-primary); border-color: var(--color-primary); font-weight: 600; }
.recent-chip { display: inline-block; padding: 3px 10px; border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; background: rgba(255,215,0,0.06); color: var(--color-accent); font-size: 12px; }
/* ---- 选服弹窗（赛博） ---- */
.dialog-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.dialogCont {
  background: #0b1018; border: 1px solid var(--border-strong); border-radius: 10px; width: min(740px, 92vw);
  max-height: 82vh; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 50px rgba(0,0,0,0.7), 0 0 40px rgba(34,211,238,0.08);
}
.dialog-title {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-weight: 600; font-size: 15px;
  color: var(--color-primary); font-family: var(--font-pixel), var(--font-cn); letter-spacing: 0.4px;
}
.dialog-close { border: none; background: none; font-size: 18px; cursor: pointer; color: var(--color-text-muted); line-height: 1; }
.dialog-close:hover { color: var(--color-danger); }
.blockCont { padding: 14px 16px; overflow-y: auto; }
.searchServerWrap { margin-bottom: 12px; }
.searchServerWrap .txt1 { width: 100%; padding: 9px 12px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 14px; box-sizing: border-box; background: var(--bg-input); color: var(--color-text); }
.searchServerWrap .txt1:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(34,211,238,0.12); }
.area-list-panel {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px;
  margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px dashed var(--border-color);
}
.area-item {
  text-align: center; padding: 7px 2px; font-size: 12px; color: var(--color-text-muted);
  border-radius: 5px; text-decoration: none; cursor: pointer; transition: 0.08s linear;
}
.area-item:hover { background: var(--bg-card); color: var(--color-text); }
.area-item.on { background: var(--color-accent); color: #1a1402; box-shadow: 0 0 16px rgba(255,215,0,0.3); }
.server-list-panel { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.server-item {
  text-align: center; padding: 9px 2px; font-size: 13px; color: var(--color-text);
  border: 1px solid var(--border-color); border-radius: 6px; text-decoration: none; cursor: pointer;
  transition: 0.08s linear;
}
.server-item:hover { border-color: var(--color-accent); color: var(--color-accent); }
.server-item.on { background: var(--color-accent); color: #1a1402; border-color: var(--color-accent); box-shadow: 0 0 16px rgba(255,215,0,0.3); }
.count { font-size: 13px; color: var(--color-text-muted); margin: 10px 0 0; }
.tbl-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--font-mono); }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color); vertical-align: top; color: var(--color-text); }
th { font-family: var(--font-pixel), var(--font-cn); font-size: 10px; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid var(--border-strong); }
tr.dropped { background: rgba(244,63,94,0.05); }
.clickable { cursor: pointer; transition: background 0.08s linear; }
.clickable:hover { background: rgba(34,211,238,0.06); }
.thumb-cell { display: flex; align-items: center; gap: 6px; position: relative; }
.thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color); }
.badge-drop { background: var(--color-danger); color: #1a0608; font-size: 10px; padding: 1px 5px; border-radius: 10px; position: absolute; bottom: 2px; left: 2px; }
.price { font-weight: 700; font-size: 16px; color: var(--color-accent); }
.cheap { font-weight: 700; font-size: 16px; color: var(--color-danger); }
.attrs { max-width: 280px; }
.attr-col { max-width: 200px; font-size: 14px; line-height: 1.45; word-break: break-all; vertical-align: top; color: var(--color-text); }
.attr-col.num { text-align: center; white-space: nowrap; font-weight: 700; font-size: 18px; color: var(--color-primary); }
.attr-sub { margin-top: 3px; font-size: 11px; font-weight: 400; color: var(--color-accent); white-space: normal; line-height: 1.4; }
/* 服务器服龄徽标 */
.server-cell { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.age-badge {
  display: inline-block; font-size: 11px; line-height: 1.3; padding: 1px 6px;
  border-radius: 4px; white-space: nowrap;
}
.age-old { color: var(--color-text-muted); background: var(--bg-card); border: 1px solid var(--border-color); }
.age-mid { color: #f59e0b; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); }
.age-new { color: var(--color-accent); background: rgba(34, 211, 238, 0.12); border: 1px solid rgba(34, 211, 238, 0.4); }
.attr-line { line-height: 1.5; }
.attr-line + .attr-line { margin-top: 2px; }
.attr-chip {
  display: inline-block; background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 4px; padding: 1px 6px; margin: 1px; font-size: 11px; color: var(--color-text-muted);
}
.time { color: var(--color-text-muted); white-space: nowrap; }
.ops { white-space: nowrap; }
.op-link { color: var(--color-danger); text-decoration: none; margin-right: 8px; }
.op-link:hover { color: #fb7185; }
.btn-mini { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg-card); color: var(--color-text); }
.btn-mini:hover { border-color: var(--border-strong); }
.msg { color: var(--color-accent); font-size: 13px; }
/* ===== 自动采集订阅 ===== */
.card-sub { border-color: rgba(34,211,238,0.25); background: linear-gradient(180deg, rgba(34,211,238,0.04), rgba(34,211,238,0.01)); }
.card-sub h2 { color: var(--color-primary); margin: 0 0 4px; }
.sub-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
.sub-input { flex: 1 1 220px; min-width: 180px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 13px; }
.sub-input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(34,211,238,0.12); }
.sub-select { padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 13px; }
.sub-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.sub-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); }
.sub-item.off { opacity: 0.6; }
.sub-main { min-width: 0; }
.sub-title { display: flex; align-items: center; gap: 8px; }
.sub-name { font-weight: 700; font-size: 15px; color: var(--color-text); }
.sub-pill { font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.sub-pill.on { background: rgba(52,211,153,0.12); color: var(--color-success); border: 1px solid rgba(52,211,153,0.3); }
.sub-pill.off { background: rgba(255,255,255,0.04); color: var(--color-text-muted); border: 1px solid var(--border-color); }
.sub-meta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 4px; font-size: 12px; color: var(--color-text-muted); }
.sub-meta em { font-style: normal; margin-left: 4px; }
.sub-due { color: var(--color-accent); font-weight: 700; }
.sub-wait { color: var(--color-primary); }
.sub-pending { color: var(--color-text-muted); }
.sub-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.btn-del { color: var(--color-danger); border-color: rgba(244,63,94,0.3); }
.btn-del:hover { border-color: var(--color-danger); box-shadow: 0 0 12px rgba(244,63,94,0.2); }
/* 启用/暂停 开关 */
.switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background: var(--border-strong); border-radius: 22px; transition: 0.15s; }
.slider::before { content: ""; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.15s; }
.switch input:checked + .slider { background: var(--color-success); }
.switch input:checked + .slider::before { transform: translateX(18px); }
</style>
