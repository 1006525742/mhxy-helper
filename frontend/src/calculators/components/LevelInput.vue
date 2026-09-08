<script setup lang="ts">
import type { LevelModel } from '@/calculators/engine/types'

const model = defineModel<LevelModel>({ required: true })

defineProps<{
  min: number
  max: number
  fromLabel?: string
  toLabel?: string
}>()

function set(part: keyof LevelModel, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  model.value = { ...model.value, [part]: isFinite(v) ? v : 0 }
}
</script>

<template>
  <div class="level-input card">
    <div class="li-grid">
      <label class="li-field">
        <span>{{ fromLabel ?? '起始等级' }}</span>
        <input type="number" :value="model.from" @input="set('from', $event)" :min="min" :max="max" step="1" />
      </label>
      <span class="li-arrow">→</span>
      <label class="li-field">
        <span>{{ toLabel ?? '目标等级' }}</span>
        <input type="number" :value="model.to" @input="set('to', $event)" :min="min" :max="max" step="1" />
      </label>
      <label class="li-field">
        <span>数量</span>
        <input type="number" :value="model.count" @input="set('count', $event)" min="1" step="1" />
      </label>
    </div>
  </div>
</template>

<style scoped>
.level-input {
  background: var(--bg-panel);
}
.li-grid {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.li-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.li-field input {
  width: 100px;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.li-arrow {
  color: var(--color-secondary);
  font-size: 18px;
  padding-bottom: 8px;
}
</style>
