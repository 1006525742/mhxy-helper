<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { getCategories, getHarvest, addSample, deleteItem, recognizeImage, type HarvestItem, type CatNode, type OcrBlock, type PriceRec } from '@/services/harvestApi'
import ScreenShare from '@/components/common/ScreenShare.vue'

const catTree = ref<CatNode[]>([])
const expanded = reactive<Record<string, boolean>>({})
const activeCat = ref('')          // '' = 全部；可为顶级名或叶子名
// 区服：浏览器记住上次选择；列表与「全服金价」模块同源（/api/gold）
// 采集区的选择项同样记住，刷新/重开浏览器都不用重选
const LS_SERVER = 'harvest.server'
const LS_DEF_SERVER = 'harvest.defaultServer'
const LS_DEF_PARENT = 'harvest.defaultParent'
const LS_DEF_CAT = 'harvest.defaultCategory'
const LS_INTERVAL = 'harvest.autoInterval'
const server = ref(localStorage.getItem(LS_SERVER) || '')
const serverList = ref<{ value: string; label: string }[]>([])
watch(server, (v) => localStorage.setItem(LS_SERVER, v))

async function loadServers() {
  try {
    const r = await fetch('/api/gold')
    const j = await r.json()
    const seen = new Map<string, string>()
    for (const s of j.servers || []) {
      const name = (s.server || '').trim()
      if (name) seen.set(name, `${s.area || ''}·${name}`)
    }
    serverList.value = Array.from(seen, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'))
  } catch (e) { /* 金价服务不可用时忽略，仍可手填 */ }
}
async function clearServerData() {
  if (!server.value.trim()) { msg.value = '请先填写/选择要清空的区服'; return }
  const n = items.value.filter((i) => i.category && true).length
  if (!confirm(`确定清空「${server.value}」的全部收货/出货价样本？该区服已聚合 ${n} 个物品，此操作不可撤销。`)) return
  await fetch(`/api/harvest/server/${encodeURIComponent(server.value.trim())}`, { method: 'DELETE' })
  msg.value = `已清空「${server.value}」的全部样本`
  await load()
}
const kw = ref('')
const sort = ref<'latest' | 'price_desc' | 'price_asc' | 'count'>('latest')
const items = ref<HarvestItem[]>([])
const msg = ref('')

function toggleTop(name: string) {
  expanded[name] = !expanded[name]
}
function parentOfLeaf(leaf: string): string {
  const t = catTree.value.find((x) => x.children.some((c) => c.name === leaf))
  return t ? t.name : ''
}

async function load() {
  items.value = await getHarvest({ category: activeCat.value, server: server.value.trim(), kw: kw.value.trim() })
}
function applySort(list: HarvestItem[]): HarvestItem[] {
  const a = [...list]
  if (sort.value === 'latest') a.sort((x, y) => y.latest - x.latest)
  else if (sort.value === 'price_desc') a.sort((x, y) => y.avg - x.avg)
  else if (sort.value === 'price_asc') a.sort((x, y) => x.avg - y.avg)
  else if (sort.value === 'count') a.sort((x, y) => y.count - x.count)
  return a
}
const view = computed(() => applySort(items.value))

// ===== 分页：每页 15 条 =====
const PAGE_SIZE = 15
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(view.value.length / PAGE_SIZE)))
const pagedView = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return view.value.slice(start, start + PAGE_SIZE)
})
function gotoPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
}
// 换筛选/排序回到第 1 页；总页数变少时兜底回最后一页（自动采集刷新不会跳页）
watch([activeCat, server, kw, sort], () => { page.value = 1 })
watch(totalPages, (tp) => { if (page.value > tp) page.value = tp })

function iconSrc(it: HarvestItem): string {
  if (!it.icon) return ''
  return '/static/icons/' + it.icon
}
/** 价格以「万」为单位存库；展示时换算成游戏币原值（游戏里数字不带「万」后缀） */
function fmtPrice(p: number): string {
  if (p == null) return '-'
  return String(Math.round(Number(p) * 10000))
}
/** 草稿表价格：库里/识别结果以「万」为单位，输入框展示游戏币原值（用户要求不带万） */
function draftPriceView(wan: string): string {
  if (wan === '' || wan == null) return ''
  const n = Number(wan)
  return isNaN(n) ? '' : String(Math.round(n * 10000))
}
/** 反向：框里填的是游戏币原值，除以 10000 存回「万」 */
function setDraftPrice(d: { price: string }, coins: string) {
  d.price = coins === '' ? '' : String(Number(coins) / 10000)
}
/** 未匹配到物价宝鉴规范名时，按关键词推断「顶级分类」，
 *  保证子分类/顶级能自动填上、不用逐条手选也能直接入库。 */
function guessTop(name: string): string {
  const n = (name || '').trim()
  if (!n) return ''
  const adv = n.startsWith('高级')
  if (/内丹/.test(n)) return adv ? '高级内丹' : '低级内丹'
  if (/兽诀|兽决|必杀|连击|吸血|夜战|隐身|敏捷|强力|防御|毒|飞行|驱鬼|鬼魂|幸运|感知|反震|反击|偷袭|再生|冥思|招架|慧根|永恒|神迹|精神集中|魔之心|法术|盾气|迟钝|否定信仰|合纵|进击|吸收/.test(n))
    return adv ? '高级兽决' : '低级兽决'
  if (/珍珠/.test(n)) return '珍珠'
  if (/灵饰|戒指|耳饰|手镯|佩饰|晶石|元灵/.test(n)) return '人物灵饰'
  if (/附魔|原初魔石/.test(n)) return '高价值'
  if (/如意丹/.test(n)) return '如意丹'
  if (/变身卡|变色卡/.test(n)) return '变身卡片'
  if (/夜光珠|定魂珠|避水珠|金刚石|龙鳞/.test(n)) return '五宝'
  if (/翡翠石|光芒石|黑宝石|红玛瑙|舍利子|太阳石|星辉石|月亮石|红宝石|黄宝石|蓝宝石|绿宝石|神秘石|钟灵石|玄灵珠|五色灵尘/.test(n)) return '宝石'
  if (/书$|百炼精铁|炼妖石|武器|装备|环$|图策/.test(n)) return '装备'
  return '道具'
}
/** 游戏币金额 → 游戏内显示颜色（对齐梦幻配色）
 *  五位数(万)蓝 / 六位数(十万)绿 / 七位数(百万)红 / 八位数(千万)紫 / 九位及以上(亿+)品红
 *  入参是「万」，先换算回游戏币再数位数。 */
function priceColor(wan: number | null | undefined): string {
  if (wan == null || isNaN(wan as number)) return 'var(--color-text-muted)'
  const coins = Math.round(Math.abs(Number(wan)) * 10000)
  const d = String(coins).length
  if (d >= 9) return 'var(--pc-9)'
  if (d === 8) return 'var(--pc-8)'
  if (d === 7) return 'var(--pc-7)'
  if (d === 6) return 'var(--pc-6)'
  return 'var(--pc-5)'
}
/** 金额量级文案，用于图例/提示 */
function priceTier(wan: number | null | undefined): string {
  if (wan == null || isNaN(wan as number)) return ''
  const d = String(Math.round(Math.abs(Number(wan)) * 10000)).length
  if (d >= 9) return '亿+'
  if (d === 8) return '千万'
  if (d === 7) return '百万'
  if (d === 6) return '十万'
  return '万'
}
function fmtTime(ts?: number): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function pickCat(c: string) {
  activeCat.value = c
  const p = parentOfLeaf(c)
  if (p) expanded[p] = true
  await load()
}
async function doQuery() { await load() }
function resetFilters() {
  activeCat.value = ''
  server.value = ''
  kw.value = ''
  sort.value = 'latest'
  load()
}

