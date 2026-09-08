<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  fetchAssets, fetchSummary, fetchTypes,
  createAsset, updateAsset, splitSell,
  softDelete, restoreAsset, purgeAsset, exportCsv, ocrParse,
  type AssetItem,
} from '@/services/assetApi'

// ---------- 列表状态 ----------
const items = ref<AssetItem[]>([])
const total = ref(0)
const loading = ref(false)
const errorMsg = ref('')

const tab = ref<'in_stock' | 'sold' | 'trash'>('in_stock')
const kw = ref('')
const filterType = ref('')
const filterServer = ref('')
const sortKey = ref('created_desc')
const page = ref(1)
const pageSize = ref(20)

const types = ref<string[]>([])
const holdWarnDays = ref(30)

const summary = reactive({
  stock_count: 0, stock_qty: 0, stock_cost: 0,
  sold_count: 0, sold_profit: 0,
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await fetchAssets({
      status: tab.value,
      kw: kw.value.trim(),
      item_type: filterType.value,
      server: filterServer.value.trim(),
      sort: sortKey.value,
      page: page.value,
      page_size: pageSize.value,
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadSummary() {
  try {
    const s = await fetchSummary()
    Object.assign(summary, s)
  } catch {
    /* 汇总失败不影响主流程 */
  }
}

function refreshAll() {
  load()
  loadSummary()
}

onMounted(async () => {
  try {
    const t = await fetchTypes()
    types.value = t.types
    holdWarnDays.value = t.hold_warn_days
  } catch { /* 忽略 */ }
  refreshAll()
})

watch([tab, filterType, sortKey, page, pageSize], () => load())
watch(tab, () => { page.value = 1 })

// ---------- 截图识别（OCR + 规则回填）----------
const fileInput = ref<HTMLInputElement | null>(null)
const ocrLoading = ref(false)
const ocrText = ref('')
const ocrError = ref('')

async function doOcr(file: File) {
  ocrLoading.value = true
  ocrError.value = ''
  try {
    const r = await ocrParse(file)
    if (r.item_type) form.item_type = r.item_type
    if (r.name) form.name = r.name
    if (r.attributes) form.attributes = r.attributes
    ocrText.value = r.raw_text || '（未识别到文字）'
  } catch (e) {
    ocrError.value = e instanceof Error ? e.message : String(e)
    ocrText.value = ''
  } finally {
    ocrLoading.value = false
  }
}

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) doOcr(f)
}

async function onPaste(e: ClipboardEvent) {
  if (!showModal.value) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const blob = it.getAsFile()
      if (blob) { e.preventDefault(); doOcr(blob as File); break }
    }
  }
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onKeyEsc)
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('keydown', onKeyEsc)
})

// 主动发起框选截图：先截全屏，再在前端拖拽框选区域
const cropperImg = ref('')
const cropping = ref(false)
const cropStart = reactive({ x: 0, y: 0 })
const cropEnd = reactive({ x: 0, y: 0 })
const cropDrag = ref(false)
let rawImgW = 1
let dispScale = 1

async function startRegionCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    ocrError.value = '当前浏览器不支持屏幕捕获，请改用选图或粘贴截图'
    return
  }
  ocrLoading.value = true
  ocrError.value = ''
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    await new Promise((r) => setTimeout(r, 200))
    const full = document.createElement('canvas')
    full.width = video.videoWidth
    full.height = video.videoHeight
    full.getContext('2d')!.drawImage(video, 0, 0)
    stream.getTracks().forEach((t) => t.stop())
    cropperImg.value = full.toDataURL('image/png')
    cropping.value = true
    ocrLoading.value = false
  } catch (e: unknown) {
    ocrLoading.value = false
    const name = (e as { name?: string })?.name
    ocrError.value = name === 'NotAllowedError' || name === 'AbortError' ? '已取消截屏' : (e instanceof Error ? e.message : String(e))
    ocrText.value = ''
  }
}

