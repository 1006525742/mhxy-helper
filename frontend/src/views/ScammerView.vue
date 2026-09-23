<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import {
  getMeta, getList, checkId, revealField, submitReport, CATEGORY_LABELS,
  type ScammerRecord, type ScamCategory, type CheckResult,
} from '@/services/scammerApi'

const CATEGORIES: (ScamCategory | 'all')[] = ['all', 'scammer', 'gang', 'afk', 'blacklist']

const meta = reactive({
  updatedAt: '', notice: '', total: 0, userReports: 0, highRisk: 0,
  byCategory: {} as Record<string, { label: string; count: number }>,
  rules: [] as { k: string; v: string }[],
})

const records = ref<ScammerRecord[]>([])
const loading = ref(false)
const activeCat = ref<ScamCategory | 'all'>('all')
const keyword = ref('')
const riskOnly = ref(false)

// ---- 组队前 ID 预警 ----
const checkInput = ref('')
const checkResult = ref<CheckResult | null>(null)
const checking = ref(false)
let checkTimer: number | undefined

function onCheckInput() {
  window.clearTimeout(checkTimer)
  const q = checkInput.value.trim()
  if (!q) { checkResult.value = null; return }
  checkTimer = window.setTimeout(async () => {
    checking.value = true
    try {
      const r = await checkId(q)
      checkResult.value = r
    } catch {
      checkResult.value = null
    } finally {
      checking.value = false
    }
  }, 300)
}

// ---- 敏感字段按需展开 ----
const revealed = reactive<Record<string, string>>({})
async function reveal(rec: ScammerRecord, field: 'wechat' | 'wechatId' | 'reporterWechat' | 'phones') {
  const key = `${rec.id}.${field}`
  if (revealed[key] !== undefined) { delete revealed[key]; return }
  try {
    const v = await revealField(rec.id, field)
    revealed[key] = Array.isArray(v) ? v.join(' / ') : String(v || '（空）')
  } catch (e: any) {
    revealed[key] = '获取失败：' + (e.message || '')
  }
}
function shown(rec: ScammerRecord, field: 'wechat' | 'wechatId' | 'reporterWechat' | 'phones') {
  const key = `${rec.id}.${field}`
  if (revealed[key] !== undefined) return revealed[key]
  return rec.sensitive?.[field] ? (Array.isArray(rec.sensitive[field]) ? (rec.sensitive[field] as string[]).join(' / ') : rec.sensitive[field]) : ''
}

// ---- 举报表单 ----
const showForm = ref(false)
const showRules = ref(false)
const submitting = ref(false)
const formMsg = ref('')
const form = reactive({
  name: '', gameId: '', level: '', type: '', time: '', detail: '', reporter: '', wechat: '', wechatId: '',
})

// 常见骗术，供快速选择
const COMMON_TYPES = ['抓鬼骗钱', '带环/百妖', '卖仙玉', '卖装备', '帮派借钱', '洗号', '挂机不看号', '其他']

async function loadList() {
  loading.value = true
  try {
    const r = await getList({
      category: activeCat.value === 'all' ? '' : activeCat.value,
      q: keyword.value.trim(),
      risk: riskOnly.value ? 'high' : '',
    })
    records.value = r.records || []
  } catch {
    records.value = []
  } finally {
    loading.value = false
  }
}

let searchTimer: number | undefined
watch(keyword, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(loadList, 250)
})
watch([activeCat, riskOnly], loadList)

async function pickCat(c: ScamCategory | 'all') { activeCat.value = c }

