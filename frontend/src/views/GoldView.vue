<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

interface GoldItem {
  server: string
  area: string
  openStatus: string
  timeType: string
  yxbPrice: number | null
  date: string
  ageDays: number | null
  stale: boolean | null
  upDown7: string
  upDown1: string
  ageBucket: string
  src?: string
}

interface GoldResp {
  success: boolean
  message?: string
  updatedAt?: string
  total?: number
  freshCount?: number
  staleCount?: number
  failCount?: number
  servers: GoldItem[]
}

const data = ref<GoldResp | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const sortKey = ref<'price' | 'date' | 'server'>('price')
const sortOrder = ref<'asc' | 'desc'>('desc')
const query = ref('')

// 开服年限分组：1年内 / 1-3年 / 3年外（来自后端 ageBucket 字段）
const ageTabs = [
  { key: 'all', label: '全部', bucket: null as string | null },
  { key: '1y', label: '1年内', bucket: '1y' },
  { key: '1-3y', label: '1-3年', bucket: '1-3y' },
  { key: '3y+', label: '3年外', bucket: '3y+' },
]
const activeTab = ref('all')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const params = new URLSearchParams({ sort: sortKey.value, order: sortOrder.value, q: query.value })
    const res = await fetch(`/api/gold?${params.toString()}`)
    const json = (await res.json()) as GoldResp
    if (!json.success) {
      errorMsg.value = json.message || '加载失败'
    }
    data.value = json
  } catch (e) {
    errorMsg.value = '请求失败: ' + (e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

function setSort(key: 'price' | 'date' | 'server') {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortOrder.value = key === 'server' ? 'asc' : 'desc'
  }
  load()
}

function onSearch() {
  load()
}

const sortIcon = (key: string) =>
  sortKey.value !== key ? '⇅' : sortOrder.value === 'desc' ? '↓' : '↑'

const updownClass = (v: string) => {
  if (!v) return ''
  if (v.startsWith('-')) return 'down'
  if (v.startsWith('+')) return 'up'
  return ''
}

const stats = computed(() => {
  if (!data.value) return null
  return {
    total: data.value.total ?? data.value.servers.length,
    fresh: data.value.freshCount ?? 0,
    stale: data.value.staleCount ?? 0,
  }
})

// 各年限分组的区服数（基于当前搜索结果子集统计）
const tabCounts = computed(() => {
  const c: Record<string, number> = { all: data.value?.servers.length ?? 0, '1y': 0, '1-3y': 0, '3y+': 0 }
  if (data.value) {
    for (const r of data.value.servers) {
      const b = r.ageBucket || ''
      if (b in c) c[b]++
    }
  }
  return c
})

// 当前选中年限分组下的区服列表
const displayServers = computed(() => {
  if (!data.value) return []
  const t = ageTabs.find((x) => x.key === activeTab.value)
  if (!t || t.bucket === null) return data.value.servers
  return data.value.servers.filter((r) => (r.ageBucket || '') === t.bucket)
})

onMounted(load)
</script>

<template>
  <div class="gold-page">
    <header class="page-head">
      <div>
        <h1>💰 全服金价</h1>
      </div>
    </header>

    <div v-if="stats" class="stats">
      <div class="stat"><span class="num">{{ stats.total }}</span><span class="lbl">区服总数</span></div>
      <div class="stat ok"><span class="num">{{ stats.fresh }}</span><span class="lbl">实时行情</span></div>
      <div class="stat warn"><span class="num">{{ stats.stale }}</span><span class="lbl">断更</span></div>
    </div>

    <div class="toolbar">
      <input
        v-model="query"
        class="search"
        type="text"
        placeholder="搜索区服名，如 紫禁城 / 2008"
        @keyup.enter="onSearch"
      />
      <button class="btn-search" @click="onSearch">搜索</button>
      <span class="hint">点表头排序 · 灰色=金价停更(陈货)</span>
    </div>

    <div class="age-tabs">
      <button
        v-for="t in ageTabs"
        :key="t.key"
        class="age-tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}<span class="cnt">{{ tabCounts[t.key] }}</span>
      </button>
    </div>

    <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
    <div v-else-if="loading" class="loading">加载中…</div>

    <div v-else class="table-wrap">
      <table class="gold-table">
        <thead>
          <tr>
            <th class="sortable" @click="setSort('server')">区服 <span class="ic">{{ sortIcon('server') }}</span></th>
            <th>大区</th>
            <th>状态</th>
            <th class="sortable num" @click="setSort('price')">金价(万) <span class="ic">{{ sortIcon('price') }}</span></th>
            <th class="num">7日</th>
            <th class="num">1日</th>
            <th class="sortable num" @click="setSort('date')">行情日期 <span class="ic">{{ sortIcon('date') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in displayServers" :key="r.server" :class="{ stale: r.stale }">
            <td class="name">{{ r.server }}</td>
            <td>{{ r.area }}</td>
            <td><span class="badge">{{ r.openStatus || '—' }}</span></td>
            <td class="num price">
              {{ r.yxbPrice != null ? r.yxbPrice.toFixed(2) : '—' }}
            </td>
            <td class="num" :class="updownClass(r.upDown7)">{{ r.upDown7 || '—' }}</td>
            <td class="num" :class="updownClass(r.upDown1)">{{ r.upDown1 || '—' }}</td>
            <td class="num date">
              {{ r.date || '—' }}
              <em v-if="r.stale" class="tag">断更{{ r.ageDays }}天</em>
            </td>
          </tr>
          <tr v-if="displayServers.length === 0">
            <td colspan="7" class="empty">该年限分组暂无区服</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.gold-page {
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
.page-head h1 {
  margin: 0;
  font-size: 24px;
  color: #ffd866;
}
.stats {
  display: flex;
  gap: 12px;
  margin: 18px 0;
  flex-wrap: wrap;
}
.stat {
  background: #1a1d24;
  border: 1px solid #2a2e38;
  border-radius: 10px;
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  min-width: 96px;
}
.stat .num {
  font-size: 22px;
  font-weight: 700;
  color: #e6e6e6;
}
.stat .lbl {
  font-size: 12px;
  color: #8a93a6;
  margin-top: 2px;
}
.stat.ok .num { color: #4ade80; }
.stat.warn .num { color: #fbbf24; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.age-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.age-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #1a1d24;
  border: 1px solid #2a2e38;
  color: #aab2c2;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all .15s ease;
}
.age-tab:hover { border-color: #f0883e; color: #e6e6e6; }
.age-tab.active {
  background: #2a2014;
  border-color: #f0883e;
  color: #ffd866;
}
.age-tab .cnt {
  font-size: 12px;
  background: #232733;
  border-radius: 10px;
  padding: 1px 7px;
  color: #8a93a6;
}
.age-tab.active .cnt { color: #ffd866; background: #3a2c14; }
.search {
  background: #1a1d24;
  border: 1px solid #2a2e38;
  color: #e6e6e6;
  padding: 9px 12px;
  border-radius: 8px;
  width: 280px;
  font-size: 14px;
  outline: none;
}
.search:focus { border-color: #f0883e; }
.btn-search {
  background: #2a2e38;
  color: #e6e6e6;
  border: 1px solid #3a3f4b;
  padding: 9px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.hint {
  font-size: 12px;
  color: #6b7280;
}
.error {
  color: #f87171;
  background: #2a1416;
  border: 1px solid #5a2a2e;
  padding: 12px 14px;
  border-radius: 8px;
}
.loading {
  color: #8a93a6;
  padding: 30px;
  text-align: center;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid #2a2e38;
  border-radius: 10px;
}
.gold-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 16px;
}
.gold-table thead th {
  background: #1a1d24;
  color: #aab2c2;
  text-align: left;
  padding: 13px 16px;
  font-weight: 600;
  font-size: 15px;
  position: sticky;
  top: 0;
  white-space: nowrap;
}
.gold-table th.num, .gold-table td.num { text-align: right; }
.gold-table th.sortable { cursor: pointer; user-select: none; }
.gold-table th.sortable:hover { color: #ffd866; }
.gold-table .ic { color: #f0883e; font-size: 12px; }

.gold-table tbody td {
  padding: 12px 16px;
  border-top: 1px solid #20242c;
  white-space: nowrap;
}
.gold-table tbody tr:hover { background: #161a21; }
.gold-table .name { font-weight: 600; color: #e6e6e6; }
.gold-table .price { font-weight: 800; color: #ffd866; font-size: 20px; letter-spacing: .3px; }
.gold-table .date { color: #aab2c2; }
.gold-table .badge {
  font-size: 12px;
  background: #232733;
  border: 1px solid #313847;
  padding: 2px 8px;
  border-radius: 6px;
  color: #c2c9d6;
}
.gold-table .up { color: #f87171; }   /* 涨=红(中国习惯) */
.gold-table .down { color: #4ade80; } /* 跌=绿 */
.gold-table tr.stale { background: #181a20; }
.gold-table tr.stale .name { color: #8a93a6; }
.gold-table tr.stale .price { color: #b0894a; }
.gold-table .tag {
  display: inline-block;
  margin-left: 8px;
  font-style: normal;
  font-size: 11px;
  background: #3a2a12;
  color: #fbbf24;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid #5a4420;
}
</style>