function onCropperImgLoad(e: Event) {
  const t = e.target as HTMLImageElement
  rawImgW = t.naturalWidth
}

function onCropperDown(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dispScale = rawImgW / r.width
  cropStart.x = e.clientX - r.left
  cropStart.y = e.clientY - r.top
  cropEnd.x = cropStart.x
  cropEnd.y = cropStart.y
  cropDrag.value = true
}

function onCropperMove(e: MouseEvent) {
  if (!cropDrag.value) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  cropEnd.x = Math.max(0, Math.min(e.clientX - r.left, r.width))
  cropEnd.y = Math.max(0, Math.min(e.clientY - r.top, r.height))
}

function onCropperUp() {
  cropDrag.value = false
}

function confirmCrop() {
  const x = Math.min(cropStart.x, cropEnd.x) * dispScale
  const y = Math.min(cropStart.y, cropEnd.y) * dispScale
  const w = Math.abs(cropEnd.x - cropStart.x) * dispScale
  const h = Math.abs(cropEnd.y - cropStart.y) * dispScale
  if (w < 8 || h < 8) {
    ocrError.value = '框选区域太小，请重新框选'
    return
  }
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w)
    canvas.height = Math.round(h)
    canvas.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, Math.round(w), Math.round(h))
    canvas.toBlob((b) => {
      if (b) doOcr(b as File)
      cropping.value = false
      cropperImg.value = ''
    }, 'image/png')
  }
  img.src = cropperImg.value
}

function cancelCrop() {
  cropping.value = false
  cropperImg.value = ''
}

function onKeyEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && cropping.value) cancelCrop()
}

function resetFilter() {
  kw.value = ''
  filterType.value = ''
  filterServer.value = ''
  sortKey.value = 'created_desc'
  page.value = 1
  load()
}

function setSort(key: string) {
  sortKey.value = key
  page.value = 1
}

// ---------- 弹窗 ----------
const showModal = ref(false)
const mode = ref<'create' | 'edit' | 'sell'>('create')
const editingId = ref<number | null>(null)

const form = reactive({
  code: '', item_type: '', server: '', name: '',
  attributes: '', related_role: '',
  qty: 1, buy_price: null as number | null, buy_date: todayStr(),
  sell_price: null as number | null, sell_date: todayStr(),
  fee: 0, note: '', listing_reminder_at: '',
  batch_save_count: 1,
})
// 部分售出专用
const sellQty = ref(1)
const partialSell = ref(false)

function todayStr() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function openCreate() {
  mode.value = 'create'
  editingId.value = null
  partialSell.value = false
  Object.assign(form, {
    code: '', item_type: types.value[0] || '', server: '', name: '',
    attributes: '', related_role: '',
    qty: 1, buy_price: null, buy_date: todayStr(),
    sell_price: null, sell_date: todayStr(),
    fee: 0, note: '', listing_reminder_at: '',
    batch_save_count: 1,
  })
  showModal.value = true
}

function openEdit(row: AssetItem) {
  mode.value = 'edit'
  editingId.value = row.id
  partialSell.value = false
  Object.assign(form, {
    code: row.code || '', item_type: row.item_type || '', server: row.server || '',
    name: row.name || '', attributes: row.attributes || '', related_role: row.related_role || '',
    qty: row.qty || 1, buy_price: row.buy_price, buy_date: row.buy_date || todayStr(),
    sell_price: row.sell_price, sell_date: row.sell_date || todayStr(),
    fee: row.fee || 0, note: row.note || '', listing_reminder_at: row.listing_reminder_at || '',
    batch_save_count: 1,
  })
  showModal.value = true
}

function openSell(row: AssetItem) {
  mode.value = 'sell'
  editingId.value = row.id
  partialSell.value = false
  sellQty.value = row.qty || 1
  Object.assign(form, {
    sell_price: row.sell_price, sell_date: row.sell_date || todayStr(),
    fee: row.fee || 0, qty: row.qty || 1,
  })
  showModal.value = true
}