async function onSubmit() {
  formMsg.value = ''
  if (!form.name.trim() && !form.gameId.trim() && !form.wechat.trim()) {
    formMsg.value = '游戏昵称、ID、微信至少填一项'
    return
  }
  submitting.value = true
  try {
    const r = await submitReport({ ...form })
    formMsg.value = '✅ ' + r.message
    Object.keys(form).forEach((k) => { (form as any)[k] = '' })
    showForm.value = false
    await Promise.all([loadList(), loadMeta()])
  } catch (e: any) {
    formMsg.value = '❌ ' + (e.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

async function loadMeta() {
  try {
    const m = await getMeta()
    Object.assign(meta, {
      updatedAt: m.updatedAt, notice: m.notice, total: m.total,
      userReports: m.userReports, highRisk: m.highRisk,
      byCategory: m.byCategory || {}, rules: m.rules || [],
    })
  } catch { /* 后端未启动时静默 */ }
}

const statCards = computed(() => [
  { k: '名单总量', v: meta.total, color: 'var(--color-primary)' },
  { k: '高风险', v: meta.highRisk, color: 'var(--color-danger)' },
  { k: '玩家举报', v: meta.userReports, color: 'var(--color-accent)' },
])

function catLabel(c: string) { return CATEGORY_LABELS[c as ScamCategory] || c }

onMounted(async () => {
  await Promise.all([loadMeta(), loadList()])
})
</script>

<template>
  <div class="scam-page">
    <h2 class="page-title">🚨 骗子名单</h2>

    <!-- 组队/交易前查 ID -->
    <section class="panel check-panel">
      <div class="panel-title">🔍 组队 / 交易前查一查</div>
      <p class="panel-sub">粘贴对方游戏 ID 或昵称，即时核对是否在名单内。骗子会改名，<b>务必核对曾用名</b>。</p>
      <div class="check-row">
        <input
          v-model="checkInput"
          @input="onCheckInput"
          class="check-input"
          placeholder="输入游戏 ID 或昵称，例如 27196545"
        />
        <span v-if="checking" class="checking">查询中…</span>
      </div>

      <div v-if="checkResult && checkResult.keyword" class="check-result" :class="checkResult.level">
        <template v-if="checkResult.level === 'danger'">
          <div class="cr-head">⚠️ 命中名单（ID 精确匹配）</div>
        </template>
        <template v-else-if="checkResult.level === 'warn'">
          <div class="cr-head">🟡 疑似命中（昵称/部分匹配，请人工核对 ID）</div>
        </template>
        <template v-else>
          <div class="cr-head">✅ 名单内未找到「{{ checkResult.keyword }}」</div>
          <div class="cr-tip">没记录不等于安全，线下交易仍需谨慎。</div>
        </template>

        <div v-for="h in checkResult.hits" :key="h.id" class="cr-hit">
          <span class="cr-name">{{ h.name }}</span>
          <span v-if="h.gameId" class="cr-id">ID {{ h.gameId }}</span>
          <span v-if="h.level" class="cr-lv">{{ h.level }}级</span>
          <span class="cr-type">{{ catLabel(h.category) }} · {{ h.type || '未分类' }}</span>
          <span v-if="h.risk === 'high'" class="badge-high">高风险</span>
          <div v-if="h.detail" class="cr-detail">{{ h.detail }}</div>
        </div>
      </div>
    </section>

    <!-- 免责声明 -->
    <div v-if="meta.notice" class="notice">📢 {{ meta.notice }}</div>

    <!-- 统计 -->
    <div class="stats">
      <div v-for="s in statCards" :key="s.k" class="stat-card">
        <div class="stat-v" :style="{ color: s.color }">{{ s.v }}</div>
        <div class="stat-k">{{ s.k }}</div>
      </div>
      <div class="stat-card updated">
        <div class="stat-v small">{{ meta.updatedAt || '-' }}</div>
        <div class="stat-k">数据更新</div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="toolbar">
      <div class="tabs">
        <button
          v-for="c in CATEGORIES"
          :key="c"
          class="tab"
          :class="{ active: activeCat === c }"
          @click="pickCat(c)"
        >
          {{ CATEGORY_LABELS[c] }}
          <span v-if="c !== 'all' && meta.byCategory[c]" class="tab-n">{{ meta.byCategory[c].count }}</span>
        </button>
      </div>
      <div class="tool-right">
        <input v-model="keyword" class="search" placeholder="搜索昵称 / ID / 骗术 / 经过" />
        <label class="risk-toggle">
          <input v-model="riskOnly" type="checkbox" /> 只看高风险
        </label>
        <button class="btn-report" @click="showForm = !showForm">
          {{ showForm ? '收起' : '➕ 我要举报' }}
        </button>
      </div>
    </div>

    <!-- 举报表单 -->
    <section v-if="showForm" class="panel form-panel">
      <div class="panel-title">➕ 提交举报</div>
      <p class="panel-sub">提交后所有人立即可见。微信等联系方式默认打码展示，他人需手动点击才展开。</p>
      <div class="form-grid">
        <label>游戏昵称<input v-model="form.name" placeholder="如 某某某" /></label>
        <label>游戏 ID<input v-model="form.gameId" placeholder="如 27196545" /></label>
        <label>等级<input v-model="form.level" placeholder="如 109" /></label>
        <label>发生时间<input v-model="form.time" placeholder="如 2026/9/11 20:30" /></label>
        <label class="full">骗术类型
          <div class="type-row">
            <select v-model="form.type">
              <option value="">-- 选择或自定义 --</option>
              <option v-for="t in COMMON_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <input v-model="form.type" placeholder="或直接填写" />
          </div>
        </label>
        <label>你的游戏昵称<input v-model="form.reporter" placeholder="选填" /></label>
        <label>对方微信（选填）<input v-model="form.wechat" placeholder="选填" /></label>
        <label>对方微信号（选填）<input v-model="form.wechatId" placeholder="选填" /></label>
        <label class="full">事情经过
          <textarea v-model="form.detail" rows="3" placeholder="尽量写清时间、金额、过程。手机号会自动打码。"></textarea>
        </label>
      </div>
      <div class="form-actions">
        <button class="btn-submit" :disabled="submitting" @click="onSubmit">
          {{ submitting ? '提交中…' : '提交举报' }}
        </button>
        <span v-if="formMsg" class="form-msg" :class="{ err: formMsg.startsWith('❌') }">{{ formMsg }}</span>
      </div>
    </section>

    <!-- 名单 -->
    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!records.length" class="empty">没有匹配的记录</div>

    <div v-else class="list">
      <article
        v-for="r in records"
        :key="r.id"
        class="card"
        :class="{ 'card-high': r.risk === 'high', 'card-user': r.source === 'user' }"
      >
        <div class="card-head">
          <span class="c-name">{{ r.name }}</span>
          <span v-if="r.gameId" class="c-id">ID {{ r.gameId }}</span>
          <span v-if="r.level" class="c-lv">{{ r.level }}级</span>
          <span class="c-cat">{{ catLabel(r.category) }}</span>
          <span v-if="r.type" class="c-type">{{ r.type }}</span>
          <span v-if="r.risk === 'high'" class="badge-high">高风险</span>
          <span v-if="r.source === 'user'" class="badge-user">玩家举报</span>
          <span v-if="r.time" class="c-time">{{ r.time }}</span>
        </div>

        <div v-if="r.extra && (r.extra.gangNo || r.extra.leaderInfo)" class="c-extra">
          <span v-if="r.extra.gangNo">🏴 {{ r.extra.gangNo }}</span>
          <span v-if="r.extra.leaderInfo">帮主：{{ r.extra.leaderInfo }}</span>
          <span v-if="r.extra.viceInfo">副帮：{{ r.extra.viceInfo }}</span>
        </div>

        <div v-if="r.detail" class="c-detail">{{ r.detail }}</div>

        <div class="c-foot">
          <span v-if="r.reporter" class="c-reporter">举报人：{{ r.reporter }}</span>
          <span v-if="r.createdAt" class="c-created">提交于 {{ r.createdAt }}</span>

          <span v-if="r.sensitive?.wechat" class="sens" @click="reveal(r, 'wechat')">
            微信：{{ shown(r, 'wechat') }}
            <em>{{ revealed[`${r.id}.wechat`] !== undefined ? '隐藏' : '显示' }}</em>
          </span>
          <span v-if="r.sensitive?.wechatId" class="sens" @click="reveal(r, 'wechatId')">
            微信号：{{ shown(r, 'wechatId') }}
            <em>{{ revealed[`${r.id}.wechatId`] !== undefined ? '隐藏' : '显示' }}</em>
          </span>
          <span v-if="r.sensitive?.reporterWechat" class="sens" @click="reveal(r, 'reporterWechat')">
            举报人微信：{{ shown(r, 'reporterWechat') }}
            <em>{{ revealed[`${r.id}.reporterWechat`] !== undefined ? '隐藏' : '显示' }}</em>
          </span>
          <span v-if="r.sensitive?.phones?.length" class="sens" @click="reveal(r, 'phones')">
            手机号：{{ shown(r, 'phones') }}
            <em>{{ revealed[`${r.id}.phones`] !== undefined ? '隐藏' : '显示' }}</em>
          </span>
        </div>
      </article>
    </div>

    <!-- 群规说明 -->
    <section v-if="meta.rules.length" class="panel rules-panel">
      <div class="panel-title clickable" @click="showRules = !showRules">
        📜 散人交流群 · 收售规则 {{ showRules ? '▲' : '▼' }}
      </div>
      <ul v-if="showRules" class="rules">
        <li v-for="(ru, i) in meta.rules" :key="i"><b>{{ ru.k }}</b>：{{ ru.v }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.scam-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px 18px 60px;
  color: var(--color-text);
  font-family: var(--font-cn);
}

.page-title {
  font-family: var(--font-pixel);
  font-size: 16px;
  color: var(--color-danger);
  margin-bottom: 14px;
  text-shadow: 0 0 20px rgba(244, 63, 94, 0.3);
}

.panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 14px 16px;
  margin-bottom: 14px;
}

.panel-title {
  font-family: var(--font-pixel);
  font-size: 11px;
  color: var(--color-primary);
  margin-bottom: 6px;
}
.panel-title.clickable { cursor: pointer; user-select: none; }

.panel-sub {
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 10px;
}
.panel-sub b { color: var(--color-accent); }

/* ---- 预警查询 ---- */
.check-panel { border-color: rgba(244, 63, 94, 0.18); }
.check-row { display: flex; align-items: center; gap: 10px; }
.check-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 10px 12px;
  color: var(--color-text);
  font-size: 15px;
  font-family: var(--font-mono);
  outline: none;
}
.check-input:focus { border-color: var(--color-primary); box-shadow: 0 0 14px rgba(34, 211, 238, 0.15); }
.checking { color: var(--color-text-muted); font-size: 13px; }

.check-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 4px;
  border-left: 3px solid var(--color-text-muted);
  background: rgba(255, 255, 255, 0.015);
}
.check-result.danger { border-left-color: var(--color-danger); background: rgba(244, 63, 94, 0.06); }
.check-result.warn { border-left-color: var(--color-accent); background: rgba(255, 215, 0, 0.05); }
.check-result.safe { border-left-color: var(--color-success); background: rgba(52, 211, 153, 0.05); }
.cr-head { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
.check-result.danger .cr-head { color: var(--color-danger); }
.check-result.warn .cr-head { color: var(--color-accent); }
.check-result.safe .cr-head { color: var(--color-success); }
.cr-tip { font-size: 12px; color: var(--color-text-muted); }

.cr-hit {
  padding: 8px 0;
  border-top: 1px dashed var(--border-color);
  font-size: 13px;
}
.cr-name { color: var(--color-accent); font-weight: 700; margin-right: 8px; }
.cr-id, .cr-lv, .cr-type { color: var(--color-text-muted); margin-right: 8px; }
.cr-detail { color: var(--color-text); margin-top: 4px; line-height: 1.6; }

/* ---- 声明 / 统计 ---- */
.notice {
  background: rgba(255, 215, 0, 0.05);
  border: 1px solid rgba(255, 215, 0, 0.16);
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text);
  margin-bottom: 14px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  text-align: center;
}
.stat-v { font-family: var(--font-pixel); font-size: 18px; }
.stat-v.small { font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); }
.stat-k { font-size: 12px; color: var(--color-text-muted); margin-top: 6px; }

