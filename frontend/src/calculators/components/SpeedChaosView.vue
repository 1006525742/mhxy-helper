<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SpeedChaosDef } from '@/calculators/engine/types'
import { computeSpeedChaos, computeChaosCheck, type ChaosUnitType } from '@/calculators/services/calcEngine'
import { loadPersist, watchPersist } from '@/calculators/services/calcPersist'

const props = defineProps<{ def: SpeedChaosDef }>()

// 输入项本机存档（须弥面板 / 天阵 / 乱敏判定四个字段），刷新不丢
const LS_KEY = 'mhxy_speedchaos_v1'
interface ScPersist {
  panel: number
  tianArray: boolean
  lowPanel: number
  lowType: ChaosUnitType
  highPanel: number
  highType: ChaosUnitType
}
const sv = loadPersist<ScPersist>(LS_KEY)

const panel = ref(sv?.panel ?? 601)
const tianArray = ref(sv?.tianArray ?? true)

const res = computed(() => computeSpeedChaos(props.def, panel.value, tianArray.value))

// 最高速须弥的乱敏范围
const xumiRange = computed(() => {
  if (!res.value.speedChaos) return null
  const sc = res.value.speedChaos
  return { min: sc.battleMin, max: sc.battleMax }
})

// 乱敏判定：低速单元 / 高速单元
const lowPanel = ref(sv?.lowPanel ?? 802)
const lowType = ref<ChaosUnitType>(sv?.lowType ?? '人物')
const highPanel = ref(sv?.highPanel ?? 887)
const highType = ref<ChaosUnitType>(sv?.highType ?? '人物')

const chaos = computed(() =>
  computeChaosCheck(lowPanel.value, lowType.value, highPanel.value, highType.value, tianArray.value),
)

// 所有输入项声明完毕后再注册自动保存
watchPersist(
  LS_KEY,
  [panel, tianArray, lowPanel, lowType, highPanel, highType],
  () => ({
    panel: panel.value,
    tianArray: tianArray.value,
    lowPanel: lowPanel.value,
    lowType: lowType.value,
    highPanel: highPanel.value,
    highType: highType.value,
  }),
)

// 速度建议参考（估价表仅收录的单行数据，仅供对照）
const babySpeed = { level: 119, poorXumi: 248, normalXumi: 357, richXumi: 392.7, attack: 257 }
const casterSpeed = { level: 129, poor: 355.92, normal: 515.35, rich: 566.88 }
</script>

