<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  slots: Array<{
    slot: number
    item?: string
    coord?: string
    confidence?: number
  }>
}>()

const displaySlots = computed(() => {
  const result = []
  for (let i = 1; i <= 20; i++) {
    const slotData = props.slots.find(s => s.slot === i)
    result.push({
      num: i,
      ...slotData
    })
  }
  return result
})
</script>

<template>
  <div class="inventory-grid">
    <div
      v-for="slot in displaySlots"
      :key="slot.num"
      class="inventory-slot"
      :class="{ 'has-item': slot.item }"
    >
      <div class="slot-num">{{ slot.num }}</div>
      <div v-if="slot.coord" class="coord-text">{{ slot.coord }}</div>
      <div v-if="slot.confidence" class="conf">{{ Math.round(slot.confidence * 100) }}%</div>
    </div>
  </div>
</template>

<style scoped>
.inventory-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: 6px;
  background: var(--bg-input);
  padding: 10px;
  border-radius: 8px;
}

.inventory-slot {
  background: var(--bg-card);
  border: 2px solid var(--border-color);
  border-radius: 6px;
  padding: 6px;
  text-align: center;
  min-height: 55px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: all 0.2s;
}

.inventory-slot:hover {
  border-color: var(--color-secondary);
}

.inventory-slot.has-item {
  border-color: var(--color-success);
  background: #1b5e20;
}

.slot-num {
  font-size: 10px;
  color: #555;
}

.coord-text {
  font-size: 11px;
  color: var(--color-secondary);
  font-weight: bold;
  word-break: break-all;
}

.conf {
  font-size: 9px;
  color: var(--color-success);
}
</style>