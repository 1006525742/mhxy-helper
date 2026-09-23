<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FixedDamageWeaponDef } from '@/calculators/engine/types'
import { computeFdWeapon } from '@/calculators/services/calcEngine'
import { loadPersist, watchPersist } from '@/calculators/services/calcPersist'

const props = defineProps<{ def: FixedDamageWeaponDef }>()

interface WeaponInput {
  damage: number
  agility: number
  price: number
}

// 输入项本机存档（门派 / 整份武器列表），刷新不丢
const LS_KEY = 'mhxy_fdweapon_v1'
interface FwPersist {
  sectId: string
  weapons: WeaponInput[]
}
const sv = loadPersist<FwPersist>(LS_KEY)

// 默认带入估价表「武器性价比」示例三把武器，便于对照
const DEFAULT_WEAPONS: WeaponInput[] = [
  { damage: 490, agility: 0, price: 10 },
  { damage: 467, agility: 19, price: 333 },
  { damage: 500, agility: 0, price: 333 },
]

const sectId = ref(sv?.sectId ?? props.def.sects[0]?.id ?? '')
const weapons = ref<WeaponInput[]>(
  sv?.weapons?.length ? sv.weapons : DEFAULT_WEAPONS.map((w) => ({ ...w })),
)

watchPersist(LS_KEY, [sectId, weapons], () => ({
  sectId: sectId.value,
  weapons: weapons.value,
}))

function addWeapon() {
  weapons.value.push({ damage: 0, agility: 0, price: 0 })
}
function removeWeapon(i: number) {
  if (weapons.value.length <= 1) return
  weapons.value.splice(i, 1)
}

const result = computed(() => computeFdWeapon(props.def, sectId.value, weapons.value))

function fmt(v: number): string {
  // 保留至多 2 位小数，去掉末尾 0
  return (Math.round(v * 100) / 100).toString()
}
</script>

<template>
  <div class="fw-view">
    <div class="fw-controls card">
      <label class="fw-sect">
        <span>固伤门派</span>
        <select v-model="sectId">
          <option v-for="s in def.sects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>

      <div class="fw-weapons">
        <div class="fw-whead">
          <span class="fw-wname">武器</span>
          <span>伤害</span>
          <span>敏捷</span>
          <span>价格/元</span>
          <span></span>
        </div>
        <div v-for="(w, i) in weapons" :key="i" class="fw-wrow">
          <span class="fw-wname">武器{{ i + 1 }}</span>
          <input type="number" v-model.number="w.damage" :min="0" :step="1" />
          <input type="number" v-model.number="w.agility" :min="0" :step="1" />
          <input type="number" v-model.number="w.price" :min="0" :step="1" />
          <button class="fw-del" @click="removeWeapon(i)" :disabled="weapons.length <= 1" title="删除该武器">
            ×
          </button>
        </div>
        <button class="fw-add" @click="addWeapon">+ 添加武器</button>
      </div>
    </div>

    <div class="fw-result card">
      <table class="fw-table">
        <thead>
          <tr>
            <th>武器</th>
            <th class="c-num">伤害</th>
            <th class="c-num">敏捷</th>
            <th class="c-num">价格</th>
            <th class="c-num">主秒加成</th>
            <th class="c-num">副秒加成</th>
            <th class="c-num">每元主秒</th>
            <th class="c-num">每元副秒</th>
            <th class="c-num">性价比排名</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in result.fdWeapon!.rows" :key="r.name" :class="{ best: r.rank === 1 }">
            <td class="fw-name">{{ r.name }}</td>
            <td class="c-num">{{ r.damage }}</td>
            <td class="c-num">{{ r.agility }}</td>
            <td class="c-num">{{ r.price }}</td>
            <td class="c-num">{{ fmt(r.mainHit) }}</td>
            <td class="c-num">{{ fmt(r.subHit) }}</td>
            <td class="c-num">{{ fmt(r.mainPerYuan) }}</td>
            <td class="c-num">{{ fmt(r.subPerYuan) }}</td>
            <td class="c-num">
              <span v-if="r.rank === 1" class="fw-rank best">★ {{ r.rank }}</span>
              <span v-else class="fw-rank">{{ r.rank }}</span>
            </td>
          </tr>
          <tr v-if="result.fdWeapon!.rows.length === 0">
            <td colspan="9" class="fw-empty">请至少录入一把武器</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="fw-caption">
      主秒加成 = 伤害×该门派伤害主秒系数 + 敏捷×敏捷主秒系数；副秒加成同理。性价比按「每元副秒」排序（固伤门派最关心副秒伤害）。价格单位任意，仅用于横向对比。系数来自估价表「自动计算固伤加成」。
    </p>
  </div>
</template>

<style scoped>
.fw-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.fw-controls {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.fw-sect {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 14px;
}
.fw-sect select {
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.fw-weapons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fw-whead,
.fw-wrow {
  display: grid;
  grid-template-columns: 64px 1fr 1fr 1fr 32px;
  gap: 10px;
  align-items: center;
}
.fw-whead {
  font-size: 12px;
  color: var(--color-secondary);
  font-weight: 600;
  padding: 0 2px;
}
.fw-wname {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 600;
}
.fw-wrow input {
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
  width: 100%;
}
.fw-del {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  color: var(--color-text-muted);
  border-radius: 4px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.fw-del:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.fw-add {
  align-self: flex-start;
  margin-top: 2px;
  padding: 7px 14px;
  border: 1px dashed var(--border-color);
  background: transparent;
  color: var(--color-secondary);
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.fw-result {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.fw-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.fw-table th,
.fw-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.fw-table th {
  color: var(--color-secondary);
  font-weight: 600;
}
.fw-table .c-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.fw-table tbody tr.best {
  background: rgba(67, 160, 71, 0.12);
}
.fw-name {
  font-weight: 600;
  color: var(--color-text);
}
.fw-rank {
  font-weight: 700;
  color: var(--color-text);
}
.fw-rank.best {
  color: #43a047;
}
.fw-empty {
  text-align: center;
  color: var(--color-text-muted);
}
.fw-caption {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
}
</style>
