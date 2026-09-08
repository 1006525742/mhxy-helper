<script setup lang="ts">
import { ref, onMounted, computed, onBeforeUnmount } from 'vue'
import { usePriceStore } from '@/stores/priceStore'

const store = usePriceStore()
const props = defineProps<{ showDiscount?: boolean }>()
const showDiscount = computed(() => props.showDiscount !== false)

const wanRMB = computed(() => {
  if (!store.goldPrice || store.goldPrice <= 0) return '—'
  const v = (store.goldPrice / 3000) * store.discount
  return '¥' + v.toFixed(2)
})

function onGold(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  store.setGoldPrice(isFinite(v) ? v : 0)
}
function onDiscount(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  store.setDiscount(isFinite(v) && v > 0 ? v : 1)
}

// ===== 服务器金价搜索（复用 /api/gold，与全服金价页同源）=====
interface GoldItem {
  server: string
  area: string
  yxbPrice: number | null
}
interface GoldResp {
  success: boolean
  servers: GoldItem[]
}
interface MatchItem {
  server: string
  area: string
  yxbPrice: number
}

const kw = ref('')
const matches = ref<MatchItem[]>([])
const searching = ref(false)
const open = ref(false)
const seq = ref(0)
let timer: ReturnType<typeof setTimeout> | null = null

async function doSearch() {
  const q = kw.value.trim()
  if (!q) {
    matches.value = []
    open.value = false
    return
  }
  const my = ++seq.value
  searching.value = true
  try {
    const res = await fetch(`/api/gold?q=${encodeURIComponent(q)}`)
    const json = (await res.json()) as GoldResp
    if (my !== seq.value) return
    if (json.success && json.servers) {
      matches.value = json.servers
        .filter((s) => s.yxbPrice != null)
        .slice(0, 8)
        .map((s) => ({ server: s.server, area: s.area, yxbPrice: s.yxbPrice as number }))
      open.value = matches.value.length > 0
    } else {
      matches.value = []
      open.value = false
    }
  } catch {
    if (my === seq.value) {
      matches.value = []
      open.value = false
    }
  } finally {
    if (my === seq.value) searching.value = false
  }
}

function onKwInputRaw(e: Event) {
  kw.value = (e.target as HTMLInputElement).value
  if (timer) clearTimeout(timer)
  timer = setTimeout(doSearch, 300)
}

function pick(s: MatchItem) {
  store.setGoldFromServer(s.server, s.yxbPrice)
  kw.value = s.server
  open.value = false
}

function clearServer() {
  store.clearServer()
  kw.value = ''
}

function onBlur() {
  // 延迟关闭，保证点击下拉项先触发（mousedown.prevent）
  setTimeout(() => {
    open.value = false
  }, 150)
}

// 挂载时：若曾选过服务器，自动拉取最新金价回填（离线则回退缓存值）
onMounted(async () => {
  if (!store.serverName) return
  kw.value = store.serverName
  try {
    const res = await fetch(`/api/gold?q=${encodeURIComponent(store.serverName)}`)
    const json = (await res.json()) as GoldResp
    if (json.success && json.servers) {
      const hit = json.servers.find(
        (s) => s.server === store.serverName && s.yxbPrice != null,
      )
      if (hit) {
        store.setGoldFromServer(hit.server, hit.yxbPrice as number)
        return
      }
    }
    // 没匹配到：回退缓存值
    if (store.serverGoldPrice != null) store.setGoldPrice(store.serverGoldPrice)
  } catch {
    // 离线：回退缓存值
    if (store.serverGoldPrice != null) store.setGoldPrice(store.serverGoldPrice)
  }
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="price-bar card">
    <div class="pb-title">💰 {{ showDiscount ? '金价 / 折扣' : '金价' }}</div>
    <div class="pb-grid">
      <label class="pb-field">
        <span>金价（元 / 3000万）</span>
        <input type="number" :value="store.goldPrice" @input="onGold" min="0" step="1" />
      </label>
      <label class="pb-field" v-if="showDiscount">
        <span>折扣系数</span>
        <input type="number" :value="store.discount" @input="onDiscount" min="0.1" max="1" step="0.01" />
        <small>1=原价，0.9=9折</small>
      </label>
    </div>

    <!-- 服务器金价搜索：选服即填金价，与手动填等价 -->
    <div class="pb-server">
      <div class="pb-server-row">
        <div class="pb-search">
          <input
            :value="kw"
            type="text"
            class="pb-search-input"
            placeholder="搜索服务器自动填金价（如 紫禁城 / 2008）"
            @input="onKwInputRaw"
            @focus="onKwInputRaw"
            @blur="onBlur"
          />
          <span v-if="searching" class="pb-searching">搜索中…</span>
          <ul v-if="open && matches.length" class="pb-dropdown">
            <li v-for="s in matches" :key="s.server" @mousedown.prevent="pick(s)">
              <span class="pb-drop-name">{{ s.server }}</span>
              <span class="pb-drop-area">{{ s.area }}</span>
              <span class="pb-drop-price">{{ s.yxbPrice.toFixed(2) }}</span>
            </li>
          </ul>
        </div>
        <button v-if="store.serverName" class="pb-clear" @click="clearServer" title="清除服务器选择">×</button>
      </div>
      <div class="pb-server-line" v-if="store.serverName">
        当前服务器：<b>{{ store.serverName }}</b>
        <span class="pb-server-hint">（下次自动用该服金价）</span>
      </div>
      <div class="pb-server-line" v-else>
        <span class="pb-server-hint">也可手动填上方金价框</span>
      </div>
    </div>

    <div class="pb-line">1万梦幻币 ≈ <b>{{ wanRMB }}</b>（本地保存，刷新不丢）</div>
  </div>
</template>

<style scoped>
.price-bar {
  background: var(--bg-panel);
}
.pb-title {
  color: var(--color-secondary);
  font-size: 14px;
  margin-bottom: 10px;
}
.pb-grid {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.pb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.pb-field input {
  width: 160px;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.pb-field small {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* 服务器金价搜索 */
.pb-server {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-color);
}
.pb-server-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.pb-search {
  position: relative;
  flex: 1;
}
.pb-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 13px;
}
.pb-search-input:focus {
  outline: none;
  border-color: var(--color-warning);
}
.pb-searching {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--color-text-muted);
}
.pb-dropdown {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  max-height: 260px;
  overflow-y: auto;
}
.pb-dropdown li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
}
.pb-dropdown li:hover {
  background: var(--bg-input);
}
.pb-drop-name {
  font-weight: 600;
  min-width: 70px;
}
.pb-drop-area {
  flex: 1;
  color: var(--color-text-muted);
  font-size: 12px;
}
.pb-drop-price {
  color: var(--color-warning);
  font-weight: 700;
  font-family: var(--font-mono, monospace);
}
.pb-clear {
  flex: none;
  width: 34px;
  height: 34px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.pb-clear:hover {
  color: var(--color-warning);
  border-color: var(--color-warning);
}
.pb-server-line {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.pb-server-line b {
  color: var(--color-text);
}
.pb-server-hint {
  color: var(--color-text-muted);
  opacity: 0.8;
}

.pb-line {
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-text-muted);
}
.pb-line b {
  color: var(--color-warning);
}
</style>