async function submit() {
  if (!form.name.trim() && mode.value !== 'sell') {
    alert('物品名称不能为空')
    return
  }
  try {
    if (mode.value === 'create') {
      await createAsset({ ...form })
    } else if (mode.value === 'edit') {
      await updateAsset(editingId.value!, { ...form })
    } else if (mode.value === 'sell') {
      if (partialSell.value && sellQty.value < (form.qty || 1)) {
        await splitSell(editingId.value!, {
          qty: sellQty.value,
          sell_price: form.sell_price ?? undefined,
          sell_date: form.sell_date,
          fee: form.fee || 0,
        })
      } else {
        await updateAsset(editingId.value!, {
          sell_price: form.sell_price,
          sell_date: form.sell_date,
          fee: form.fee || 0,
        })
      }
    }
    showModal.value = false
    refreshAll()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

// ---------- 操作 ----------
async function onDelete(row: AssetItem) {
  if (!confirm(`确认将「${row.name}」移入回收站？`)) return
  await softDelete(row.id)
  refreshAll()
}

async function onRestore(row: AssetItem) {
  await restoreAsset(row.id)
  refreshAll()
}

async function onPurge(row: AssetItem) {
  if (!confirm(`彻底删除「${row.name}」？此操作不可恢复。`)) return
  await purgeAsset(row.id)
  refreshAll()
}

// ---------- 展示辅助 ----------
function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function fmtRate(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return (v * 100).toFixed(2) + '%'
}

function profitClass(v: number | null | undefined) {
  if (v === null || v === undefined) return ''
  if (v > 0) return 'pos'
  if (v < 0) return 'neg'
  return 'zero'
}

</script>

<template>
  <div class="asset-page">
    <div class="page-head">
      <div>
        <h1>资产登记</h1>
        <p class="sub">金额单位：万（梦幻币）· 压货超 {{ holdWarnDays }} 天标橙</p>
      </div>
      <div class="head-actions">
        <button class="btn ghost" @click="exportCsv(tab)">导出 CSV</button>
        <button class="btn primary" @click="openCreate">+ 新增物品</button>
      </div>
    </div>

    <!-- 一行汇总 -->
    <div class="summary-bar">
      <div class="sum-item">
        <span class="sum-num">{{ summary.stock_qty }}</span>
        <span class="sum-lbl">在库件数（{{ summary.stock_count }} 条）</span>
      </div>
      <div class="sum-sep"></div>
      <div class="sum-item">
        <span class="sum-num">{{ fmtMoney(summary.stock_cost) }}</span>
        <span class="sum-lbl">成本合计（万）</span>
      </div>
      <div class="sum-sep"></div>
      <div class="sum-item">
        <span class="sum-num" :class="profitClass(summary.sold_profit)">{{ fmtMoney(summary.sold_profit) }}</span>
        <span class="sum-lbl">已售利润（万）</span>
      </div>
    </div>

    <!-- 标签页 -->
    <div class="tabs">
      <button
        v-for="t in [{k:'in_stock',l:'未售'},{k:'sold',l:'已售'},{k:'trash',l:'回收站'}]"
        :key="t.k"
        class="tab"
        :class="{ active: tab === t.k }"
        @click="tab = t.k as any"
      >{{ t.l }}</button>
    </div>

    <!-- 筛选 -->
    <div class="toolbar">
      <input v-model="kw" class="search" placeholder="搜索名称 / 属性 / 代号 / 备注" @keyup.enter="load()" />
      <select v-model="filterType" class="sel">
        <option value="">全部类型</option>
        <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
      </select>
      <input v-model="filterServer" class="search short" placeholder="区服" @keyup.enter="load()" />
      <button class="btn ghost" @click="load()">筛选</button>
      <button class="btn ghost" @click="resetFilter">重置</button>
      <span class="hint">共 {{ total }} 条</span>
    </div>

    <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
    <div v-else-if="loading" class="loading">加载中…</div>
    <div v-else-if="!items.length" class="empty">当前没有符合条件的记录</div>

    <!-- 表格 -->
    <div v-else class="table-wrap">
      <table class="asset-table">
        <thead>
          <!-- 未售 -->
          <tr v-if="tab === 'in_stock'">
            <th>代号</th><th>类型</th><th>区服</th><th>物品名称</th><th>物品属性</th>
            <th class="num" @click="setSort('price_desc')">买入价</th>
            <th @click="setSort('buy_date_desc')">买入日期</th>
            <th class="num" @click="setSort('hold_desc')">压货</th>
            <th>对应角色</th><th>备注</th><th>上架提醒</th><th class="op">操作</th>
          </tr>
          <!-- 已售 -->
          <tr v-else-if="tab === 'sold'">
            <th>代号</th><th>类型</th><th>区服</th><th>物品名称</th><th>物品属性</th>
            <th class="num">买入价</th><th class="num">卖出价</th><th class="num">费用</th>
            <th>买入日期</th><th>卖出日期</th><th class="num">压货</th>
            <th class="num" @click="setSort('profit_desc')">利润</th><th class="num">利润率</th>
            <th>备注</th><th class="op">操作</th>
          </tr>
          <!-- 回收站 -->
          <tr v-else>
            <th>代号</th><th>类型</th><th>区服</th><th>物品名称</th><th>买入价</th>
            <th>删除时间</th><th class="op">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id">
            <template v-if="tab === 'in_stock'">
              <td>{{ row.code || '—' }}</td>
              <td>{{ row.item_type || '—' }}</td>
              <td>{{ row.server || '—' }}</td>
              <td class="name">{{ row.name }}</td>
              <td class="attr">{{ row.attributes || '—' }}</td>
              <td class="num">{{ fmtMoney(row.buy_price) }}</td>
              <td>{{ row.buy_date || '—' }}</td>
              <td class="num" :class="{ warn: row.hold_warning }">
                {{ row.hold_days === null ? '—' : row.hold_days + ' 天' }}
              </td>
              <td>{{ row.related_role || '—' }}</td>
              <td class="attr">{{ row.note || '—' }}</td>
              <td>{{ row.listing_reminder_at || '—' }}</td>
              <td class="op">
                <button class="link" @click="openSell(row)">售出</button>
                <button class="link" @click="openEdit(row)">编辑</button>
                <button class="link danger" @click="onDelete(row)">删除</button>
              </td>
            </template>

            <template v-else-if="tab === 'sold'">
              <td>{{ row.code || '—' }}</td>
              <td>{{ row.item_type || '—' }}</td>
              <td>{{ row.server || '—' }}</td>
              <td class="name">{{ row.name }}</td>
              <td class="attr">{{ row.attributes || '—' }}</td>
              <td class="num">{{ fmtMoney(row.buy_price) }}</td>
              <td class="num">{{ fmtMoney(row.sell_price) }}</td>
              <td class="num">{{ fmtMoney(row.fee) }}</td>
              <td>{{ row.buy_date || '—' }}</td>
              <td>{{ row.sell_date || '—' }}</td>
              <td class="num">{{ row.hold_days === null ? '—' : row.hold_days + ' 天' }}</td>
              <td class="num" :class="profitClass(row.profit)">{{ fmtMoney(row.profit) }}</td>
              <td class="num" :class="profitClass(row.profit)">{{ fmtRate(row.profit_rate) }}</td>
              <td class="attr">{{ row.note || '—' }}</td>
              <td class="op">
                <button class="link" @click="openEdit(row)">编辑</button>
                <button class="link danger" @click="onDelete(row)">删除</button>
              </td>
            </template>

            <template v-else>
              <td>{{ row.code || '—' }}</td>
              <td>{{ row.item_type || '—' }}</td>
              <td>{{ row.server || '—' }}</td>
              <td class="name">{{ row.name }}</td>
              <td class="num">{{ fmtMoney(row.buy_price) }}</td>
              <td>{{ row.deleted_at || '—' }}</td>
              <td class="op">
                <button class="link" @click="onRestore(row)">还原</button>
                <button class="link danger" @click="onPurge(row)">彻底删除</button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="pager">
      <button class="btn ghost" :disabled="page <= 1" @click="page--">上一页</button>
      <span class="page-info">{{ page }} / {{ totalPages }}</span>
      <button class="btn ghost" :disabled="page >= totalPages" @click="page++">下一页</button>
      <select v-model.number="pageSize" class="sel small">
        <option :value="20">20 条/页</option>
        <option :value="50">50 条/页</option>
        <option :value="100">100 条/页</option>
      </select>
    </div>

    <!-- 弹窗 -->
    <div v-if="showModal" class="mask" @click.self="showModal = false">
      <div class="modal">
        <h2>{{ mode === 'create' ? '新增物品' : mode === 'edit' ? '编辑物品' : '记录售出' }}</h2>

        <!-- 售出模式 -->
        <template v-if="mode === 'sell'">
          <div class="grid">
            <label class="field">
              <span>卖出价（万）</span>
              <input v-model.number="form.sell_price" type="number" placeholder="1500" />
            </label>
            <label class="field">
              <span>卖出日期</span>
              <input v-model="form.sell_date" type="date" />
            </label>
            <label class="field">
              <span>费用（万）</span>
              <input v-model.number="form.fee" type="number" placeholder="手续费金额，不是费率" />
            </label>
          </div>
          <label class="check">
            <input v-model="partialSell" type="checkbox" />
            <span>部分售出</span>
          </label>
          <label v-if="partialSell" class="field narrow">
            <span>售出数量（当前共 {{ form.qty }} 件）</span>
            <input v-model.number="sellQty" type="number" min="1" :max="form.qty" />
          </label>
          <p class="tip">部分售出会把这条拆成「已售 N 件」+「在库 M 件」两条记录。</p>
        </template>

        <!-- 新增 / 编辑模式 -->
        <template v-else>
          <!-- 截图识别 -->
          <div class="ocr-bar">
            <button type="button" class="btn ghost" @click="fileInput?.click()" :disabled="ocrLoading">
              {{ ocrLoading ? '识别中…' : '📷 选图' }}
            </button>
            <button type="button" class="btn ghost" @click="startRegionCapture" :disabled="ocrLoading">
              🖥️ 框选截图
            </button>
            <span class="hint">选图 / 截屏 / 或在表单任意处 Ctrl·Cmd+V 粘贴，自动识别类型·名称·属性</span>
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFileChange" />
          </div>
          <div v-if="ocrError" class="error small">{{ ocrError }}</div>
          <div v-if="ocrText" class="ocr-raw">
            <span class="ocr-raw-label">识别原文（请核对）：</span>{{ ocrText }}
          </div>
          <div class="grid">
            <label class="field narrow">
              <span>代号</span>
              <input v-model="form.code" placeholder="可选" />
            </label>
            <label class="field narrow">
              <span>类型</span>
              <select v-model="form.item_type">
                <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>
            <label class="field narrow">
              <span>区服</span>
              <input v-model="form.server" placeholder="紫禁城" />
            </label>
            <label class="field">
              <span>物品名称 *</span>
              <input v-model="form.name" placeholder="例如 13黑宝、150鞋书、高必" />
            </label>
            <label class="field">
              <span>对应角色</span>
              <input v-model="form.related_role" placeholder="可选" />
            </label>
            <label class="field narrow">
              <span>数量</span>
              <input v-model.number="form.qty" type="number" min="1" />
            </label>
            <label class="field narrow">
              <span>买入价（万）</span>
              <input v-model.number="form.buy_price" type="number" placeholder="可留空，后期补录" />
            </label>
            <label class="field narrow">
              <span>买入日期</span>
              <input v-model="form.buy_date" type="date" />
            </label>
            <label class="field narrow">
              <span>费用（万）</span>
              <input v-model.number="form.fee" type="number" />
            </label>
            <label class="field wide">
              <span>物品属性</span>
              <textarea v-model="form.attributes" rows="2" placeholder="例如：577伤害、525命中、22体质、凝气决"></textarea>
            </label>
            <label class="field wide">
              <span>备注</span>
              <textarea v-model="form.note" rows="2" placeholder="卖家、价格判断、出售计划"></textarea>
            </label>
            <label class="field">
              <span>上架提醒</span>
              <input v-model="form.listing_reminder_at" type="datetime-local" />
            </label>
            <label v-if="mode === 'create'" class="field narrow">
              <span>连续录入条数</span>
              <input v-model.number="form.batch_save_count" type="number" min="1" max="50" />
            </label>
          </div>
          <template v-if="mode === 'edit'">
            <div class="divider">售出信息（填了卖出价即自动标记为已售）</div>
            <div class="grid">
              <label class="field narrow">
                <span>卖出价（万）</span>
                <input v-model.number="form.sell_price" type="number" />
              </label>
              <label class="field narrow">
                <span>卖出日期</span>
                <input v-model="form.sell_date" type="date" />
              </label>
            </div>
          </template>
        </template>

        <div class="modal-actions">
          <button class="btn ghost" @click="showModal = false">取消</button>
          <button class="btn primary" @click="submit">保存</button>
        </div>
      </div>
    </div>

  <!-- 框选截图浮层 -->
  <div v-if="cropping" class="cropper-overlay">
    <div class="cropper-stage" @mousedown="onCropperDown" @mousemove="onCropperMove" @mouseup="onCropperUp" @dblclick="confirmCrop">
      <img :src="cropperImg" draggable="false" alt="截图" @load="onCropperImgLoad" />
      <div class="crop-box"
           :style="{ left: Math.min(cropStart.x, cropEnd.x) + 'px', top: Math.min(cropStart.y, cropEnd.y) + 'px', width: Math.abs(cropEnd.x - cropStart.x) + 'px', height: Math.abs(cropEnd.y - cropStart.y) + 'px' }"></div>
    </div>
    <div class="cropper-tip">拖拽框选要识别的区域 · 双击确认 · 按 Esc 取消</div>
  </div>
  </div>
</template>

<style scoped>
.asset-page {
  padding: 20px 24px;
  color: #e6e6e6;
  min-height: 100%;
  background: #0f1115;
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}
.page-head h1 { margin: 0; font-size: 24px; color: #ffd866; }
.sub { margin: 6px 0 0; font-size: 12px; color: #8a93a6; }
.head-actions { display: flex; gap: 10px; }

.ocr-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.ocr-raw {
  margin-bottom: 12px; padding: 8px 12px; background: #14171d;
  border: 1px solid #2a2e38; border-radius: 8px;
  font-size: 12px; color: #9aa3b5; white-space: pre-wrap; word-break: break-all;
}
.ocr-raw-label { color: #6b7385; margin-right: 4px; }
.cropper-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.75);
  display: flex; align-items: center; justify-content: center;
}
.cropper-stage {
  position: relative; max-width: 92vw; max-height: 84vh;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  cursor: crosshair; user-select: none;
}
.cropper-stage img { display: block; max-width: 92vw; max-height: 84vh; }
.crop-box {
  position: absolute; border: 2px dashed #ffd866;
  background: rgba(255, 216, 102, 0.12);
  pointer-events: none;
}
.cropper-tip {
  position: fixed; bottom: 28px; left: 0; right: 0;
  text-align: center; color: #cdd3e0; font-size: 13px;
  letter-spacing: 0.5px;
}
.error.small { font-size: 12px; margin: 4px 0 10px; }

.summary-bar {
  display: flex;
  align-items: center;
  gap: 22px;
  margin: 18px 0 14px;
  padding: 14px 20px;
  background: #1a1d24;
  border: 1px solid #2a2e38;
  border-radius: 10px;
  flex-wrap: wrap;
}
.sum-item { display: flex; flex-direction: column; }
.sum-num { font-size: 20px; font-weight: 700; color: #e6e6e6; }
.sum-lbl { font-size: 12px; color: #8a93a6; margin-top: 2px; }
.sum-sep { width: 1px; height: 30px; background: #2a2e38; }
.pos { color: #4ade80; }
.neg { color: #f87171; }
.zero { color: #8a93a6; }

.tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.tab {
  background: #1a1d24;
  border: 1px solid #2a2e38;
  color: #aab2c2;
  padding: 7px 18px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.tab:hover { border-color: #f0883e; color: #e6e6e6; }
.tab.active { background: #2a2014; border-color: #f0883e; color: #ffd866; }

.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.search, .sel, .field input, .field select, .field textarea {
  background: #1a1d24;
  border: 1px solid #2a2e38;
  color: #e6e6e6;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
}
.search { width: 260px; }
.search.short { width: 140px; }
.sel.small { padding: 6px 10px; }
.search:focus, .sel:focus, .field input:focus, .field select:focus, .field textarea:focus {
  border-color: #f0883e;
}
.hint { font-size: 12px; color: #6b7280; }

.btn {
  padding: 9px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  border: 1px solid #3a3f4b;
}
.btn.ghost { background: #2a2e38; color: #e6e6e6; }
.btn.ghost:hover { border-color: #f0883e; }
.btn.primary { background: #f0883e; border-color: #f0883e; color: #1a1206; font-weight: 600; }
.btn:disabled { opacity: .45; cursor: not-allowed; }

.error {
  color: #f87171; background: #2a1416;
  border: 1px solid #5a2a2e;
  padding: 12px 14px; border-radius: 8px;
}
.loading { color: #8a93a6; padding: 30px; text-align: center; }
.empty {
  color: #8a93a6; padding: 40px; text-align: center;
  background: #1a1d24; border: 1px dashed #2a2e38; border-radius: 10px;
}

.table-wrap { overflow-x: auto; border: 1px solid #2a2e38; border-radius: 10px; }
.asset-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.asset-table thead th {
  background: #1a1d24; color: #aab2c2; text-align: left;
  padding: 12px 14px; font-weight: 600; white-space: nowrap;
  border-bottom: 1px solid #2a2e38;
}
.asset-table thead th.num { text-align: right; }
.asset-table thead th.op { text-align: right; }
.asset-table tbody td { padding: 11px 14px; border-bottom: 1px solid #23262e; }
.asset-table tbody tr:hover { background: #16191f; }
.asset-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.asset-table .op { text-align: right; white-space: nowrap; }
.name { color: #e6e6e6; font-weight: 600; }
.attr { color: #8a93a6; max-width: 220px; }
.warn { color: #fbbf24; font-weight: 700; }

.link {
  background: none; border: none; color: #aab2c2;
  cursor: pointer; padding: 2px 6px; font-size: 13px;
}
.link:hover { color: #ffd866; }
.link.danger:hover { color: #f87171; }

.pager { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.page-info { color: #8a93a6; font-size: 13px; }

.mask {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.6);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 40px 20px;
  overflow-y: auto;
}
.modal {
  background: #1a1d24; border: 1px solid #2a2e38;
  border-radius: 12px; padding: 22px 24px;
  width: min(680px, 100%);
}
.modal h2 { margin: 0 0 16px; font-size: 18px; color: #ffd866; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field.wide { grid-column: 1 / -1; }
.field span { font-size: 12px; color: #8a93a6; }
.check { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; }
.field.narrow { margin-top: 12px; }
.tip { font-size: 12px; color: #6b7280; margin: 10px 0 0; }
.divider {
  margin: 20px 0 12px; padding-top: 14px;
  border-top: 1px solid #2a2e38; color: #8a93a6; font-size: 13px;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
</style>
