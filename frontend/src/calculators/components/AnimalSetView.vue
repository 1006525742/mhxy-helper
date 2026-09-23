<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AnimalSetDef, AnimalAttr } from '@/calculators/engine/types'
import { computeAnimalSet } from '@/calculators/services/calcEngine'
import { loadPersist, watchPersist } from '@/calculators/services/calcPersist'

const props = defineProps<{ def: AnimalSetDef }>()

// 输入项本机存档（等级 / 件数 / 属性筛选），刷新不丢
const LS_KEY = 'mhxy_animalset_v1'
interface SetPersist {
  level: number
  pieces: 3 | 5
  attrFilter: AnimalAttr | 'all'
}
const sv = loadPersist<SetPersist>(LS_KEY)

const level = ref(sv?.level ?? props.def.defaultLevel)
const pieces = ref<3 | 5>(sv?.pieces ?? 3)
const attrFilter = ref<AnimalAttr | 'all'>(sv?.attrFilter ?? 'all')

watchPersist(LS_KEY, [level, pieces, attrFilter], () => ({
  level: level.value,
  pieces: pieces.value,
  attrFilter: attrFilter.value,
}))

const ATTRS: (AnimalAttr | 'all')[] = ['all', '敏捷', '魔力', '力量', '体质', '耐力']
const attrLabel = (a: AnimalAttr | 'all') => (a === 'all' ? '全部' : a)

const rows = computed(() => {
  const r = computeAnimalSet(props.def, level.value, pieces.value)
  const all = r.animalRows ?? []
  return attrFilter.value === 'all' ? all : all.filter((x) => x.attr === attrFilter.value)
})

// 各属性类型下、当前所选件数的最高加成（用于「首选」标注）
const bestByAttr = computed(() => {
  const m: Record<string, number> = {}
  for (const r of rows.value) {
    if (m[r.attr] === undefined || r.bonus > m[r.attr]) m[r.attr] = r.bonus
  }
  return m
})

function tierText(t: 1 | 2 | '超1'): string {
  return t === '超1' ? '超1线' : `${t}线`
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
</script>

<template>
  <div class="animal-set">
    <div class="as-controls card">
      <label class="as-level">
        <span>召唤兽等级</span>
        <input
          type="number"
          v-model.number="level"
          :min="0"
          :max="def.maxLevel"
          step="1"
        />
      </label>
      <div class="as-pieces">
        <span class="as-pieces-label">套装件数</span>
        <button :class="['as-chip', { active: pieces === 3 }]" @click="pieces = 3">三件套</button>
        <button :class="['as-chip', { active: pieces === 5 }]" @click="pieces = 5">五件套</button>
      </div>
      <div class="as-filters">
        <button
          v-for="a in ATTRS"
          :key="a"
          :class="['as-chip', { active: attrFilter === a }]"
          @click="attrFilter = a"
        >
          {{ attrLabel(a) }}
        </button>
      </div>
    </div>

    <p class="as-caption">
      加成 = floor(等级 / 系数 + 基础)：1线 ÷4、超1线 ÷3、2线 ÷4；三件套 / 五件套基础值不同（如 1线 15/25、2线 10/15），故加成不同。
      排名与「★首选」按当前所选件数计算；右侧为变身触发几率。
    </p>

    <div class="as-table card">
      <table>
        <thead>
          <tr>
            <th class="c-rank">排名</th>
            <th>套装</th>
            <th>属性</th>
            <th class="c-num">三件加成</th>
            <th class="c-num">五件加成</th>
            <th>附带技能</th>
            <th>影响</th>
            <th>几线</th>
            <th class="c-num">触发(三/五)</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, i) in rows"
            :key="r.name"
            :class="{ best: r.bonus === bestByAttr[r.attr] }"
          >
            <td class="c-rank">
              <span v-if="r.bonus === bestByAttr[r.attr]" class="as-star">★ 首选</span>
              <span v-else>{{ i + 1 }}</span>
            </td>
            <td class="c-name">{{ r.name }}</td>
            <td>{{ r.attr }}</td>
            <td class="c-num" :class="{ 'c-active': pieces === 3 }">+{{ r.threeBonus }}</td>
            <td class="c-num" :class="{ 'c-active': pieces === 5 }">+{{ r.fiveBonus }}</td>
            <td class="c-skill">{{ r.skill }}</td>
            <td>
              <span :class="['as-impact', r.impact]">
                {{ r.impact === '正' ? '正面' : r.impact === '负' ? '负面' : '无' }}
              </span>
            </td>
            <td>{{ tierText(r.tier) }}</td>
            <td class="c-num">{{ pct(r.threeRate) }} / {{ pct(r.fiveRate) }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="9" class="as-empty">请输入召唤兽等级（>0）</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.animal-set {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.as-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: var(--bg-panel);
}
.as-level {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-muted);
}
.as-level input {
  width: 110px;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.as-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.as-pieces {
  display: flex;
  align-items: center;
  gap: 8px;
}
.as-pieces-label {
  font-size: 13px;
  color: var(--color-text-muted);
}
.as-chip {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.as-chip:hover {
  border-color: var(--color-primary);
}
.as-chip.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.as-caption {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
.as-table {
  padding: 0;
  overflow: hidden;
}
.as-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.as-table thead th {
  background: var(--bg-panel);
  color: var(--color-text-muted);
  font-weight: 600;
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}
.as-table tbody td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--color-text);
}
.as-table tbody tr:hover {
  background: var(--bg-panel);
}
.as-table tbody tr.best {
  background: rgba(233, 69, 96, 0.08);
}
.as-table tbody tr.best .c-name {
  color: var(--color-primary);
  font-weight: 600;
}
.c-rank {
  width: 64px;
  text-align: center;
  color: var(--color-text-muted);
}
.c-num {
  text-align: right;
}
.c-bonus {
  font-weight: 700;
  color: var(--color-text);
}
.c-active {
  font-weight: 700;
  color: var(--color-primary);
}
.c-name {
  font-weight: 600;
}
.c-skill {
  color: var(--color-text-muted);
}
.as-star {
  color: var(--color-warning);
  font-weight: 700;
  font-size: 12px;
}
.as-impact {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
}
.as-impact.正 {
  color: var(--color-success);
  background: rgba(67, 160, 71, 0.14);
}
.as-impact.负 {
  color: var(--color-warning);
  background: rgba(233, 69, 96, 0.12);
}
.as-impact.无 {
  color: var(--color-text-muted);
  background: var(--bg-panel);
}
.as-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 24px;
}
</style>
