<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { getCategories, getHarvest, addSample, deleteItem, recognizeImage, type HarvestItem, type CatNode, type OcrBlock } from '@/services/harvestApi'
import { ScreenCapture } from '@/services/screenCapture'
import RegionPicker from '@/components/jiankong/RegionPicker.vue'

const catTree = ref<CatNode[]>([])
const expanded = reactive<Record<string, boolean>>({})
const activeCat = ref('')          // '' = 全部；可为顶级名或叶子名
const server = ref('')
const kw = ref('')
const sort = ref<'latest' | 'price_desc' | 'price_asc' | 'count'>('latest')
const items = ref<HarvestItem[]>([])
const msg = ref('')
const showForm = ref(false)

// 采集表单
const form = reactive({ item_name: '', parent: '', category: '', server: '', price: '', icon: '' })
const submitting = ref(false)

// 当前父级下的子分类（表单联动）
const currentLeaves = computed(() => {
  const t = catTree.value.find((x) => x.name === form.parent)
  return t ? t.children : []
})
function onParentChange() {
  form.category = ''
}
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

function iconSrc(it: HarvestItem): string {
  if (!it.icon) return ''
  return '/static/icons/' + it.icon
}
function fmtPrice(p: number): string {
  if (p == null) return '-'
  return p.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 万'
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

async function submitForm() {
  if (!form.item_name.trim() || !form.parent || !form.category || !form.server.trim() || !form.price) {
    msg.value = '物品名 / 顶级分类 / 子分类 / 服务器 / 收货价 都必填'
    return
  }
  const price = Number(form.price)
  if (isNaN(price) || price < 0) {
    msg.value = '收货价必须是非负数字'
    return
  }
  submitting.value = true
  try {
    const r = await addSample({
      item_name: form.item_name.trim(),
      category: form.category,
      server: form.server.trim(),
      price,
      icon: form.icon.trim() || undefined,
    })
    if (r.success) {
      msg.value = `已采集「${form.item_name}」(${form.category}) 收货价 ${fmtPrice(price)}`
      form.item_name = ''; form.parent = ''; form.category = ''; form.price = ''; form.icon = ''
      showForm.value = false
      await load()
    } else {
      msg.value = '采集失败：' + JSON.stringify(r)
    }
  } catch (e) {
    msg.value = '采集失败：' + (e as Error).message
  } finally {
    submitting.value = false
  }
}

async function del(name: string) {
  if (!confirm('删除该物品的全部采集样本？')) return
  await deleteItem(name)
  await load()
}

// ===== 框选截图采集（对标 mhxyai 摊位截图识别）=====
const capturer = new ScreenCapture()
const pickerRef = ref<InstanceType<typeof RegionPicker> | null>(null)
const sharing = ref(false)
const previewSrc = ref('')
const capturedImg = ref('')
const ocrMsg = ref('')
const ocrBlocks = ref<OcrBlock[]>([])
const defaultServer = ref('')
let previewTimer: ReturnType<typeof setInterval> | null = null

interface DraftRow {
  idx: number
  text: string
  score: number
  checked: boolean
  name: string
  price: string
  parent: string
  category: string
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

async function startShare() {
  const ok = await capturer.start()
  if (!ok) {
    ocrMsg.value = '屏幕共享失败：需 HTTPS 或 localhost 且浏览器支持 getDisplayMedia'
    return
  }
  sharing.value = true
  ocrMsg.value = '共享已开启：拖动红框选住「收货摊位」区域，再点「📸 截取选中区域」'
  previewTimer = setInterval(() => {
    const f = capturer.getPreviewFrame()
    if (f) previewSrc.value = f
  }, 400)
}
function stopShare() {
  if (previewTimer) { clearInterval(previewTimer); previewTimer = null }
  capturer.stop()
  sharing.value = false
  previewSrc.value = ''
}
function captureRegionShot() {
  const picker = pickerRef.value as any
  if (!picker) return
  const r = picker.getRegionRatio() as { x: number; y: number; w: number; h: number }
  const sz = capturer.getVideoSize()
  if (!sz) return
  const region = {
    x: Math.round(r.x * sz.width),
    y: Math.round(r.y * sz.height),
    width: Math.max(1, Math.round(r.w * sz.width)),
    height: Math.max(1, Math.round(r.h * sz.height)),
  }
  const dataUrl = capturer.captureRegion(region)
  if (dataUrl) capturedImg.value = dataUrl
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
  if (!capturedImg.value) { ocrMsg.value = '请先框选并截取区域'; return }
  ocrMsg.value = 'OCR 识别中…'
  try {
    const blob = dataUrlToBlob(capturedImg.value)
    const res = await recognizeImage(blob)
    if (res.success) {
      ocrBlocks.value = res.blocks || []
      drafts.value = (res.blocks || []).map((b, i) => {
        const p = parseBlock(b.text)
        return { idx: i, text: b.text, score: b.score, checked: false, name: p.name, price: p.price, parent: '', category: '' }
      })
      ocrMsg.value = `识别到 ${ocrBlocks.value.length} 个文字块，请逐条确认「物品名 / 价格 / 分类」后导入`
    } else {
      ocrMsg.value = '识别失败：' + JSON.stringify(res)
    }
  } catch (e) {
    ocrMsg.value = '识别失败：' + (e as Error).message
  }
}
const checkedDrafts = computed(() => drafts.value.filter((d) => d.checked))
async function importChecked() {
  const rows = checkedDrafts.value
  if (!rows.length) { ocrMsg.value = '请勾选要导入的行'; return }
  if (!defaultServer.value.trim()) { ocrMsg.value = '请填写默认服务器（应用到勾选行）'; return }
  if (rows.some((d) => !d.category || !d.name.trim() || d.price === '')) {
    ocrMsg.value = '有勾选行缺少 物品名 / 子分类 / 价格，请补全后再导入'
    return
  }
  let okCount = 0
  for (const d of rows) {
    const price = Number(d.price)
    if (isNaN(price) || price < 0) continue
    const r = await addSample({ item_name: d.name.trim(), category: d.category, server: defaultServer.value.trim(), price })
    if (r.success) okCount++
  }
  ocrMsg.value = `已导入 ${okCount} 条收货价样本`
  drafts.value = []
  ocrBlocks.value = []
  capturedImg.value = ''
  await load()
}

onMounted(async () => {
  try { catTree.value = await getCategories() } catch (e) { /* ignore */ }
  await load()
})
</script>

<template>
  <div class="harvest-page">
    <!-- 左侧分类导航（两级树，对齐 mhxyai 侧栏） -->
    <aside class="cat-nav">
      <div class="cat-title">物品分类（mhxyai 同款）</div>
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
        <h2>🌾 收货采集 · 时间服全区物价表</h2>
        <p class="muted">
          对标 mhxyai 的收货价看板：每次在游戏里看到「收货价」就采一条样本，系统自动按物品聚合出
          <strong>平均 / 最低 / 最高收货价</strong> 与样本数、最新采集时间。比对方多带物品图片。
        </p>
        <button class="btn btn-gold" @click="showForm = !showForm">{{ showForm ? '收起采集表单 ▲' : '＋ 采集一条样本' }}</button>
      </div>

      <!-- 采集表单 -->
      <div v-if="showForm" class="card form-card">
        <div class="form-grid">
          <label>顶级分类
            <select v-model="form.parent" @change="onParentChange">
              <option value="">-- 顶级 --</option>
              <option v-for="t in catTree" :key="t.name" :value="t.name">{{ t.name }}</option>
            </select>
          </label>
          <label>子分类（物品所属）
            <select v-model="form.category" :disabled="!form.parent">
              <option value="">{{ form.parent ? '-- 子分类 --' : '请先选顶级' }}</option>
              <option v-for="lf in currentLeaves" :key="lf.name" :value="lf.name">{{ lf.name }}</option>
            </select>
          </label>
          <label>物品名
            <input v-model="form.item_name" placeholder="如：高级必杀" />
          </label>
          <label>服务器
            <input v-model="form.server" placeholder="如：梦幻西游" />
          </label>
          <label>收货价（万）
            <input v-model="form.price" type="number" step="0.0001" placeholder="如：850" />
          </label>
          <label>图标路径（可选）
            <input v-model="form.icon" placeholder="如：道具/特赦令牌.png" />
          </label>
        </div>
        <div class="form-ops">
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">{{ submitting ? '采集中…' : '提交采集' }}</button>
          <button class="btn" @click="showForm = false">取消</button>
        </div>
      </div>

      <!-- 框选截图采集（对标 mhxyai 摊位截图识别） -->
      <div class="card capture-card">
        <div class="cap-head">
          <h3>📷 框选截图采集</h3>
          <span class="muted">共享游戏窗口 → 拖红框选「收货摊位」 → 截图 → OCR 识别 → 勾选入库</span>
        </div>
        <div class="cap-bar">
          <button class="btn btn-primary" :disabled="sharing" @click="startShare">🔴 开始共享窗口</button>
          <button class="btn" :disabled="!sharing" @click="stopShare">停止共享</button>
          <button class="btn btn-gold" :disabled="!sharing" @click="captureRegionShot">📸 截取选中区域</button>
          <button class="btn btn-primary" :disabled="!capturedImg" @click="submitRecognize">🔍 OCR 识别</button>
        </div>
        <p v-if="ocrMsg" class="ocr-msg">{{ ocrMsg }}</p>

        <div class="cap-body">
          <div class="cap-left">
            <RegionPicker ref="pickerRef" :preview-src="previewSrc" />
          </div>
          <div class="cap-right" v-if="capturedImg">
            <div class="cap-right-title">截取图（将上传识别）</div>
            <img :src="capturedImg" class="cap-shot" alt="截取的摊位区域" />
          </div>
        </div>

        <!-- OCR 候选 → 勾选入库 -->
        <div v-if="drafts.length" class="draft-wrap">
          <div class="draft-head">
            <span>识别候选（逐条确认分类后导入）</span>
            <label class="def-serv">默认服务器
              <input v-model="defaultServer" placeholder="应用到勾选行" />
            </label>
          </div>
          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>✓</th>
                  <th>原文</th>
                  <th>置信度</th>
                  <th>物品名</th>
                  <th>收货价(万)</th>
                  <th>顶级</th>
                  <th>子分类</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in drafts" :key="d.idx">
                  <td><input type="checkbox" v-model="d.checked" /></td>
                  <td class="raw">{{ d.text }}</td>
                  <td class="score">{{ (d.score * 100).toFixed(0) }}%</td>
                  <td><input v-model="d.name" placeholder="物品名" /></td>
                  <td><input v-model="d.price" type="number" step="0.0001" placeholder="价格" /></td>
                  <td>
                    <select v-model="d.parent" @change="onDraftParent(d)">
                      <option value="">-- 顶级 --</option>
                      <option v-for="t in catTree" :key="t.name" :value="t.name">{{ t.name }}</option>
                    </select>
                  </td>
                  <td>
                    <select v-model="d.category" :disabled="!d.parent">
                      <option value="">{{ d.parent ? '-- 子分类 --' : '先选顶级' }}</option>
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
          <input v-model="server" placeholder="服务器（模糊）" @keyup.enter="doQuery()" />
          <input v-model="kw" placeholder="物品名关键字" @keyup.enter="doQuery()" />
          <select v-model="sort" @change="doQuery()">
            <option value="latest">最新采集</option>
            <option value="price_desc">均价降序</option>
            <option value="price_asc">均价升序</option>
            <option value="count">样本数</option>
          </select>
          <button class="btn btn-primary" @click="doQuery()">查询</button>
          <button class="btn" @click="resetFilters()">重置</button>
        </div>
        <p class="count">共 {{ view.length }} 个物品 · {{ items.reduce((s, i) => s + i.count, 0) }} 条样本</p>
      </div>

      <!-- 聚合表 -->
      <div class="card">
        <div class="tbl-wrap">
          <table v-if="view.length">
            <thead>
              <tr>
                <th>图片</th>
                <th>物品名</th>
                <th>分类</th>
                <th>平均收货价</th>
                <th>最低收货价</th>
                <th>最高收货价</th>
                <th>样本数</th>
                <th>最新采集时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in view" :key="it.item_name">
                <td>
                  <img v-if="iconSrc(it)" :src="iconSrc(it)" class="thumb" alt="" @error="(e:any)=>{(e.target as HTMLElement).style.display='none'}" />
                  <span v-else class="no-img">—</span>
                </td>
                <td class="name">{{ it.item_name }}</td>
                <td><span class="cat-tag">{{ it.category }}</span></td>
                <td class="price">{{ fmtPrice(it.avg) }}</td>
                <td>{{ fmtPrice(it.min) }}</td>
                <td>{{ fmtPrice(it.max) }}</td>
                <td class="num">{{ it.count }}</td>
                <td class="time">{{ fmtTime(it.latest) }}</td>
                <td class="ops"><button class="btn-mini btn-del" @click="del(it.item_name)">清样本</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">暂无数据。点上方「＋ 采集一条样本」开始记录收货价。</p>
        </div>
      </div>

      <p v-if="msg" class="msg">{{ msg }}</p>
    </div>
  </div>
</template>

<style scoped>
.harvest-page {
  flex: 1; display: flex; flex-direction: row; gap: 10px; padding: 8px; width: 100%; box-sizing: border-box;
  font-family: var(--font-mono);
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
.form-card { border-color: rgba(255,215,0,0.25); background: linear-gradient(180deg, rgba(255,215,0,0.04), rgba(255,215,0,0.01)); }
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--color-text-muted); }
.form-grid input, .form-grid select {
  padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;
  background: var(--bg-input); color: var(--color-text);
}
.form-grid input:focus, .form-grid select:focus { outline: none; border-color: var(--color-primary); }
.form-ops { margin-top: 10px; display: flex; gap: 8px; }
.filter-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.filter-grid input, .filter-grid select {
  padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;
  background: var(--bg-input); color: var(--color-text);
}
.filter-grid input:focus, .filter-grid select:focus { outline: none; border-color: var(--color-primary); }
.count { font-size: 13px; color: var(--color-text-muted); margin: 10px 0 0; }
.tbl-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--font-mono); }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color); vertical-align: middle; color: var(--color-text); }
th { font-family: var(--font-pixel), var(--font-cn); font-size: 10px; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.4px; }
tr:hover { background: rgba(34,211,238,0.04); }
.thumb { width: 40px; height: 40px; object-fit: contain; border-radius: 6px; border: 1px solid var(--border-color); background: #0c0c10; }
.no-img { color: var(--color-text-muted); }
.name { font-weight: 600; }
.cat-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: rgba(34,211,238,0.1); color: var(--color-primary); border: 1px solid rgba(34,211,238,0.25); }
.price { font-weight: 700; font-size: 15px; color: var(--color-accent); }
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
.ocr-msg { margin-top: 8px; font-size: 12px; color: var(--color-accent); }
.cap-body { display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
.cap-left { flex: 1 1 360px; min-width: 300px; }
.cap-right { flex: 0 0 240px; }
.cap-right-title { font-size: 12px; color: var(--color-text-muted); margin-bottom: 4px; }
.cap-shot { width: 100%; border: 1px solid var(--border-color); border-radius: 6px; background: #000; }
.draft-wrap { margin-top: 12px; border-top: 1px dashed var(--border-color); padding-top: 10px; }
.draft-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; color: var(--color-text-muted); margin-bottom: 8px; flex-wrap: wrap; }
.def-serv { display: flex; gap: 6px; align-items: center; }
.def-serv input { padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 12px; }
.draft-wrap table { font-size: 12px; }
.draft-wrap th, .draft-wrap td { padding: 6px; }
.draft-wrap input, .draft-wrap select { padding: 5px 7px; border: 1px solid var(--border-color); border-radius: 5px; background: var(--bg-input); color: var(--color-text); font-size: 12px; max-width: 140px; }
.draft-wrap input[type=number] { max-width: 90px; }
.draft-wrap .raw { color: var(--color-text-muted); max-width: 160px; word-break: break-all; }
.draft-wrap .score { color: var(--color-accent); white-space: nowrap; }
</style>