async function del(name: string) {
  await deleteItem(name)          // 点一下即删，不再弹确认
  await load()
}

// ===== 价格溯源：点「最高收货价 / 最低出货价」看来源摊位 =====
// 最近一帧识别到的摊位信息；入库时随样本一起写进库里，之后点价格才能溯源到摊位。
// 这一帧识别到的摊位（摊位名/摊主名/摊位ID），入库时随样本一起存，供价格溯源
const lastStall = reactive({ name: '', owner: '', id: '' })
const recBox = ref<{ item: string; kind: 'buy' | 'sell'; rec: PriceRec } | null>(null)
function openRec(item: string, kind: 'buy' | 'sell', rec: PriceRec) {
  recBox.value = { item, kind, rec }
}
function closeRec() {
  recBox.value = null
}
// 弹窗里的物品图标：从表格数据里按物品名取
const recIcon = computed(() => {
  if (!recBox.value) return ''
  const hit = items.value.find((x) => x.item_name === recBox.value!.item)
  return hit ? iconSrc(hit) : ''
})

// ===== 自动采集状态（须在下方 immediate watch 之前声明，避免 TDZ）=====
const autoRunning = ref(false)
const autoInterval = ref(Number(localStorage.getItem(LS_INTERVAL) || 3) || 3)
watch(autoInterval, (v) => localStorage.setItem(LS_INTERVAL, String(v)))
const autoLog = ref<string[]>([])
const autoStat = reactive({ frames: 0, imported: 0, dup: 0, skipped: 0 })
const autoSeen = new Set<string>()
let autoTimer: ReturnType<typeof setInterval> | null = null
let autoBusy = false

// ===== 摊位截图采集 =====
// 屏幕共享复用抓鬼助手同款共享组件（ScreenShare / ref=screenShareRef），
// 由左侧竖条开启共享；预览画面走组件自带的左下角浮窗（点竖条「🖼」展开），与抓鬼助手一致。
// 不需要框选：后端识别时能自动定位摊位区域，因此直接截整个窗口。
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)
const sharing = ref(false)
const capturedImg = ref('')
const ocrMsg = ref('')
// 调试期：把后端这一帧的中间结果（尺寸/OCR块数/定位区域/摊位类型）显示在页面上，
// 省得每次翻日志。原图与裁切图已落盘 backend/debug_shots/
const dbgInfo = ref('')
const ocrBlocks = ref<OcrBlock[]>([])
// defServerManual：用户是否手动填过「默认服务器」。没手填过就跟随上方区服筛选，
// 手填过则不再自动覆盖（否则换区服筛选后，样本会被写到旧的区服下）。清空则回到跟随态。
const LS_DEF_MANUAL = 'harvest.defServerManual'
const defServerManual = ref(localStorage.getItem(LS_DEF_MANUAL) === '1')
watch(defServerManual, (v) => localStorage.setItem(LS_DEF_MANUAL, v ? '1' : '0'))
const defaultServer = ref(localStorage.getItem(LS_DEF_SERVER) || '')
watch(defaultServer, (v) => {
  localStorage.setItem(LS_DEF_SERVER, v)
  if (!v.trim()) defServerManual.value = false
})
watch(server, (v) => { if (v && !defServerManual.value) defaultServer.value = v })
// 默认分类：给类目表里没有的物品（如兽决）兜底，识别时自动填、自动采集也用它
// 同样记住：分类树是异步拉的，加载完再回填一次，确保 select 选中上次的值
const defaultParent = ref(localStorage.getItem(LS_DEF_PARENT) || '')
const defaultCategory = ref(localStorage.getItem(LS_DEF_CAT) || '')
watch(defaultParent, (v) => localStorage.setItem(LS_DEF_PARENT, v))
watch(defaultCategory, (v) => localStorage.setItem(LS_DEF_CAT, v))
const defaultLeaves = computed(() => {
  const t = catTree.value.find((x) => x.name === defaultParent.value)
  return t ? t.children : []
})
function onDefaultParent() {
  defaultCategory.value = ''
}
/** 分类树到位后，把记住的默认分类落回下拉（值不存在则清空，避免选空还以为选了） */
function restoreDefaultCat() {
  const p = localStorage.getItem(LS_DEF_PARENT) || ''
  const c = localStorage.getItem(LS_DEF_CAT) || ''
  const top = p ? catTree.value.find((x) => x.name === p) : undefined
  if (p && top) {
    defaultParent.value = p
    defaultCategory.value = c && top.children.some((x) => x.name === c) ? c : ''
  }
}
function applyDefaultCategory() {
  if (!defaultCategory.value) { ocrMsg.value = '请先选择「默认分类」'; return }
  let n = 0
  for (const d of drafts.value) {
    if (!d.category) { d.parent = defaultParent.value; d.category = defaultCategory.value; n++ }
  }
  ocrMsg.value = n ? `已把默认分类应用到 ${n} 条未匹配行` : '没有未匹配的行'
}
// 同步共享状态：关闭时停自动采集（预览画面由共享组件自己的浮窗负责，无需外部轮询）
watch(() => screenShareRef.value?.isSharing, (v) => {
  sharing.value = !!v
  if (!v) stopAuto()
  else ocrMsg.value = '共享已开启｜若画面里出现本网页，说明选成了「整个屏幕」——请停止后重开，'
    + '在弹窗里选「游戏窗口」（选窗口后即使被本页盖住也能识别到窗口内容）'
}, { immediate: true })

interface DraftRow {
  idx: number
  text: string
  score: number
  checked: boolean
  name: string
  price: string
  parent: string
  category: string
  matched: boolean
  match_method: string
  split: boolean
  icon: string
  price_type: 'buy' | 'sell'   // buy=收货价（收购摊位）/ sell=出货价（出售摊位）
}
const drafts = ref<DraftRow[]>([])

// OCR 文字块 → 候选：含数字的块拆出 价格，剩余当 物品名
function parseBlock(text: string): { name: string; price: string } {
  const m = text.match(/(\d+(?:\.\d+)?)\s*[万wW]?/)
  if (m) return { name: text.replace(m[0], '').trim(), price: m[1] }
  return { name: text.trim(), price: '' }
}
function leavesOf(parent: string) {
  const t = catTree.value.find((x) => x.name === parent)
  return t ? t.children : []
}
function onDraftParent(d: DraftRow) {
  d.category = ''
}

