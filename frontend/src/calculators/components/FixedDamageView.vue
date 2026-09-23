<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FixedDamageDef, FixedDamageItem } from '@/calculators/engine/types'
import { computeFixedDamage } from '@/calculators/services/calcEngine'
import { FIXED_DAMAGE_FORMULAS } from '@/calculators/data/fixedDamage'
import { loadPersist, watchPersist } from '@/calculators/services/calcPersist'

const formulas = FIXED_DAMAGE_FORMULAS

const props = defineProps<{ def: FixedDamageDef }>()

// 输入项本机存档（门派 / 各项数值），刷新不丢
const LS_KEY = 'mhxy_fixeddamage_v1'
interface FdPersist {
  sectId: string
  inputs: Record<FixedDamageItem, number>
}
const sv = loadPersist<FdPersist>(LS_KEY)

const sectId = ref(sv?.sectId ?? props.def.sects[0]?.id ?? '')
const inputs = ref<Record<FixedDamageItem, number>>({
  damage: 0,
  agility: 0,
  magicCult: 0,
  swordStone: 0,
  meteor: 0,
  ...(sv?.inputs ?? {}),
})

watchPersist(LS_KEY, [sectId, inputs], () => ({
  sectId: sectId.value,
  inputs: inputs.value,
}))

const FIELDS: { key: FixedDamageItem; label: string; hint: string; step: number }[] = [
  { key: 'damage', label: '伤害', hint: '武器伤害点数', step: 1 },
  { key: 'agility', label: '敏捷', hint: '敏捷点数', step: 1 },
  { key: 'magicCult', label: '法修', hint: '法术修炼等级', step: 1 },
  { key: 'swordStone', label: '试剑石', hint: '试剑石等级', step: 1 },
  { key: 'meteor', label: '落星飞鸿', hint: '落星飞鸿等级', step: 1 },
]

const result = computed(() => computeFixedDamage(props.def, sectId.value, inputs.value))

function fmt(v: number): string {
  // 保留至多 2 位小数，去掉末尾 0
  return (Math.round(v * 100) / 100).toString()
}
</script>

<template>
  <div class="fd-view">
    <div class="fd-controls card">
      <label class="fd-sect">
        <span>固伤门派</span>
        <select v-model="sectId">
          <option v-for="s in def.sects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <div class="fd-fields">
        <label v-for="f in FIELDS" :key="f.key" class="fd-field">
          <span class="fd-label">{{ f.label }}</span>
          <span class="fd-hint">{{ f.hint }}</span>
          <input type="number" v-model.number="inputs[f.key]" :min="0" :step="f.step" />
        </label>
      </div>
    </div>

    <div class="fd-result card">
      <div class="fd-summary">
        <div class="fd-sum-item">
          <span class="fd-sum-label">主秒加成</span>
          <span class="fd-sum-val main">{{ fmt(result.fixedDamage!.mainHit) }}</span>
        </div>
        <div class="fd-sum-item">
          <span class="fd-sum-label">副秒加成</span>
          <span class="fd-sum-val sub">{{ fmt(result.fixedDamage!.subHit) }}</span>
        </div>
      </div>

      <table class="fd-table">
        <thead>
          <tr>
            <th>加伤项</th>
            <th class="c-num">主秒加成</th>
            <th class="c-num">副秒加成</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in result.fixedDamage!.rows" :key="r.key">
            <td>{{ r.label }}</td>
            <td class="c-num">{{ fmt(r.main) }}</td>
            <td class="c-num">{{ fmt(r.sub) }}</td>
          </tr>
          <tr class="fd-total">
            <td>合计</td>
            <td class="c-num">{{ fmt(result.fixedDamage!.mainHit) }}</td>
            <td class="c-num">{{ fmt(result.fixedDamage!.subHit) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="fd-caption">
      加成 = 各项数值 × 该门派转换系数（线性求和）。系数来自估价表「自动计算固伤加成」，仅反映「加伤项 → 固伤」的边际换算，不含技能等级/修炼带来的基础固伤，故结果为各项加成之和，非完整固伤输出。
    </p>

    <div class="fd-formulas card">
      <h3 class="fd-formulas-title">官方公布的固伤门派输出公式</h3>
      <p class="fd-formulas-note">
        以下为官方公布的固伤门派<strong>完整输出公式</strong>（来源 fbbizyy）。其计算口径与上方计算器所用的「估价表边际系数模型」不同——
        本工具计算器支持 <b>女儿村 / 无底洞 / 阴曹地府 / 普陀山</b> 四门派，盘丝洞、天机城公式仅作参考。
      </p>
      <div v-for="f in formulas" :key="f.sect" class="fd-formula-sect">
        <div class="fd-formula-head">
          <span class="fd-formula-sect-name">{{ f.sect }}</span>
          <span v-if="f.supported" class="fd-badge ok">可计算</span>
          <span v-else class="fd-badge ref">仅参考</span>
        </div>
        <table class="fd-formula-table">
          <tbody>
            <tr v-for="r in f.rows" :key="r.k">
              <td class="fd-fk">{{ r.k }}</td>
              <td class="fd-fv">{{ r.v }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fd-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.fd-controls {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.fd-sect {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 14px;
}
.fd-sect select {
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.fd-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.fd-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fd-label {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 600;
}
.fd-hint {
  font-size: 11px;
  color: var(--color-text-muted);
}
.fd-field input {
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.fd-result {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.fd-summary {
  display: flex;
  gap: 28px;
  margin-bottom: 16px;
}
.fd-sum-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fd-sum-label {
  font-size: 12px;
  color: var(--color-text-muted);
}
.fd-sum-val {
  font-size: 26px;
  font-weight: 700;
}
.fd-sum-val.main {
  color: #e94560;
}
.fd-sum-val.sub {
  color: #43a047;
}
.fd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.fd-table th,
.fd-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.fd-table th {
  color: var(--color-secondary);
  font-weight: 600;
}
.fd-table .c-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.fd-total td {
  font-weight: 700;
  border-top: 2px solid var(--border-color);
  border-bottom: none;
}
.fd-caption {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
}
.fd-formulas {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.fd-formulas-title {
  font-size: 15px;
  margin: 0 0 8px;
  color: var(--color-text);
}
.fd-formulas-note {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0 0 14px;
}
.fd-formula-sect {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 12px;
  overflow: hidden;
}
.fd-formula-sect:last-child {
  margin-bottom: 0;
}
.fd-formula-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-input);
  border-bottom: 1px solid var(--border-color);
}
.fd-formula-sect-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--color-text);
}
.fd-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 10px;
}
.fd-badge.ok {
  background: rgba(67, 160, 71, 0.18);
  color: #43a047;
}
.fd-badge.ref {
  background: rgba(224, 160, 40, 0.18);
  color: #d99a1c;
}
.fd-formula-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.fd-formula-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}
.fd-formula-table tr:last-child td {
  border-bottom: none;
}
.fd-fk {
  width: 92px;
  color: var(--color-secondary);
  font-weight: 600;
  white-space: nowrap;
}
.fd-fv {
  color: var(--color-text);
  line-height: 1.5;
}
</style>
