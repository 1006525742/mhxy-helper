<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCalc } from '@/calculators/data/calcs'
import { usePriceStore } from '@/stores/priceStore'
import { compute, type CalcInput } from '@/calculators/services/calcEngine'
import { getOverride, setOverride, clearOverride, hasOverride } from '@/calculators/services/calcOverride'
import type { SynthesisDef, SynthesisRow } from '@/calculators/engine/types'

const route = useRoute()
const router = useRouter()
const store = usePriceStore()

const calc = computed(() => getCalc(route.params.id as string))
const isSynthesis = computed(() => calc.value?.type === 'synthesis')

// 初始文本：若有本地录入，回填为可编辑文本
const initialText = (id: string): string => {
  const ov = getOverride(id)
  if (ov && ov.length) return ov.map((r) => `${r.level},${r.costWan},${r.cumWan}`).join('\n')
  return ''
}
const text = ref(calc.value ? initialText(calc.value.id) : '')

watch(
  calc,
  (c) => {
    if (c) text.value = initialText(c.id)
  },
  { immediate: true },
)

interface RowErr {
  level: number
  msg: string
}
const parseResult = computed<{ rows: SynthesisRow[]; errors: RowErr[] }>(() => {
  const errors: RowErr[] = []
  const raw: { level: number; cost: number; cum?: number }[] = []
  const lines = text.value.split('\n')
  lines.forEach((ln, idx) => {
    const line = ln.split('#')[0].trim()
    if (!line) return
    const parts = line.split(/[,\s\t]+/).filter((p) => p.length)
    if (parts.length < 2) {
      errors.push({ level: idx + 1, msg: `第 ${idx + 1} 行格式应为「等级,本级费用(万)」或「等级,本级,累计」` })
      return
    }
    const level = parseInt(parts[0], 10)
    const cost = parseFloat(parts[1])
    const cum = parts[2] !== undefined ? parseFloat(parts[2]) : undefined
    if (Number.isNaN(level) || level < 1) errors.push({ level, msg: `第 ${idx + 1} 行等级无效` })
    if (Number.isNaN(cost) || cost < 0) errors.push({ level, msg: `第 ${idx + 1} 行本级费用无效` })
    raw.push({ level, cost, cum })
  })
  // 按等级排序、累计（若未给累计则累加）
  raw.sort((a, b) => a.level - b.level)
  const rows: SynthesisRow[] = []
  let running = 0
  const seen = new Set<number>()
  for (const r of raw) {
    if (seen.has(r.level)) {
      errors.push({ level: r.level, msg: `等级 ${r.level} 重复` })
      continue
    }
    seen.add(r.level)
    running += r.cost
    rows.push({ level: r.level, costWan: r.cost, cumWan: r.cum != null && !Number.isNaN(r.cum) ? r.cum : running })
  }
  return { rows, errors }
})

const rows = computed(() => parseResult.value.rows)
const errors = computed(() => parseResult.value.errors)

// 预览：用解析出的表算一次 1→最高级（默认单价）的示例
const preview = computed(() => {
  const c = calc.value
  if (!c || c.type !== 'synthesis' || !rows.value.length) return null
  const temp: SynthesisDef = { ...(c as SynthesisDef), rows: rows.value }
  const maxLv = Math.max(...rows.value.map((r) => r.level))
  const input: CalcInput = { fromLevel: 1, toLevel: maxLv, count: 1, matPriceWan: c.defaultMatPriceWan }
  return compute(temp, input, store.goldPrice, store.discount)
})

const exportJson = computed(() => JSON.stringify(rows.value, null, 2))
const copied = ref(false)
const defaultPrice = computed(() => (calc.value && calc.value.type === 'synthesis' ? calc.value.defaultMatPriceWan : 0))

