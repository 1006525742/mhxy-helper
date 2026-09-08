<script setup lang="ts">
import type { CixinStrength } from '@/stores/cixinStore'

defineProps<{
  modelValue: CixinStrength
}>()
const emit = defineEmits<{
  'update:modelValue': [value: CixinStrength]
}>()

const options: Array<{ value: CixinStrength; label: string; desc: string }> = [
  { value: 'strong', label: '标准', desc: '10 层 · 较稳' },
  { value: 'ultra', label: '强力', desc: '12 层 · 更准更慢' }
]

function select(v: CixinStrength) {
  emit('update:modelValue', v)
}
</script>

<template>
  <div class="strength-control">
    <span class="label">棋力</span>
    <div class="seg">
      <button
        v-for="o in options"
        :key="o.value"
        class="seg-btn"
        :class="{ active: modelValue === o.value }"
        :title="o.desc"
        @click="select(o.value)"
      >
        {{ o.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.strength-control {
  display: flex;
  align-items: center;
  gap: 10px;
}
.label {
  font-size: 13px;
  color: var(--color-text-muted, #9bb);
}
.seg {
  display: flex;
  border: 1px solid var(--border-color, #2a4d7a);
  border-radius: 6px;
  overflow: hidden;
}
.seg-btn {
  background: transparent;
  color: var(--color-text-muted, #9bb);
  border: none;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.seg-btn.active {
  background: var(--color-primary, #4fc3f7);
  color: #06283d;
  font-weight: 700;
}
</style>