/* ---- 工具条 ---- */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tab {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--color-text-muted);
  padding: 7px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: var(--font-cn);
}
.tab:hover { color: var(--color-primary); }
.tab.active {
  color: var(--color-primary);
  border-color: rgba(34, 211, 238, 0.3);
  background: rgba(34, 211, 238, 0.06);
}
.tab-n { color: var(--color-accent); font-size: 11px; margin-left: 4px; }

.tool-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.search {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 7px 10px;
  color: var(--color-text);
  font-size: 13px;
  width: 220px;
  outline: none;
  font-family: var(--font-cn);
}
.search:focus { border-color: var(--color-primary); }
.risk-toggle { font-size: 13px; color: var(--color-text-muted); cursor: pointer; display: flex; align-items: center; gap: 4px; }
.btn-report {
  background: rgba(244, 63, 94, 0.1);
  border: 1px solid rgba(244, 63, 94, 0.3);
  color: var(--color-danger);
  padding: 7px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: var(--font-cn);
}
.btn-report:hover { background: rgba(244, 63, 94, 0.18); }

/* ---- 举报表单 ---- */
.form-panel { border-color: rgba(244, 63, 94, 0.2); }
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--color-text-muted); }
.form-grid label.full { grid-column: 1 / -1; }
.form-grid input, .form-grid select, .form-grid textarea {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 10px;
  color: var(--color-text);
  font-size: 13px;
  font-family: var(--font-cn);
  outline: none;
}
.form-grid input:focus, .form-grid select:focus, .form-grid textarea:focus { border-color: var(--color-primary); }
.type-row { display: flex; gap: 8px; }
.type-row select { width: 160px; }
.type-row input { flex: 1; }
.form-actions { margin-top: 12px; display: flex; align-items: center; gap: 12px; }
.btn-submit {
  background: rgba(244, 63, 94, 0.16);
  border: 1px solid rgba(244, 63, 94, 0.4);
  color: var(--color-danger);
  padding: 9px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: var(--font-cn);
}
.btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.form-msg { font-size: 13px; color: var(--color-success); }
.form-msg.err { color: var(--color-danger); }

