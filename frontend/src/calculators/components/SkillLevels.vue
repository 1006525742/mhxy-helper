<script setup lang="ts">
import { computed } from 'vue'
import type { LevelCostSlot } from '@/calculators/engine/types'
import type { CalcResult } from '@/calculators/services/calcEngine'
import { fmtWan, fmtRMB } from '@/calculators/engine/format'

const props = defineProps<{
  slots: LevelCostSlot[]
  levels: Record<string, { from: number; to: number }>
  min: number
  max: number
  result: CalcResult
  title?: string
  // 召唤兽修炼：额外显示「修炼果」列与合计果数
  showFruit?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', key: string, part: 'from' | 'to', val: number): void
}>()

// 按 slot.key 取每行成本（perSlot 与 slots 同序）
const costMap = computed(() => {
  const m: Record<string, { wan: number; rmb: number; fruit?: number }> = {}
  for (const s of props.result.perSlot) m[s.key] = { wan: s.moneyWan, rmb: s.rmb, fruit: s.fruitCount }
  return m
})

// 修炼果显示：保留 1 位小数（对齐估价表依赖1 的「需要修炼果个数」列口径）
function fmtFruit(n?: number): string {
  if (n == null) return '-'
  return n.toFixed(1)
}

function onInput(key: string, part: 'from' | 'to', e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  emit('update', key, part, isFinite(v) ? v : 0)
}
</script>

<template>
  <div class="skill-levels card" :class="{ 'has-fruit': props.showFruit }">
    <div class="sl-head">
      <span class="sl-name">{{ props.title ?? '师门技能' }}</span>
      <span>起始等级</span>
      <span>目标等级</span>
      <span class="sl-num" v-if="props.showFruit">修炼果</span>
      <span class="sl-num">梦幻币</span>
      <span class="sl-num">人民币</span>
    </div>

    <div class="sl-row" v-for="s in slots" :key="s.key">
      <span class="sl-name">{{ s.label }}</span>
      <input
        class="sl-inp"
        type="number"
        :value="levels[s.key]?.from ?? min"
        @input="onInput(s.key, 'from', $event)"
        :min="min"
        :max="s.maxLevel ?? max"
        step="1"
      />
      <input
        class="sl-inp"
        type="number"
        :value="levels[s.key]?.to ?? min"
        @input="onInput(s.key, 'to', $event)"
        :min="min"
        :max="s.maxLevel ?? max"
        step="1"
      />
      <span class="sl-num sl-fruit" v-if="props.showFruit">{{ fmtFruit(costMap[s.key]?.fruit) }}</span>
      <span class="sl-num sl-wan">{{ fmtWan(costMap[s.key]?.wan ?? 0) }}</span>
      <span class="sl-num sl-rmb">{{ fmtRMB(costMap[s.key]?.rmb ?? 0) }}</span>
    </div>

    <div class="sl-total">
      <span class="sl-total-label">合计（{{ slots.length }} 项汇总）</span>
      <span class="sl-total-fruit" v-if="props.showFruit">{{ fmtFruit(result.fruitCount) }} 果</span>
      <span class="sl-total-wan">{{ fmtWan(result.totalWan) }}</span>
      <span class="sl-total-rmb">{{ fmtRMB(result.totalRMB) }}</span>
    </div>
  </div>
</template>

<style scoped>
.skill-levels {
  background: var(--bg-panel);
  padding: 14px 16px;
}
.sl-head,
.sl-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1.3fr 1.3fr;
  align-items: center;
  gap: 10px;
}
/* 召唤兽修炼：多一列「修炼果」 */
.has-fruit .sl-head,
.has-fruit .sl-row {
  grid-template-columns: 1.4fr 1fr 1fr 0.9fr 1.3fr 1.3fr;
}
.sl-head {
  font-size: 12px;
  color: var(--color-secondary);
  font-weight: 600;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}
.sl-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
}
.sl-name {
  color: var(--color-text);
  font-weight: 600;
}
.sl-inp {
  width: 100%;
  padding: 7px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.sl-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.sl-wan {
  color: var(--color-text);
}
.sl-rmb {
  color: var(--color-warning);
}
.sl-fruit {
  color: var(--color-success);
}
.sl-total {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 2px solid var(--border-color);
}
.sl-total-label {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-muted);
}
.sl-total-fruit {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-success);
}
.sl-total-wan {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-primary);
}
.sl-total-rmb {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-warning);
}
</style>