/** 截整个共享窗口（后端会自动定位摊位区域，无需框选）→ 直接识别 */
async function captureWindowShot() {
  if (!sharing.value) { ocrMsg.value = '请先点左侧竖条「开始监控」开启屏幕共享'; return }
  const dataUrl = screenShareRef.value?.captureFull()
  if (!dataUrl) { ocrMsg.value = '截取失败，请确认已共享游戏窗口'; return }
  capturedImg.value = dataUrl
  await submitRecognize()
}
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
async function submitRecognize() {
  if (!capturedImg.value) { ocrMsg.value = '请先点「📸 截图并识别」'; return }
  ocrMsg.value = 'OCR 识别中…'
  try {
    const blob = dataUrlToBlob(capturedImg.value)
    const res = await recognizeImage(blob)
    if (res.success) {
      // 调试摘要：这一帧的中间结果（后端同时已写入 logs/harvest.stdout.log）
      dbgInfo.value = [
        `${res.size?.[0] ?? '?'}×${res.size?.[1] ?? '?'}`,
        `OCR ${res.blocks?.length ?? 0} 块`,
        res.region ? `定位摊位 [${res.region.map((n: number) => Math.round(n)).join(', ')}]` : '未定位摊位',
        `类型 ${res.stall_kind || '-'}`,
        `检测 ${res.stall_detected ? '通过' : '未通过'}`,
        `遮挡 ${res.occluded ? '⚠️是' : '否'}`,
        `摊位 ${res.stall_name || '-'}`,
        `摊主 ${res.stall_owner || '-'}${res.stall_id ? '(' + res.stall_id + ')' : ''}`,
        `图存 backend/debug_shots/`,
      ].join(' ｜ ')
      // 画面被本页遮挡 → 结果不可信，不生成候选（避免乱七八糟的条目进草稿表）
      if (res.occluded) {
        drafts.value = []
        ocrMsg.value = `⚠️ 画面被本页面遮挡（识别到：${(res.occlusion_hits || []).slice(0, 4).join('、')}）。`
          + '请停止共享后重新开启，在弹窗里选「游戏窗口」而不是「整个屏幕」——选窗口后即使被本页盖住也能识别。'
        return
      }
      // 记下这一帧识别到的摊位（摊位名 / 摊主名 / 摊位ID），入库时随样本一起存，供价格溯源
      lastStall.name = (res.stall_name || '').trim()
      lastStall.owner = (res.stall_owner || '').trim()
      lastStall.id = (res.stall_id || '').trim()
      ocrBlocks.value = res.blocks || []
      const parsed = res.items || []
      // 没检测到摊位界面 → 一条都不出，避免误入库
      if (!res.stall_detected) {
        drafts.value = []
        ocrMsg.value = '未检测到收货/出售摊位页面，已跳过（不会入库）'
        return
      }
      if (parsed.length) {
        // 摊位类型：收购摊位单价=收货价，出售摊位单价=出货价
        const kind: 'buy' | 'sell' = res.stall_kind === 'sell' ? 'sell' : 'buy'
        // 后端已按行配对好 物品名+价格，并完成 OCR 名→规范物品归一
        drafts.value = parsed.map((it, i) => {
          const nm = (it.item_name || it.name || '').trim()
          const useDefault = !it.matched && !!defaultCategory.value
          // 子分类：规范名 → 默认分类兜底。
          // 两者都没有时**留空**，不再拿 OCR 原文凑数——原文可能是错字（如「雷击」被识别成「半墨」），
          // 拿错字当分类入库只会污染数据，宁可让用户确认后再勾。
          const cat = it.category || (useDefault ? defaultCategory.value : '')
          // 顶级：后端给的 → 默认分类的顶级 → 按关键词推断
          const top = it.parent || (useDefault ? defaultParent.value : '') || guessTop(nm)
          const hasPrice = it.price != null && String(it.price).trim() !== '' && Number(it.price) > 0
          // 默认只勾选「已归一到规范物品 或 有默认分类兜底」且价格有效的行；
          // 未匹配的行默认不勾（名字可能错），需人工看一眼再勾。
          const okRow = !!nm && !!cat && hasPrice
          return {
            idx: i,
            text: `${it.name}　${it.price_text}`,
            score: it.score,
            checked: okRow,
            name: nm,                     // 预填归一的规范名
            price: String(it.price ?? ''),
            parent: top,
            category: cat,
            matched: it.matched,
            match_method: it.match_method,
            split: !!it.split,
            icon: it.icon || '',          // 物价宝鉴图标，入库后聚合表可显示
            price_type: kind,             // 由摊位类型推断：收购→收货价 / 出售→出货价
          }
        })
        const ok = parsed.filter((it) => it.matched).length
        const ready = drafts.value.filter((d) => d.checked).length
        const loc = res.region ? '已自动定位摊位' : ''
        const kindLabel = res.stall_kind === 'sell' ? '出售摊位→出货价'
          : res.stall_kind === 'buy' ? '收购摊位→收货价' : '未识别摊位类型，默认按收货价'
        ocrMsg.value = `识别到 ${parsed.length} 条${loc ? '（' + loc + '）' : ''}｜${kindLabel}｜`
          + `已勾选 ${ready} 条（可直接导入）`
          + (ready < parsed.length
              ? `，${parsed.length - ready} 条未匹配到规范物品（名字可能是 OCR 错字）已不勾选，请人工确认`
              : '')
          + (ok ? `｜其中 ${ok} 条已按物价宝鉴归一` : '')
      } else {
        // 兜底：没有配成对条目时，回退到逐文字块解析
        drafts.value = (res.blocks || []).map((b, i) => {
          const p = parseBlock(b.text)
          return { idx: i, text: b.text, score: b.score, checked: true, name: p.name, price: p.price, parent: '', category: '', matched: false, match_method: 'none', split: false, icon: '', price_type: 'buy' as const }
        })
        ocrMsg.value = `未配成对条目，回退到 ${ocrBlocks.value.length} 个文字块，请手动确认物品名/价格`
      }
      // 截图里探测到的区服信息，低置信度提示，预填默认服务器
      if (res.server_hint && !defaultServer.value.trim()) {
        defaultServer.value = res.server_hint
      }
    } else {
      ocrMsg.value = '识别失败：' + JSON.stringify(res)
    }
  } catch (e) {
    ocrMsg.value = '识别失败：' + (e as Error).message
  }
}
const checkedDrafts = computed(() => drafts.value.filter((d) => d.checked))
const allChecked = computed(() => drafts.value.length > 0 && drafts.value.every((d) => d.checked))
function toggleAll() {
  const v = !allChecked.value
  drafts.value.forEach((d) => { d.checked = v })
}
async function importChecked() {
  const rows = checkedDrafts.value
  if (!rows.length) { ocrMsg.value = '请勾选要导入的行'; return }
  if (!defaultServer.value.trim()) { ocrMsg.value = '请填写默认服务器（应用到勾选行）'; return }
  if (rows.some((d) => !d.category || !d.name.trim() || d.price === '')) {
    ocrMsg.value = '有勾选行缺少 物品名 / 子分类 / 价格，请补全后再导入'
    return
  }
  let okCount = 0
  let dupCount = 0
  // 一次识别内：同一种物品 + 同一个价格 只算 1 个样本。
  // （摊位上 4 个格子卖同样的「静岳 90万」只是同一摊位的一次观测，不该记成 4 条）
  const seen = new Set<string>()
  for (const d of rows) {
    const price = Number(d.price)
    if (isNaN(price) || price < 0) continue
    const nm = d.name.trim()
    const key = `${nm}|${price}`
    if (seen.has(key)) { dupCount++; continue }
    seen.add(key)
    const r = await addSample({ item_name: nm, category: d.category, server: defaultServer.value.trim(), price, icon: d.icon || undefined, price_type: d.price_type, stall_owner: lastStall.owner || undefined, stall_id: lastStall.id || undefined, stall_name: lastStall.name || undefined })
    if (r.success) okCount++
  }
  ocrMsg.value = `已导入 ${okCount} 条样本`
    + (dupCount ? `（同物品同价合并了 ${dupCount} 条，一次识别只算 1 个样本）` : '')
  drafts.value = []
  ocrBlocks.value = []
  capturedImg.value = ''
  await load()
}