/* ---- 列表 ---- */
.list { display: grid; gap: 10px; }
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--color-text-muted);
  border-radius: 5px;
  padding: 12px 14px;
}
.card-high { border-left-color: var(--color-danger); }
.card-user { border-left-color: var(--color-accent); }

.card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.c-name { color: var(--color-accent); font-weight: 700; font-size: 15px; }
.c-id { color: var(--color-primary); font-family: var(--font-mono); }
.c-lv { color: var(--color-text-muted); }
.c-cat {
  background: rgba(167, 139, 250, 0.12);
  color: var(--color-secondary);
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
}
.c-type {
  background: rgba(244, 63, 94, 0.1);
  color: var(--color-danger);
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
}
.c-time { color: var(--color-text-muted); font-size: 12px; margin-left: auto; }
.badge-high {
  background: rgba(244, 63, 94, 0.18);
  color: var(--color-danger);
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
}
.badge-user {
  background: rgba(255, 215, 0, 0.14);
  color: var(--color-accent);
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
}
.c-extra { margin-top: 8px; font-size: 12px; color: var(--color-secondary); display: flex; gap: 12px; flex-wrap: wrap; }
.c-detail { margin-top: 8px; font-size: 13px; line-height: 1.7; color: var(--color-text); }

.c-foot {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
}
.sens {
  cursor: pointer;
  color: var(--color-primary);
  border-bottom: 1px dashed rgba(34, 211, 238, 0.4);
}
.sens:hover { color: var(--color-accent); }
.sens em { font-style: normal; font-size: 11px; opacity: 0.7; margin-left: 4px; }

.empty { text-align: center; padding: 40px 0; color: var(--color-text-muted); font-size: 14px; }

/* ---- 群规 ---- */
.rules { list-style: none; margin-top: 8px; }
.rules li { font-size: 13px; line-height: 1.9; color: var(--color-text); }
.rules b { color: var(--color-primary); }

@media (max-width: 860px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .form-grid { grid-template-columns: 1fr; }
  .search { width: 100%; }
}
</style>
