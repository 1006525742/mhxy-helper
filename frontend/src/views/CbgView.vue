<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { cbgApi, getCbgCookie, setCbgCookie } from '@/services/cbgApi'

interface WatchItem {
  ordersn: string
  server_name?: string
  equip_name?: string
  target_price?: number
  note?: string
  created_at?: number
}
interface Point {
  current_price: number | null
  same_type_lowest: number | null
  status: string | null
  ts: number
}
interface Deal {
  deal_ts: number
  deal_price: number
}

const cookie = ref(getCbgCookie())
const watches = ref<WatchItem[]>([])
const form = ref({ ordersn: '', server_name: '', equip_name: '', target_price: '', note: '' })
const selected = ref<string>('')
const historyPoints = ref<Point[]>([])
const deals = ref<Deal[]>([])
const msg = ref('')

function saveCookie() {
  setCbgCookie(cookie.value.trim())
  msg.value = '已保存你的藏宝阁 cookie（仅存于本机浏览器，后端不接收）'
}

async function loadList() {
  const r = await cbgApi.listWatch()
  watches.value = r.items || []
}

async function addWatch() {
  if (!form.value.ordersn) {
    msg.value = '请填写 ordersn（商品单号）'
    return
  }
  await cbgApi.addWatch({
    ordersn: form.value.ordersn,
    server_name: form.value.server_name || undefined,
    equip_name: form.value.equip_name || undefined,
    target_price: form.value.target_price ? Number(form.value.target_price) : undefined,
    note: form.value.note || undefined,
  })
  form.value = { ordersn: '', server_name: '', equip_name: '', target_price: '', note: '' }
  await loadList()
  msg.value = '已添加订阅'
}

async function delWatch(o: string) {
  await cbgApi.delWatch(o)
  await loadList()
  if (selected.value === o) selected.value = ''
}

async function selectWatch(o: string) {
  selected.value = o
  const h = await cbgApi.history(o)
  historyPoints.value = h.points || []
  const d = await cbgApi.deals(o)
  deals.value = d.deals || []
}

// 抓取接入点（方案 B 前端负责）：在用户浏览器内用其 cookie 调用藏宝阁接口
// （官方前端会自动带 check_sign_code 签名），解析后调用 cbgApi.addSnapshot / addDeals 上报。
// 参考实现示例：
// async function fetchAndRecord(o: string) {
//   const data = await fetchCbgEquip(o, getCbgCookie()) // 用户浏览器内 fetch，详见抓取对接说明
//   await cbgApi.addSnapshot({ ordersn: o, current_price: data.price, same_type_lowest: data.lowest, status: data.status })
//   if (data.deals) await cbgApi.addDeals(o, data.deals)
//   await selectWatch(o)
// }

const linePoints = computed(() => {
  const pts = historyPoints.value
  if (pts.length === 0) return ''
  const prices = pts.map((p) => p.current_price ?? 0).filter((x) => x > 0)
  const max = Math.max(...prices, 1)
  const n = pts.length
  return pts
    .map((p, i) => {
      const x = n === 1 ? 150 : (i / (n - 1)) * 290 + 5
      const y = 110 - ((p.current_price ?? 0) / max) * 100
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

onMounted(loadList)
</script>

<template>
  <div class="cbg-page">
    <div class="card">
      <h2>藏宝阁 · 装备价格监控</h2>
      <p class="muted">
        安全说明：你的藏宝阁 cookie 仅保存在本机浏览器 localStorage，后端绝不存储；所有数据按你的用户标识隔离。
      </p>
      <div class="cookie-row">
        <input v-model="cookie" placeholder="粘贴你的藏宝阁 cookie（前端在浏览器内查询用）" />
        <button class="btn" @click="saveCookie">保存 cookie</button>
      </div>
      <p class="msg">{{ msg }}</p>
    </div>

    <div class="card">
      <h3>添加订阅（具体某件装备）</h3>
      <div class="form-grid">
        <input v-model="form.ordersn" placeholder="ordersn（商品单号，必填）" />
        <input v-model="form.server_name" placeholder="服务器名" />
        <input v-model="form.equip_name" placeholder="装备名" />
        <input v-model="form.target_price" placeholder="关注价（可选）" type="number" />
        <input v-model="form.note" placeholder="备注（可选）" />
        <button class="btn btn-primary" @click="addWatch">添加订阅</button>
      </div>
    </div>

    <div class="card">
      <h3>订阅清单</h3>
      <table v-if="watches.length">
        <thead>
          <tr><th>装备</th><th>服务器</th><th>关注价</th><th>备注</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="w in watches"
            :key="w.ordersn"
            :class="{ active: w.ordersn === selected }"
          >
            <td>
              <a href="#" @click.prevent="selectWatch(w.ordersn)">{{ w.equip_name || w.ordersn }}</a>
            </td>
            <td>{{ w.server_name }}</td>
            <td>{{ w.target_price ?? '-' }}</td>
            <td>{{ w.note }}</td>
            <td><button class="btn-mini" @click="delWatch(w.ordersn)">取消</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无订阅</p>
    </div>

    <div class="card" v-if="selected">
      <h3>价格历史（{{ selected }}）</h3>
      <svg v-if="historyPoints.length" viewBox="0 0 300 120" class="chart">
        <polyline :points="linePoints" fill="none" stroke="#D4453E" stroke-width="2" />
      </svg>
      <p v-else class="muted">暂无快照，查询后上报即可生成曲线</p>

      <h3>成交记录</h3>
      <table v-if="deals.length">
        <thead><tr><th>成交时间</th><th>成交价</th></tr></thead>
        <tbody>
          <tr v-for="(d, i) in deals" :key="i">
            <td>{{ new Date(d.deal_ts * 1000).toLocaleString() }}</td>
            <td>{{ d.deal_price }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无成交记录</p>
    </div>
  </div>
</template>

<style scoped>
.cbg-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 15px;
  max-width: 900px;
  margin: 0 auto;
}
.card {
  background: var(--bg-panel, #fff);
  border: 1px solid var(--border-color, #e6e0d8);
  border-radius: 10px;
  padding: 15px;
}
.card h2 { margin: 0 0 8px; }
.card h3 { margin: 0 0 10px; }
.muted { color: var(--color-text-muted, #888); font-size: 12px; line-height: 1.6; }
.msg { color: #8b6914; font-size: 13px; min-height: 1.2em; margin: 8px 0 0; }
.cookie-row { display: flex; gap: 8px; }
.cookie-row input { flex: 1; padding: 8px; border: 1px solid var(--border-color, #ccc); border-radius: 6px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.form-grid input { padding: 8px; border: 1px solid var(--border-color, #ccc); border-radius: 6px; }
.btn {
  padding: 8px 14px; border: 1px solid var(--border-color, #ccc);
  border-radius: 6px; background: #f3f0ea; cursor: pointer;
}
.btn-primary { background: #d4453e; color: #fff; border-color: #d4453e; }
.btn-mini { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-color, #eee); }
tr.active { background: #fff7f6; }
.chart { width: 100%; height: 120px; background: #faf8f5; border: 1px solid var(--border-color, #eee); border-radius: 6px; }
a { color: #d4453e; cursor: pointer; }
</style>
