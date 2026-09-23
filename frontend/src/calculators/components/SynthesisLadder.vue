<script setup lang="ts">
import { computed } from 'vue'
import type { CalcDef, SynthesisDef } from '@/calculators/engine/types'
import { synthesisLadder } from '@/calculators/services/calcEngine'
import { wanToRMB } from '@/calculators/engine/money'
import { fmtRMB } from '@/calculators/engine/format'

const props = defineProps<{
  def: CalcDef
  matPriceWan: number
  goldPrice: number
  discount: number
  fromLevel?: number
  toLevel?: number
}>()

const isSynth = computed(() => props.def.type === 'synthesis')
const synDef = computed(() => props.def as SynthesisDef)

const ladder = computed(() => (isSynth.value ? synthesisLadder(synDef.value) : []))
const dataMax = computed(() => ladder.value.length)

// 钟灵石无体力（staminaPerLevel=0）→ 隐藏「体力/体力成本」两列
const showStamina = computed(() => (synDef.value.staminaPerLevel ?? 0) > 0)
// 「数量」列：需要1级{材料}数量（如「需要1级钟灵石数量」）
const matLabel = computed(() => `需要${synDef.value.unit}数量`)

// 每行：材料成本 = 数量×单价；本级梦幻币 = 材料 + 合成费
// 逐级四舍五入（万，2 位小数）后再累加（合计做四舍五入）
const round2 = (x: number) => Math.round(x * 100) / 100
const rows = computed(() => {
  let cum = 0
  return ladder.value.map((r) => {
    const materialWan = r.count * props.matPriceWan
    const rowWan = round2(materialWan + r.feeWan)
    cum = round2(cum + rowWan)
    return { ...r, materialWan, rowWan, cumRowWan: cum }
  })
})

// 梦幻币列口径：万区间显示裸数（表头已标注「万」），亿区间显示 4 位小数 + 亿
function fmtDream(wan: number): string {
  if (!isFinite(wan)) return '-'
  if (wan >= 10000) return (wan / 10000).toFixed(4) + '亿'
  return wan.toFixed(2)
}
// 消耗额外梦幻币：裸 2 位小数（表头标注「万」）
function fmtFee(wan: number): string {
  if (!isFinite(wan)) return '-'
  return wan.toFixed(2)
}

// 不传 fromLevel/toLevel（合成页默认）时铺满 1→N；后续若加区间选择器可再传入
const fromLevel = computed(() => props.fromLevel ?? 1)
const toLevel = computed(() => props.toLevel ?? dataMax.value)
const isFull = computed(() => fromLevel.value <= 1 && toLevel.value >= dataMax.value)

function rmb(wan: number): number {
  return wanToRMB(wan, props.goldPrice, props.discount)
}

// 体力成本始终以「万」展示（不折算成两）
function fmtStaminaWan(w: number): string {
  return w.toFixed(2) + '万'
}
// 整数不带千分位逗号（如 8640 直接显示，配合等宽数字更易读/可复制）
function fmtPlain(n: number): string {
  return String(Math.round(n))
}

function inRange(level: number): boolean {
  return !isFull.value && level > fromLevel.value && level <= toLevel.value
}
</script>

<template>
  <div class="syn-ladder" v-if="isSynth">
    <!-- 数据未录入：占位提示 -->
    <div v-if="dataMax === 0" class="syn-empty">
      📝 该合成表数据待录入，请使用上方「录入 / 校对数据」逐级填入费用。
    </div>

    <template v-else>
      <div class="syn-scroll">
        <table class="syn-table">
          <thead>
            <tr>
              <th>等级</th>
              <th>{{ matLabel }}</th>
              <th v-if="showStamina">体力</th>
              <th v-if="showStamina">体力成本</th>
              <th>消耗额外梦幻币（万）</th>
              <th>本级梦幻币（万）</th>
              <th>累计梦幻币（万）</th>
              <th>本级人民币（元）</th>
              <th>累计人民币（元）</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.level"
              :class="{ 'row-hl': inRange(r.level) }"
            >
              <td class="c-lv">{{ r.level }}</td>
              <td class="c-num">{{ fmtPlain(r.count) }}</td>
              <td class="c-num" v-if="showStamina">{{ fmtPlain(r.stamina) }}</td>
              <td class="c-wan" v-if="showStamina">{{ fmtStaminaWan(r.staminaCostWan) }}</td>
              <td class="c-wan">{{ fmtFee(r.gameFeeWan) }}</td>
              <td class="c-wan">{{ fmtDream(r.rowWan) }}</td>
              <td class="c-wan strong">{{ fmtDream(r.cumRowWan) }}</td>
              <td class="c-rmb">{{ fmtRMB(rmb(r.rowWan)) }}</td>
              <td class="c-rmb strong">{{ fmtRMB(rmb(r.cumRowWan)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.syn-ladder {
  margin-top: 4px;
}
.syn-empty {
  background: rgba(255, 152, 0, 0.1);
  border: 1px solid #5a4a1a;
  color: var(--color-warning);
  font-size: 13px;
  padding: 14px 16px;
  border-radius: 8px;
  line-height: 1.6;
}
.syn-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-panel);
}
.syn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14.5px;
  min-width: 760px;
  /* 覆盖全局 VT323 装饰字体：改用清晰等宽（Mac 上 SF Mono，中文 PingFang），数字不再瘦糊 */
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas,
    'Courier New', 'PingFang SC', 'Microsoft YaHei', monospace;
}
.syn-table th,
.syn-table td {
  padding: 10px 13px;
  text-align: right;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color);
}
.syn-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #1c2230;
  color: #c2ccd9;
  font-weight: 700;
  font-size: 13.5px;
  border-bottom: 2px solid var(--border-color);
}
.syn-table th:first-child,
.syn-table td:first-child {
  text-align: center;
  position: sticky;
  left: 0;
  background: var(--bg-panel);
  z-index: 1;
}
/* 数据单元格：放大字号 + 等宽数字（亿级长数值不再糊成一团、对齐清晰） */
.syn-table td {
  font-size: 15.5px;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  letter-spacing: 0.3px;
}
.syn-table tbody tr:nth-child(even) {
  background: rgba(255, 255, 255, 0.045);
}
/* 关键列底色：累计列淡紫、人民币列淡绿，一眼定位结果 */
.syn-table td.strong:not(.c-rmb) {
  background: rgba(124, 92, 255, 0.12);
}
.syn-table td.c-rmb {
  background: rgba(74, 222, 128, 0.07);
}
.syn-table td.c-rmb.strong {
  background: rgba(74, 222, 128, 0.14);
}
.syn-table .c-lv {
  color: #b39cff;
  font-weight: 700;
}
.syn-table .c-num {
  color: #e6ecf3;
  font-weight: 600;
}
/* 梦幻币三列（消耗额外/本级/累计）：主读数列，放大一号 + 提亮，一眼看清金额 */
.syn-table .c-wan {
  color: #f2f6fa;
  font-weight: 600;
  font-size: 17px;
  letter-spacing: 0.4px;
}
/* 累计梦幻币为本表核心结果，再放大一号 */
.syn-table td.c-wan.strong {
  font-size: 18.5px;
  font-weight: 700;
}
.syn-table .c-rmb {
  color: #6ee7a0;
  font-weight: 600;
}
.syn-table .strong {
  font-weight: 700;
}
.syn-table .row-hl td {
  background: rgba(124, 92, 255, 0.16) !important;
}
.syn-table .row-hl td:first-child {
  background: rgba(124, 92, 255, 0.16) !important;
}
</style>