/** 自动采集抓帧：整屏截取 */
function grabWindowBlob(): Blob | null {
  if (!sharing.value) return null
  const dataUrl = screenShareRef.value?.captureFull()
  return dataUrl ? dataUrlToBlob(dataUrl) : null
}

async function autoTick() {
  // OCR 单帧约 1~3 秒，上一帧没跑完时跳过本次，避免请求堆积
  if (!autoRunning.value || autoBusy) return
  autoBusy = true
  try {
    const blob = grabWindowBlob()
    if (!blob) {
      autoLog.value.unshift('[跳过] 未取到画面帧，确认已开启屏幕共享并停在摊位界面')
      return
    }
    const res = await recognizeImage(blob)
    autoStat.frames++
    // 画面被本页遮挡（捕获源选了「整个屏幕」）→ 结果不可信，跳过不入库
    if (res.occluded) {
      autoLog.value.unshift(
        `第 ${autoStat.frames} 帧：⚠️ 画面被本页面遮挡（${(res.occlusion_hits || []).slice(0, 3).join('/')}），跳过不入库。`
        + '请停止共享后重新开启，在弹窗里选「游戏窗口」而不是「整个屏幕」'
      )
      if (autoLog.value.length > 40) autoLog.value.length = 40
      return
    }
    // 没检测到摊位 → 本帧不入库，避免把聊天/主画面里的数字当价格写进去
    if (!res.stall_detected) {
      autoLog.value.unshift(`第 ${autoStat.frames} 帧：未检测到摊位页面，跳过不入库`)
      if (autoLog.value.length > 40) autoLog.value.length = 40
      return
    }
    // 记下本帧的摊位（摊位名 / 摊主名 / 摊位ID）—— 之前只有手动识别那里记，
    // 自动采集一直用的是上一次的摊位，导致样本的摊主字段是错的
    lastStall.name = (res.stall_name || '').trim()
    lastStall.owner = (res.stall_owner || '').trim()
    lastStall.id = (res.stall_id || '').trim()
    const kind = res.stall_kind === 'sell' ? 'sell' : 'buy'
    const parsed = res.items || []
    let added = 0
    let dup = 0
    let bad = 0
    // 帧内去重：同一摊位里 4 个格子卖同样的「静岳 90万」只算 1 个样本
    const frameSeen = new Set<string>()
    for (const it of parsed) {
      if (!it.price) { bad++; continue }
      // 未匹配类目的用「默认分类」兜底；两者都没有 → 跳过
      const useCat = it.matched ? it.category : defaultCategory.value
      if (!useCat) { bad++; continue }
      const nm = it.item_name || it.name
      const key = `${nm}|${it.price}`
      if (frameSeen.has(key)) { dup++; continue }      // 同一帧的重复格 → 合并
      frameSeen.add(key)
      // 跨帧去重按「摊位 + 物品 + 价格」：同一摊位反复扫不重复计数，
      // 换到另一个摊位（即使同物品同价）才算新样本。
      const crossKey = `${nm}|${it.price}|${lastStall.id || lastStall.owner || ''}`
      if (autoSeen.has(crossKey)) { dup++; continue }
      autoSeen.add(crossKey)
      const r = await addSample({
        item_name: nm,
        category: useCat,
        server: defaultServer.value.trim(),
        price: it.price,
        price_type: kind,
        icon: it.icon || undefined,
        stall_owner: lastStall.owner || undefined,
        stall_id: lastStall.id || undefined,
        stall_name: lastStall.name || undefined,
      })
      if (r && r.success) added++
      else bad++
    }
    autoStat.imported += added
    autoStat.dup += dup
    autoStat.skipped += bad
    autoLog.value.unshift(
      `第 ${autoStat.frames} 帧：识别 ${parsed.length} 条 → 入库 ${added} / 重复跳过 ${dup} / 未匹配 ${bad}`
    )
    if (autoLog.value.length > 40) autoLog.value.length = 40
    if (added) await load()
  } catch (e) {
    autoLog.value.unshift('[错误] ' + (e as Error).message)
  } finally {
    autoBusy = false
  }
}

function startAuto() {
  if (!sharing.value) { ocrMsg.value = '请先点左侧竖条「开始监控」开启屏幕共享，并把游戏切到摊位界面'; return }
  if (!defaultServer.value.trim()) { ocrMsg.value = '请先填写「默认服务器」，自动入库需要它'; return }
  autoRunning.value = true
  autoLog.value.unshift(`▶ 自动采集已开启（每 ${autoInterval.value} 秒抓一帧，命中即入库并自动去重）`)
  autoTick()
  autoTimer = setInterval(autoTick, Math.max(1, autoInterval.value) * 1000)
}
function stopAuto() {
  autoRunning.value = false
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null }
  autoLog.value.unshift('⏸ 自动采集已停止')
}

onMounted(async () => {
  try {
    catTree.value = await getCategories()
    restoreDefaultCat()          // 树到位后再回填一次记住的默认分类
  } catch (e) { /* ignore */ }
  await load()
  loadServers()                 // 区服列表（与全服金价同源）
})
onUnmounted(() => {
  stopAuto()
})
</script>

