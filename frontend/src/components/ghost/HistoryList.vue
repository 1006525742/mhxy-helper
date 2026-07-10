<script setup lang="ts">
import { computed } from 'vue'

interface HistoryItem {
  time: string
  map: string
  x: number
  y: number
}

const props = defineProps<{
  history: HistoryItem[]
}>()

const displayHistory = computed(() => props.history.slice(0, 20))
</script>

<template>
  <div class="history-list card">
    <h3>📜 识别历史</h3>

    <div class="list" v-if="displayHistory.length > 0">
      <div
        class="history-item"
        v-for="(item, index) in displayHistory"
        :key="index"
      >
        <div class="time">{{ item.time }}</div>
        <div class="info">{{ item.map }} ({{ item.x }}, {{ item.y }})</div>
      </div>
    </div>

    <div class="empty" v-else>
      <p>暂无记录</p>
    </div>
  </div>
</template>

<style scoped>
.history-list {
  max-height: 400px;
  overflow-y: auto;
}

.list {
  font-size: 12px;
}

.history-item {
  background: var(--bg-input);
  padding: 8px 10px;
  border-radius: 4px;
  margin-bottom: 6px;
  border-left: 3px solid var(--color-secondary);
}

.history-item .time {
  color: #666;
  font-size: 11px;
}

.history-item .info {
  color: var(--color-text);
  margin-top: 4px;
}

.empty p {
  color: var(--color-text-muted);
  text-align: center;
  padding: 20px;
}
</style>