function save() {
  const c = calc.value
  if (!c || !rows.value.length) return
  setOverride(c.id, rows.value)
  router.push(`/calc/${c.id}`)
}
function reset() {
  const c = calc.value
  if (!c) return
  clearOverride(c.id)
  text.value = ''
}
async function copyJson() {
  try {
    await navigator.clipboard.writeText(exportJson.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="entry-view" v-if="calc">
    <header class="ev-header">
      <h1>录入 / 校对：{{ calc.name }}</h1>
      <span class="ev-chip" v-if="hasOverride(calc.id)">📝 已有本地录入</span>
    </header>

    <p class="ev-tip">
      按每级的「本级梦幻币（万）」逐行填入，每行格式：<code>等级,本级费用</code>
      （也可写 <code>等级,本级,累计</code>）。从第 1 行开始、等级递增即可，累计值留空会自动算。仅合成类支持此录入。
    </p>

    <div v-if="!isSynthesis" class="ev-unsupported">
      该计算器为等级消耗类（如帮派技能强壮/神速），表格结构不同，暂不支持简易录入，请直接联系维护者补充。
    </div>

    <template v-else>
      <div class="ev-grid">
        <div class="ev-input card">
          <label class="ev-label">粘贴费用表（每行一级）</label>
          <textarea v-model="text" rows="16" placeholder="1,2.05&#10;2,6.19&#10;3,18.62&#10;..."></textarea>
          <div class="ev-actions">
            <button class="btn primary" :disabled="!rows.length || errors.length > 0" @click="save">💾 保存本地</button>
            <button class="btn" @click="reset">🗑 清空</button>
          </div>
        </div>

        <div class="ev-preview card">
          <label class="ev-label">实时预览</label>
          <div v-if="errors.length" class="ev-errors">
            <div v-for="e in errors" :key="e.level" class="ev-err">⚠ {{ e.msg }}</div>
          </div>
          <table class="ev-table" v-if="rows.length">
            <thead>
              <tr><th>等级</th><th>本级(万)</th><th>累计(万)</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.level">
                <td>{{ r.level }}</td><td>{{ r.costWan }}</td><td>{{ r.cumWan }}</td>
              </tr>
            </tbody>
          </table>
          <div class="ev-sample" v-if="preview && preview.valid">
            <div>示例：1 → {{ Math.max(...rows.map((r) => r.level)) }} 级（单价 {{ defaultPrice }}万，金价 {{ store.goldPrice }}）</div>
            <div>材料费 <b>{{ preview.materialsWan?.toFixed(2) }}</b> 万 · 合成费 <b>{{ preview.feeWan?.toFixed(2) }}</b> 万</div>
            <div>合计 <b>{{ preview.totalWan.toFixed(2) }}</b> 万 ≈ <b>{{ preview.totalRMB.toFixed(2) }}</b> 元</div>
          </div>
          <div class="ev-export">
            <button class="btn" @click="copyJson">{{ copied ? '✓ 已复制' : '📋 导出 JSON' }}</button>
            <textarea class="ev-json" readonly :value="exportJson" rows="4"></textarea>
          </div>
        </div>
      </div>
    </template>
  </div>

  <div class="entry-view" v-else>
    <div class="ev-notfound">未找到该计算器（{{ route.params.id }}）</div>
  </div>
</template>

<style scoped>
.entry-view { max-width: 1200px; margin: 0 auto; padding: 16px 20px; }
.ev-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.ev-header h1 { font-size: 20px; color: var(--color-primary); }
.ev-chip { font-size: 12px; padding: 3px 10px; border-radius: 10px; background: rgba(102,187,106,0.15); color: var(--color-success); }
.ev-tip { font-size: 13px; color: var(--color-text-muted); line-height: 1.7; margin-bottom: 14px; }
.ev-tip code { background: var(--bg-input); padding: 1px 6px; border-radius: 4px; color: var(--color-text); }
.ev-unsupported { background: rgba(255,152,0,0.12); border: 1px solid #5a4a1a; color: var(--color-warning); padding: 12px; border-radius: 6px; font-size: 13px; }
.ev-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.ev-label { display: block; font-size: 12px; color: var(--color-text-muted); margin-bottom: 6px; }
.ev-input textarea, .ev-json { width: 100%; box-sizing: border-box; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; color: var(--color-text); font-family: ui-monospace, monospace; font-size: 13px; padding: 10px; resize: vertical; }
.ev-actions { display: flex; gap: 10px; margin-top: 10px; }
.btn { padding: 8px 14px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-panel); color: var(--color-text); cursor: pointer; font-size: 13px; }
.btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ev-errors { margin-bottom: 10px; }
.ev-err { color: var(--color-warning); font-size: 12px; padding: 2px 0; }
.ev-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px; }
.ev-table th, .ev-table td { border: 1px solid var(--border-color); padding: 4px 8px; text-align: right; }
.ev-table th { background: var(--bg-panel); color: var(--color-text-muted); }
.ev-sample { font-size: 13px; line-height: 1.7; color: var(--color-text); background: rgba(102,187,106,0.08); padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; }
.ev-export { margin-top: 8px; }
.ev-json { margin-top: 6px; }
.ev-notfound { color: var(--color-warning); font-size: 15px; padding: 20px 0; }
</style>