<template>
  <div class="harvest-page">
    <!-- 左侧分类导航（两级树） -->
    <aside class="cat-nav">
      <div class="cat-title">物品分类</div>
      <ul class="cat-list">
        <li :class="{ on: activeCat === '' }" @click="pickCat('')">全部</li>
        <li v-for="top in catTree" :key="top.name" class="top">
          <div class="top-row" :class="{ on: activeCat === top.name }" @click="pickCat(top.name)">
            <span class="tw" @click.stop="toggleTop(top.name)">{{ expanded[top.name] ? '▾' : '▸' }}</span>
            <span class="top-name">{{ top.name }}</span>
          </div>
          <ul v-if="expanded[top.name]" class="sub">
            <li v-for="lf in top.children" :key="lf.name" :class="{ on: activeCat === lf.name }" @click="pickCat(lf.name)">{{ lf.name }}</li>
          </ul>
        </li>
      </ul>
    </aside>

    <div class="harvest-main">
      <div class="card head-card">
        <h2>🌾 摆摊收售价采集 · 时间服全区物价表</h2>
        <p class="muted">
          收货价看板：开启左侧「屏幕共享」竖条并切到摊位界面，截图即可自动识别入库；也可开启自动采集连续记录。
          系统按物品聚合出 <strong>平均 / 最高收货价 / 最低出货价</strong> 与样本数、最新采集时间，并附带物品截图。
        </p>
      </div>

      <!-- 摊位截图采集（无需框选，后端自动定位摊位） -->
      <div class="card capture-card">
        <!-- 屏幕共享：与抓鬼助手共用同一个组件（左侧竖条开启；画面走竖条上的「🖼」浮窗预览） -->
        <ScreenShare ref="screenShareRef" label="收货监控" />
        <div class="cap-head">
          <h3>📷 摊位截图采集</h3>
          <span class="muted">点左侧竖条「开始监控」开启屏幕共享 → 点「📸 截图并识别」直接截整个窗口（自动定位摊位，无需框选）→ 勾选入库；点竖条「🖼」可看监控画面</span>
        </div>
        <div class="cap-bar">
          <button class="btn btn-gold" :disabled="!sharing" @click="captureWindowShot">📸 截图并识别</button>
          <span class="cap-sep"></span>
          <label class="auto-iv">间隔
            <input type="number" v-model.number="autoInterval" min="1" max="30" :disabled="autoRunning" />
            秒
          </label>
          <button v-if="!autoRunning" class="btn btn-gold" :disabled="!sharing" @click="startAuto">🤖 自动采集</button>
          <button v-else class="btn btn-del" @click="stopAuto">
            ⏹ 停止（{{ autoStat.frames }}帧 / 入库{{ autoStat.imported }}）
          </button>
        </div>

        <!-- 默认服务器 / 默认分类：识别与自动采集都用它 -->
        <div class="cap-defaults">
          <label class="def-serv">默认服务器
            <input v-model="defaultServer" list="harvest-server-list" placeholder="如：叠彩山（自动记住）"
                   title="记住上次填写；上方筛选区服变化时，若你没手填过这里会自动跟随"
                   @input="defServerManual = true" />
          </label>
          <label class="def-serv">默认分类
            <select v-model="defaultParent" @change="onDefaultParent">
              <option value="">-- 顶级 --</option>
              <option v-for="t in catTree" :key="t.name" :value="t.name">{{ t.name }}</option>
            </select>
          </label>
          <label class="def-serv">
            <select v-model="defaultCategory" :disabled="!defaultParent">
              <option value="">-- 子分类 --</option>
              <option v-for="c in defaultLeaves" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
          </label>
          <button class="btn btn-mini" :disabled="!defaultCategory" @click="applyDefaultCategory">应用到未匹配行</button>
          <span class="muted">类目表里没有的物品（如兽决）用这里兜底</span>
        </div>

        <p v-if="ocrMsg" class="ocr-msg">{{ ocrMsg }}</p>
        <!-- 调试期：这一帧的识别中间结果 -->
        <p v-if="dbgInfo" class="dbg-msg">🐞 {{ dbgInfo }}</p>

        <!-- 最近一次的截图（供回看识别来源） -->
        <div v-if="capturedImg" class="cap-shot-wrap">
          <div class="cap-right-title">最近截图</div>
          <img :src="capturedImg" class="cap-shot" alt="最近一次截屏" />
        </div>

        <!-- 自动采集日志 -->
        <div v-if="autoLog.length" class="auto-log">
          <div class="auto-log-head">
            <span>🤖 自动采集日志</span>
            <span class="muted">去重键＝物品名+价格，同一价格不会重复入库</span>
          </div>
          <ul>
            <li v-for="(l, i) in autoLog" :key="i">{{ l }}</li>
          </ul>
        </div>

        <!-- OCR 候选 → 勾选入库 -->
        <div v-if="drafts.length" class="draft-wrap">
          <div class="draft-head">
            <!-- 全选按钮移到左边（原来在右侧，找不着） -->
            <span class="draft-acts">
              <button class="btn btn-mini" @click="toggleAll">{{ allChecked ? '取消全选' : '全选' }}</button>
              <button class="btn btn-mini" :disabled="!defaultCategory" @click="applyDefaultCategory">应用默认分类到未匹配行</button>
            </span>
            <span class="muted">识别候选（默认只勾选信息齐全的行，确认后直接导入）</span>
          </div>
          <div class="tbl-wrap">
            <table class="draft-table">
              <thead>
                <tr>
                  <th>✓</th>
                  <th>OCR原文</th>
                  <th>置信度</th>
                  <th>物品名</th>
                  <th>价格类型</th>
                  <th>价格</th>
                  <th>顶级分类</th>
                  <th>子分类</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in drafts" :key="d.idx">
                  <td><input type="checkbox" v-model="d.checked" /></td>
                  <td class="raw">{{ d.text }}</td>
                  <td class="score">{{ (d.score * 100).toFixed(0) }}%</td>
                  <td>
                    <span class="mtag" :class="d.matched ? 'ok' : 'no'" :title="d.matched ? '已归一到规范物品(' + d.match_method + ')' : '未匹配，请手选分类'">{{ d.matched ? '✓' : '?' }}</span>
                    <span v-if="d.split" class="mtag split" title="该条目由「黏连物品名」自动切分而来，价格需逐条核对">拆</span>
                    <img v-if="d.icon" :src="'/static/icons/' + d.icon" class="dicon" alt=""
                         @error="(e:any)=>{(e.target as HTMLElement).style.display='none'}" />
                    <input v-model="d.name" placeholder="物品名" />
                  </td>
                  <td>
                    <select v-model="d.price_type" :title="d.price_type === 'buy' ? '收购摊位单价＝收货价' : '出售摊位单价＝出货价'">
                      <option value="buy">收货</option>
                      <option value="sell">出货</option>
                    </select>
                  </td>
                  <td>
                    <!-- 框里显示游戏币原值（不带万）：显示 ×10000，输入 ÷10000 存回万 -->
                    <input :value="draftPriceView(d.price)" @input="setDraftPrice(d, ($event.target as HTMLInputElement).value)"
                           type="number" step="1" placeholder="价格" class="price-input"
                           :style="{ color: priceColor(Number(d.price) || 0) }"
                           :title="d.price ? priceTier(Number(d.price)) : ''" />
                  </td>
                  <td>
                    <select v-model="d.parent" @change="onDraftParent(d)">
                      <option value="">-- 顶级 --</option>
                      <option v-for="t in catTree" :key="t.name" :value="t.name">{{ t.name }}</option>
                    </select>
                  </td>
                  <td>
                    <select v-model="d.category" :disabled="!d.parent">
                      <option value="">{{ d.parent ? '-- 子分类 --' : '先选顶级' }}</option>
                      <!-- 当前值不在该顶级的候选里时（如顶级是按关键词推断、偏了），
                           补一个选项，否则 select 会显示成空白，看着像"没有子分类" -->
                      <option v-if="d.category && !leavesOf(d.parent).some((l) => l.name === d.category)"
                              :value="d.category">{{ d.category }}</option>
                      <option v-for="lf in leavesOf(d.parent)" :key="lf.name" :value="lf.name">{{ lf.name }}</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="form-ops">
            <button class="btn btn-primary" :disabled="!checkedDrafts.length" @click="importChecked">
              导入勾选的 {{ checkedDrafts.length }} 条
            </button>
          </div>
        </div>
      </div>

      <!-- 筛选条 -->
      <div class="card">
        <div class="filter-grid">
          <input v-model="server" list="harvest-server-list" placeholder="服务器（可下拉选，自动记住）" @keyup.enter="doQuery()" />
          <datalist id="harvest-server-list">
            <option v-for="s in serverList" :key="s.value" :value="s.value">{{ s.label }}</option>
          </datalist>
          <input v-model="kw" placeholder="物品名关键字" @keyup.enter="doQuery()" />
          <select v-model="sort" @change="doQuery()">
            <option value="latest">最新采集</option>
            <option value="price_desc">均价降序</option>
            <option value="price_asc">均价升序</option>
            <option value="count">样本数</option>
          </select>
          <button class="btn btn-primary" @click="doQuery()">查询</button>
          <button class="btn" @click="resetFilters()">重置</button>
          <button class="btn btn-del" @click="clearServerData" title="清空该区服的全部收货/出货价样本">🗑 清空该区服</button>
        </div>
        <p class="count">共 {{ view.length }} 个物品 · {{ items.reduce((s, i) => s + i.count, 0) }} 条样本</p>
        <div class="pc-legend">
          <span>金额配色（同游戏内，按游戏币位数）：</span>
          <i class="sw" :style="{ background: 'var(--pc-5)' }"></i>5位(万级)
          <i class="sw" :style="{ background: 'var(--pc-6)' }"></i>6位(十万级)
          <i class="sw" :style="{ background: 'var(--pc-7)' }"></i>7位(百万级)
          <i class="sw" :style="{ background: 'var(--pc-8)' }"></i>8位(千万级)
          <i class="sw" :style="{ background: 'var(--pc-9)' }"></i>9位+(亿级)
        </div>
      </div>

      <!-- 聚合表 -->
      <div class="card">
        <div class="tbl-wrap">
          <table v-if="view.length" class="compact">
            <thead>
              <tr>
                <th>图片</th>
                <th>物品名</th>
                <!-- 价格列/样本数列：表头与单元格用同一对齐（都居中），否则标题左、数字中会视觉偏移 -->
                <th class="price">收货均价</th>
                <th class="price">最高收货价</th>
                <!-- 最高收货价来自哪个摊位：摊位名 / 摊主昵称 / 摊主ID（点价格可看完整溯源） -->
                <th class="who">最高收货摊位名</th>
                <th class="who">收货摊主昵称</th>
                <th class="who">收货摊主ID</th>
                <th class="price">出货均价</th>
                <th class="price">最低出货价</th>
                <!-- 最低出货价来自哪个摊位 -->
                <th class="who">最低出货摊位名</th>
                <th class="who">出货摊主昵称</th>
                <th class="who">出货摊主ID</th>
                <th class="num">样本数</th>
                <th>最新采集时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in pagedView" :key="it.item_name">
                <td>
                  <img v-if="iconSrc(it)" :src="iconSrc(it)" class="thumb" alt="" @error="(e:any)=>{(e.target as HTMLElement).style.display='none'}" />
                  <span v-else class="no-img">—</span>
                </td>
                <td class="name">{{ it.item_name }}</td>
                <td class="price" :title="it.buy ? '收货 · ' + priceTier(it.buy.avg) : ''">
                  <span v-if="it.buy" class="pv" :style="{ color: priceColor(it.buy.avg) }">{{ fmtPrice(it.buy.avg) }}</span>
                  <span v-else class="pv-empty">—</span>
                </td>
                <!-- 最高收货价：点开看是哪个摊位收的 -->
                <td class="price clickable"
                    :title="it.buy && it.buy.max_rec ? '点击查看来源摊位 · 区间 ' + fmtPrice(it.buy.min) + ' ~ ' + fmtPrice(it.buy.max) : ''"
                    @click="it.buy && it.buy.max_rec && openRec(it.item_name, 'buy', it.buy.max_rec)">
                  <span v-if="it.buy && it.buy.max_rec" class="pv"
                        :style="{ color: priceColor(it.buy.max_rec.price) }">{{ fmtPrice(it.buy.max_rec.price) }}</span>
                  <span v-else class="pv-empty">—</span>
                </td>
                <td class="who" :title="it.buy?.max_rec?.stall_name || ''">{{ it.buy?.max_rec?.stall_name || '—' }}</td>
                <td class="who" :title="it.buy?.max_rec?.stall_owner || ''">{{ it.buy?.max_rec?.stall_owner || '—' }}</td>
                <td class="who mono" :title="it.buy?.max_rec?.stall_id || ''">{{ it.buy?.max_rec?.stall_id || '—' }}</td>
                <td class="price" :title="it.sell ? '出货 · ' + priceTier(it.sell.avg) : ''">
                  <span v-if="it.sell" class="pv" :style="{ color: priceColor(it.sell.avg) }">{{ fmtPrice(it.sell.avg) }}</span>
                  <span v-else class="pv-empty">—</span>
                </td>
                <!-- 最低出货价：点开看是哪个摊位卖的 -->
                <td class="price clickable"
                    :title="it.sell && it.sell.min_rec ? '点击查看来源摊位 · 区间 ' + fmtPrice(it.sell.min) + ' ~ ' + fmtPrice(it.sell.max) : ''"
                    @click="it.sell && it.sell.min_rec && openRec(it.item_name, 'sell', it.sell.min_rec)">
                  <span v-if="it.sell && it.sell.min_rec" class="pv"
                        :style="{ color: priceColor(it.sell.min_rec.price) }">{{ fmtPrice(it.sell.min_rec.price) }}</span>
                  <span v-else class="pv-empty">—</span>
                </td>
                <td class="who" :title="it.sell?.min_rec?.stall_name || ''">{{ it.sell?.min_rec?.stall_name || '—' }}</td>
                <td class="who" :title="it.sell?.min_rec?.stall_owner || ''">{{ it.sell?.min_rec?.stall_owner || '—' }}</td>
                <td class="who mono" :title="it.sell?.min_rec?.stall_id || ''">{{ it.sell?.min_rec?.stall_id || '—' }}</td>
                <td class="num">{{ it.count }}</td>
                <td class="time">{{ fmtTime(it.latest) }}</td>
                <td class="ops"><button class="btn-mini btn-del" @click="del(it.item_name)">清样本</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">暂无数据。点左侧竖条开启屏幕共享并切到摊位界面，再点「📸 截图并识别」开始记录收货价。</p>
        </div>

        <!-- 分页：每页 15 条 -->
        <div v-if="view.length > PAGE_SIZE" class="pager">
          <button class="btn-mini" :disabled="page <= 1" @click="gotoPage(page - 1)">‹ 上一页</button>
          <button v-for="p in totalPages" :key="p" class="btn-mini page-num"
                  :class="{ active: p === page }" @click="gotoPage(p)">{{ p }}</button>
          <button class="btn-mini" :disabled="page >= totalPages" @click="gotoPage(page + 1)">下一页 ›</button>
          <span class="pager-info">每页 15 条 · 第 {{ page }}/{{ totalPages }} 页 · 共 {{ view.length }} 个物品</span>
        </div>
      </div>

      <p v-if="msg" class="msg">{{ msg }}</p>

      <!-- 价格溯源弹窗：点「最高收货价 / 最低出货价」看是哪个摊位 -->
      <div v-if="recBox" class="rec-mask" @click.self="closeRec">
        <div class="rec-box">
          <div class="rec-head">
            <span class="rec-title">🏪 来源摊位</span>
            <button class="rec-close" @click="closeRec">✕</button>
          </div>
          <div class="rec-item">
            <img v-if="recIcon" :src="recIcon" class="rec-thumb" alt="" />
            <div class="rec-itemMeta">
              <div class="rec-name">{{ recBox.item }}</div>
              <div class="rec-kind" :class="recBox.kind">
                {{ recBox.kind === 'buy' ? '收货价（店主收购）' : '出货价（店主出售）' }}
              </div>
            </div>
          </div>
          <div class="rec-price" :style="{ color: priceColor(recBox.rec.price) }">
            {{ fmtPrice(recBox.rec.price) }}
          </div>
          <dl class="rec-list">
            <div class="rec-row">
              <dt>摊位名称</dt>
              <dd>{{ recBox.rec.stall_name || '（未记录，样本早于摊位名功能）' }}</dd>
            </div>
            <div class="rec-row">
              <dt>摊主昵称</dt>
              <dd>{{ recBox.rec.stall_owner || '（未记录，样本早于摊位识别功能）' }}</dd>
            </div>
            <div class="rec-row">
              <dt>摊位 ID</dt>
              <dd class="mono">{{ recBox.rec.stall_id || '—' }}</dd>
            </div>
            <div class="rec-row">
              <dt>买卖价 ID</dt>
              <dd class="mono">{{ recBox.rec.id || '—' }}</dd>
            </div>
            <div class="rec-row">
              <dt>区服</dt>
              <dd>{{ recBox.rec.server || '—' }}</dd>
            </div>
            <div class="rec-row">
              <dt>采集时间</dt>
              <dd>{{ fmtTime(recBox.rec.collected_at) }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.harvest-page {
  flex: 1; display: flex; flex-direction: row; gap: 10px; padding: 8px; width: 100%; box-sizing: border-box;
  font-family: var(--font-mono);
  /* 游戏币金额 → 游戏内显示颜色 */
  --pc-5: #6cb6ff;   /* 五位数 万   蓝 */
  --pc-6: #5fd07a;   /* 六位数 十万 绿 */
  --pc-7: #f06a6a;   /* 七位数 百万 红 */
  --pc-8: #b48ce8;   /* 八位数 千万 紫 */
  --pc-9: #ee7bc4;   /* 九位+  亿   品红 */
}
.cat-nav {
  flex: 0 0 160px; align-self: flex-start; position: sticky; top: 8px;
  background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px;
}
.cat-title { font-size: 12px; color: var(--color-text-muted); margin-bottom: 6px; letter-spacing: 1px; }
.cat-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.cat-list li {
  padding: 7px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; color: var(--color-text-muted);
  border: 1px solid transparent; transition: 0.08s linear;
}
.cat-list li:hover { color: var(--color-text); border-color: var(--border-strong); }
.cat-list li.on { background: var(--color-accent); color: #1a1402; border-color: var(--color-accent); font-weight: 700; }
.cat-list li.top { padding: 0; border: none; }
.cat-list li.top:hover { color: inherit; border-color: transparent; }
.top-row { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; color: var(--color-text-muted); border: 1px solid transparent; }
.top-row:hover { color: var(--color-text); border-color: var(--border-strong); }
.top-row.on { background: var(--color-accent); color: #1a1402; border-color: var(--color-accent); font-weight: 700; }
.tw { width: 14px; text-align: center; opacity: 0.7; flex: 0 0 auto; }
.top-name { flex: 1; }
.sub { list-style: none; margin: 2px 0 4px; padding: 0 0 0 18px; display: flex; flex-direction: column; gap: 2px; }
.sub li { padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; color: var(--color-text-muted); border: 1px solid transparent; transition: 0.08s linear; }
.sub li:hover { color: var(--color-text); border-color: var(--border-strong); }
.sub li.on { background: rgba(34, 211, 238, 0.16); color: var(--color-primary); border-color: rgba(34, 211, 238, 0.3); font-weight: 600; }
.harvest-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.card {
  position: relative; background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 6px; padding: 10px 12px;
}
.card h2 { margin: 0 0 4px; color: var(--color-primary); font-family: var(--font-pixel), var(--font-cn); }
.muted { color: var(--color-text-muted); font-size: 12px; line-height: 1.5; }
.btn {
  padding: 7px 14px; border: 2px solid var(--border-strong); border-radius: 3px; background: var(--bg-card);
  cursor: pointer; color: var(--color-text); font-family: var(--font-mono); transition: 0.08s linear;
}
.btn-primary { background: var(--color-primary); color: #06121a; border-color: var(--color-primary); }
.btn-primary:hover { background: #5fe3f5; }
.btn-gold { background: var(--color-accent); color: #1a1402; border-color: var(--color-accent); margin-top: 8px; }
.btn-gold:hover { background: #fde047; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.form-ops { margin-top: 10px; display: flex; gap: 8px; }
.filter-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.filter-grid input, .filter-grid select {
  padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;
  background: var(--bg-input); color: var(--color-text);
}
.filter-grid input:focus, .filter-grid select:focus { outline: none; border-color: var(--color-primary); }
.count { font-size: 13px; color: var(--color-text-muted); margin: 10px 0 0; }
.tbl-wrap { overflow-x: auto; }

/* ===== 主表格「列紧凑」：只收横向列宽/列间距，行高保持原样 =====
   （纵向 padding、line-height、图标、字号一律沿用全局 table 默认值） */
/* width:auto 让列宽按内容贴合（原来是 100%，压掉的空间会被其他列分摊，等于没紧凑） */
.compact { width: auto; }
/* 表头：放大加粗 + 清晰字体（像素字放大发虚）+ 亮色底条，让列名更明显 */
.compact th {
  padding: 8px 5px; white-space: nowrap;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif;
  font-size: 12.5px; font-weight: 700; letter-spacing: 0;
  color: var(--color-primary);
  border-bottom: 2px solid rgba(34, 211, 238, 0.35);
  background: rgba(34, 211, 238, 0.06);
}
.compact td { padding: 8px 4px; }
/* 物品名不换行：长名字撑宽列而不是撑高行（行高要保持原样） */
.compact .name { white-space: nowrap; }
.compact .pv { padding: 2px 7px; }                       /* 价格胶囊略收 */
.compact .ops .btn-mini { padding: 4px 7px; }
/* 摊位名 / 摊主昵称 / 摊位ID 列：窄一点、不换行、过长省略（完整值看 title 悬浮提示） */
.compact .who {
  max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11.5px; color: var(--color-text-muted);
}
.compact th.who { font-size: 11.5px; }
/* 图片列固定窄宽，不让它随内容撑开 */
.compact th:nth-child(1), .compact td:nth-child(1) { width: 30px; padding-right: 0; }

/* ===== 分页 ===== */
.pager { display: flex; align-items: center; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
.pager .btn-mini:disabled { opacity: 0.4; cursor: not-allowed; }
.page-num { min-width: 30px; text-align: center; }
.page-num.active {
  border-color: var(--color-primary); color: var(--color-primary);
  font-weight: 700; background: rgba(34, 211, 238, 0.12);
}
.pager-info { margin-left: auto; font-size: 12px; color: var(--color-text-muted); }
/* 本模块表格用清晰字体：全局 --font-mono 首选 VT323（像素点阵），小字号下发虚，
   表格数据密集时看不清。其他页面仍保留像素风，只这里换掉。 */
table { width: 100%; border-collapse: collapse; font-size: 14px;
        font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif; }
table td, table th { line-height: 1.75; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color); vertical-align: middle; color: var(--color-text); }
th { font-family: var(--font-pixel), var(--font-cn); font-size: 10px; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.4px; }
tr:hover { background: rgba(34,211,238,0.04); }
.thumb { width: 40px; height: 40px; object-fit: contain; border-radius: 6px; border: 1px solid var(--border-color); background: #0c0c10; image-rendering: pixelated; }
.no-img { color: var(--color-text-muted); }
.name { font-weight: 600; }
.cat-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: rgba(34,211,238,0.1); color: var(--color-primary); border: 1px solid rgba(34,211,238,0.25); }
.price { text-align: center; white-space: nowrap; }
/* 价格胶囊：对齐游戏摊位「单价」的显示 —— 深蓝黑底 + 圆角 + 描边字，数字按位数配色 */
.pv {
  display: inline-block; padding: 2px 9px; border-radius: 4px;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif;
  font-weight: 700; font-size: 15px; line-height: 1.4; letter-spacing: 0.5px;
  background: linear-gradient(180deg, #242e47 0%, #161c2b 100%);
  border: 1px solid #3d4a6b;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 1px 2px rgba(0, 0, 0, 0.5);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.9);
}
.pv-empty { color: var(--color-text-muted); }
/* 可点击溯源的价格：金边 + 手型 */
.price.clickable { cursor: pointer; }
.price.clickable .pv { border-color: rgba(255, 215, 0, 0.45); }
.price.clickable:hover .pv { border-color: var(--color-accent); filter: brightness(1.22); }

/* ===== 价格溯源弹窗 ===== */
.rec-mask {
  position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.rec-box {
  width: 340px; max-width: calc(100vw - 32px); padding: 14px 16px 12px;
  background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
}
.rec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.rec-title { font-size: 13px; letter-spacing: 1px; color: var(--color-text-muted); }
.rec-close {
  background: none; border: none; cursor: pointer; font-size: 15px; color: var(--color-text-muted); padding: 0 4px;
}
.rec-close:hover { color: var(--color-text); }
.rec-item { display: flex; align-items: center; gap: 10px; }
.rec-thumb {
  width: 44px; height: 44px; object-fit: contain; border-radius: 6px;
  border: 1px solid var(--border-color); background: #0c0c10; image-rendering: pixelated;
}
.rec-name { font-size: 16px; font-weight: 700; color: var(--color-text); }
.rec-kind { font-size: 12px; margin-top: 2px; }
.rec-kind.buy { color: var(--color-primary); }
.rec-kind.sell { color: var(--color-accent); }
.rec-price {
  display: inline-block; align-self: flex-start; margin: 10px 0 12px; padding: 4px 16px; border-radius: 5px;
  font-size: 26px; font-weight: 700; letter-spacing: 1px;
  background: linear-gradient(180deg, #242e47 0%, #161c2b 100%);
  border: 1px solid #3d4a6b; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.9);
}
.rec-list { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.rec-row { display: flex; align-items: baseline; gap: 10px; font-size: 13px; }
.rec-row dt { flex: 0 0 68px; color: var(--color-text-muted); }
.rec-row dd { margin: 0; color: var(--color-text); word-break: break-all; }
.rec-row dd.mono { font-family: var(--font-mono); letter-spacing: 0.5px; }
.price.buy { color: var(--color-accent); }
.price.sell { color: #4fb0c6; }
.range { font-size: 13px; color: var(--color-text-muted); white-space: nowrap; }
.draft-acts { display: flex; gap: 6px; align-items: center; }
.pc-legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--color-text-muted); margin-top: 4px; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.pc-legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: 8px; vertical-align: middle; }
.num { text-align: center; font-weight: 700; }
.time { color: var(--color-text-muted); white-space: nowrap; }
.ops { white-space: nowrap; }
.btn-mini { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg-card); color: var(--color-text); }
.btn-mini:hover { border-color: var(--border-strong); }
.btn-del { color: var(--color-danger); border-color: rgba(244,63,94,0.3); }
.btn-del:hover { border-color: var(--color-danger); }
.msg { color: var(--color-accent); font-size: 13px; }
.capture-card { border-color: rgba(34, 211, 238, 0.25); background: linear-gradient(180deg, rgba(34, 211, 238, 0.04), rgba(34, 211, 238, 0.01)); }
.cap-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.cap-head h3 { margin: 0; color: var(--color-primary); font-family: var(--font-pixel), var(--font-cn); }
.cap-bar { display: flex; gap: 8px; flex-wrap: wrap; }
.cap-defaults { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 8px; font-size: 12px; }
.cap-defaults select { padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 12px; }
.ocr-msg { margin-top: 8px; font-size: 12px; color: var(--color-accent); }
/* 调试信息条：等宽小字，与正式提示区分开 */
.dbg-msg {
  margin-top: 6px; font-size: 11px; line-height: 1.6; color: #9fb3c8;
  font-family: 'SF Mono', Menlo, Consolas, monospace; word-break: break-all;
}
.cap-sep { width: 1px; align-self: stretch; background: var(--border-color); margin: 0 2px; }
.auto-iv { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--color-text-muted); }
.auto-iv input { width: 56px; }
.auto-log { margin-top: 10px; border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px; background: rgba(0, 0, 0, 0.15); }
.auto-log-head { display: flex; gap: 10px; align-items: baseline; font-size: 12px; margin-bottom: 6px; }
.auto-log ul { margin: 0; padding-left: 18px; max-height: 140px; overflow-y: auto; font-size: 13px; line-height: 1.7; font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif; }
.cap-shot-wrap { margin-top: 10px; max-width: 360px; }
.cap-right-title { font-size: 12px; color: var(--color-text-muted); margin-bottom: 4px; }
.cap-shot { width: 100%; border: 1px solid var(--border-color); border-radius: 6px; background: #000; }
.draft-wrap { margin-top: 12px; border-top: 1px dashed var(--border-color); padding-top: 10px; }
.draft-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; color: var(--color-text-muted); margin-bottom: 8px; flex-wrap: wrap; }
.def-serv { display: flex; gap: 6px; align-items: center; }
.def-serv input { padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 12px; }
.draft-wrap table { font-size: 13px; }
.draft-wrap th, .draft-wrap td { padding: 6px; }
/* 草稿表表头：与主表格同款（清晰字体 + 放大加粗 + 亮色底条），原来 10px 像素字看不清 */
.draft-table th {
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif;
  font-size: 12.5px; font-weight: 700; letter-spacing: 0;
  color: var(--color-primary);
  border-bottom: 2px solid rgba(34, 211, 238, 0.35);
  background: rgba(34, 211, 238, 0.06);
  white-space: nowrap;
}
.draft-wrap input, .draft-wrap select { padding: 5px 7px; border: 1px solid var(--border-color); border-radius: 5px; background: var(--bg-input); color: var(--color-text); font-size: 13px; max-width: 140px; font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif; }
.draft-wrap input[type=number] { max-width: 90px; }
/* 草稿区价格输入：同款游戏价格底色（数字按位数配色） */
.draft-wrap input.price-input {
  background: linear-gradient(180deg, #242e47 0%, #161c2b 100%);
  border-color: #3d4a6b; font-weight: 700; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.9);
}
.draft-wrap .raw { color: var(--color-text-muted); max-width: 160px; word-break: break-all; }
.draft-wrap .score { color: var(--color-accent); white-space: nowrap; }
.draft-wrap .mtag { display: inline-block; width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: 50%; font-size: 11px; font-weight: 700; margin-right: 4px; vertical-align: middle; }
.draft-wrap .mtag.ok { background: rgba(99,161,34,0.18); color: #97C459; border: 1px solid rgba(99,161,34,0.4); }
.draft-wrap .mtag.no { background: rgba(244,63,94,0.14); color: #F09595; border: 1px solid rgba(244,63,94,0.3); }
.draft-wrap .mtag.split { width: auto; padding: 0 5px; border-radius: 8px; background: rgba(240,173,78,0.16); color: #F0AD4E; border: 1px solid rgba(240,173,78,0.35); }
.draft-wrap .dicon { width: 20px; height: 20px; vertical-align: middle; margin-right: 4px; border-radius: 3px; image-rendering: pixelated; }
</style>