<template>
  <div class="sc-wrap">
    <div class="sc-controls card">
      <label class="sc-field">
        <span>最高速须弥 面板速度</span>
        <input type="number" v-model.number="panel" :min="0" step="1" />
      </label>
      <div class="sc-toggle">
        <span class="sc-toggle-label">天阵模式</span>
        <div class="sc-seg">
          <button :class="{ active: tianArray }" @click="tianArray = true">开天阵</button>
          <button :class="{ active: !tianArray }" @click="tianArray = false">不开天阵</button>
        </div>
      </div>
    </div>

    <p v-if="res.errorMessage" class="sc-err">{{ res.errorMessage }}</p>

    <template v-else-if="res.speedChaos">
      <!-- 须弥乱敏范围 -->
      <div class="sc-range card">
        <div class="sc-range-title">最高速须弥 战斗时速度（乱敏 ±5%）</div>
        <div class="sc-range-val">
          <span class="sc-range-min">{{ xumiRange!.min }}</span>
          <span class="sc-range-dash">—</span>
          <span class="sc-range-max">{{ xumiRange!.max }}</span>
        </div>
      </div>

      <!-- 梯队要求 -->
      <div class="sc-table card">
        <div class="sc-table-head">
          人物速度梯队要求（{{ tianArray ? '开天阵' : '不开天阵' }}，
          使本梯队一定比下一梯队快）
        </div>
        <table>
          <thead>
            <tr>
              <th>梯队</th>
              <th class="c-num">要求面板速度<br />不低于</th>
              <th class="c-num">
                {{ tianArray ? '天阵减少后速度' : '面板速度' }}
              </th>
              <th class="c-num">战斗时速度<br />波动范围</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in res.speedChaos.tiers" :key="t.pos">
              <td class="c-pos">{{ t.label }}</td>
              <td class="c-num c-req">≥ {{ t.requiredPanel }}</td>
              <td class="c-num">{{ t.afterArray }}</td>
              <td class="c-num">{{ t.minBattle }} ~ {{ t.maxBattle }}</td>
            </tr>
          </tbody>
        </table>
        <div class="sc-foot">
          5速锚定须弥上限；4/3/2/1速依次需快过上一梯队的最大战斗速度。
          开天阵时人物速度先 ×0.9（取整）再乱敏。
        </div>
      </div>

      <!-- 人物 / 宝宝 配速原则 -->
      <div class="sc-principle card">
        <div class="sc-principle-title">人物 / 宝宝 配速原则</div>
        <div class="sc-principle-chain">
          <span class="sc-pc">固伤</span>
          <span class="sc-arrow">&gt;</span>
          <span class="sc-pc">物理</span>
          <span class="sc-arrow">&gt;</span>
          <span class="sc-pc">法系</span>
          <span class="sc-arrow">&gt;</span>
          <span class="sc-pc">须弥宝宝</span>
          <span class="sc-arrow">&gt;</span>
          <span class="sc-pc">全力宝宝</span>
          <span class="sc-eq">=</span>
          <span class="sc-pc">血攻宝宝</span>
        </div>
        <div class="sc-principle-note">
          速度由快到慢：固伤最快，其次物理、法系，再次须弥宝宝，全力宝宝与血攻宝宝速度相同（并列最慢）。
          配速时按此优先级确保出手顺序合理。
        </div>
      </div>

      <!-- 乱敏判定（人兽 / 人人 / 兽兽） -->
      <div class="sc-check card">
        <div class="sc-table-head">乱敏判定（低速单元是否可能因乱敏反超高速单元）</div>
        <div class="sc-check-inputs">
          <div class="sc-unit">
            <div class="sc-unit-label">低速单元（慢）</div>
            <label class="sc-mini">
              <span>面板速度</span>
              <input type="number" v-model.number="lowPanel" :min="0" step="1" />
            </label>
            <div class="sc-seg sm">
              <button :class="{ active: lowType === '人物' }" @click="lowType = '人物'">人物</button>
              <button :class="{ active: lowType === '宝宝' }" @click="lowType = '宝宝'">宝宝</button>
            </div>
          </div>
          <div class="sc-unit">
            <div class="sc-unit-label">高速单元（快）</div>
            <label class="sc-mini">
              <span>面板速度</span>
              <input type="number" v-model.number="highPanel" :min="0" step="1" />
            </label>
            <div class="sc-seg sm">
              <button :class="{ active: highType === '人物' }" @click="highType = '人物'">人物</button>
              <button :class="{ active: highType === '宝宝' }" @click="highType = '宝宝'">宝宝</button>
            </div>
          </div>
        </div>

        <div class="sc-check-result">
          <div class="sc-check-row">
            <span class="sc-cr-label">低速单元 战斗范围</span>
            <span class="sc-cr-val">{{ chaos.low.after }}（天阵后）→ {{ chaos.low.min }} ~ {{ chaos.low.max }}</span>
          </div>
          <div class="sc-check-row">
            <span class="sc-cr-label">高速单元 战斗范围</span>
            <span class="sc-cr-val">{{ chaos.high.after }}（天阵后）→ {{ chaos.high.min }} ~ {{ chaos.high.max }}</span>
          </div>
          <div class="sc-check-verdict" :class="chaos.isChaos ? 'chaos' : 'nochaos'">
            {{ chaos.isChaos ? '会乱敏（范围重叠，低速可能反超）' : '不乱敏（高速一定更快）' }}
            <span class="sc-diff">乱敏差值 {{ chaos.diff > 0 ? '+' : '' }}{{ chaos.diff.toFixed(2) }}</span>
          </div>
          <div class="sc-foot">
            天阵仅作用于人物（人物面板先 ×0.9 再乱敏）；宝宝永不 ×0.9。
            乱敏差值 = 低速上限 − 高速下限，&gt;0 即范围重叠会乱敏。
          </div>
        </div>
      </div>

      <!-- 速度建议参考（估价表仅收录单行） -->
      <div class="sc-ref card">
        <div class="sc-table-head">速度建议参考（估价表仅收录单行，仅供对照）</div>
        <table>
          <thead>
            <tr>
              <th>宝宝等级</th>
              <th class="c-num">难民须弥</th>
              <th class="c-num">平民须弥</th>
              <th class="c-num">土豪须弥</th>
              <th class="c-num">攻宝宝</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ babySpeed.level }}</td>
              <td class="c-num">{{ babySpeed.poorXumi }}</td>
              <td class="c-num">{{ babySpeed.normalXumi }}</td>
              <td class="c-num">{{ babySpeed.richXumi }}</td>
              <td class="c-num">{{ babySpeed.attack }}</td>
            </tr>
          </tbody>
        </table>
        <table class="sc-ref-2">
          <thead>
            <tr>
              <th>法系人物等级</th>
              <th class="c-num">难民速度</th>
              <th class="c-num">平民速度</th>
              <th class="c-num">土豪速度</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ casterSpeed.level }}</td>
              <td class="c-num">{{ casterSpeed.poor }}</td>
              <td class="c-num">{{ casterSpeed.normal }}</td>
              <td class="c-num">{{ casterSpeed.rich }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sc-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sc-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 20px;
  background: var(--bg-panel);
}
.sc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-muted);
}
.sc-field input {
  width: 180px;
  padding: 9px 11px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 15px;
}
.sc-toggle {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sc-toggle-label {
  font-size: 13px;
  color: var(--color-text-muted);
}
.sc-seg {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  overflow: hidden;
}
.sc-seg button {
  padding: 8px 18px;
  border: none;
  background: var(--bg-input);
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.sc-seg button.active {
  background: var(--color-primary);
  color: #fff;
}
.sc-err {
  color: var(--color-warning);
  font-size: 14px;
}
.sc-range {
  background: var(--bg-panel);
  text-align: center;
  padding: 22px;
}
.sc-range-title {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-bottom: 10px;
}
.sc-range-val {
  font-size: 38px;
  font-weight: 700;
  color: var(--color-text);
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 12px;
}
.sc-range-min {
  color: var(--color-success);
}
.sc-range-max {
  color: var(--color-primary);
}
.sc-range-dash {
  font-size: 26px;
  color: var(--color-text-muted);
}
.sc-table {
  background: var(--bg-panel);
  padding: 0;
  overflow: hidden;
}
.sc-table-head {
  padding: 14px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--border-color);
}
.sc-table table {
  width: 100%;
  border-collapse: collapse;
}
.sc-table th,
.sc-table td {
  padding: 11px 14px;
  text-align: left;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color);
}
.sc-table thead th {
  color: var(--color-text-muted);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.02);
}
.sc-table tbody tr:last-child td {
  border-bottom: none;
}
.c-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.c-pos {
  font-weight: 600;
  color: var(--color-text);
}
.c-req {
  font-weight: 700;
  color: var(--color-primary);
}
.sc-foot {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  border-top: 1px solid var(--border-color);
}
.sc-principle {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.sc-principle-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 12px;
}
.sc-principle-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sc-pc {
  padding: 5px 12px;
  border-radius: 6px;
  background: rgba(30, 136, 229, 0.14);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.sc-arrow {
  color: var(--color-text-muted);
  font-weight: 700;
}
.sc-eq {
  color: var(--color-text-muted);
  font-weight: 700;
  font-size: 15px;
}
.sc-principle-note {
  margin-top: 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
.sc-check {
  background: var(--bg-panel);
  padding: 0;
  overflow: hidden;
}
.sc-check-inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}
.sc-unit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sc-unit-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.sc-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.sc-mini input {
  width: 110px;
  padding: 7px 9px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 14px;
}
.sc-seg.sm button {
  padding: 6px 14px;
  font-size: 12px;
}
.sc-check-result {
  padding: 14px 16px;
}
.sc-check-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
  padding: 6px 0;
}
.sc-cr-label {
  color: var(--color-text-muted);
  min-width: 130px;
}
.sc-cr-val {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.sc-check-verdict {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 12px;
}
.sc-check-verdict.chaos {
  background: rgba(233, 69, 96, 0.14);
  color: var(--color-warning);
}
.sc-check-verdict.nochaos {
  background: rgba(67, 160, 71, 0.14);
  color: var(--color-success);
}
.sc-diff {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.85;
}
.sc-ref {
  background: var(--bg-panel);
  padding: 0;
  overflow: hidden;
}
.sc-ref table {
  width: 100%;
  border-collapse: collapse;
}
.sc-ref-2 {
  border-top: 1px solid var(--border-color);
}
.sc-ref th,
.sc-ref td {
  padding: 10px 14px;
  text-align: left;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color);
}
.sc-ref thead th {
  color: var(--color-text-muted);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.02);
}
.sc-ref tbody tr:last-child td {
  border-bottom: none;
}
</style>
