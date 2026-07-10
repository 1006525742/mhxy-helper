<script setup lang="ts">
import { computed } from 'vue'

interface Coord {
  map: string
  x: number
  y: number
}

const props = defineProps<{
  coords: Coord[]
}>()

const displayCoords = computed(() => props.coords.slice(-30).reverse())
</script>

<template>
  <div class="coord-list">
    <div class="header">
      <span>📍 收集的坐标 ({{ coords.length }})</span>
      <button class="btn btn-danger btn-sm" @click="$emit('clear')" v-if="coords.length > 0">
        清空
      </button>
    </div>

    <div class="list" v-if="displayCoords.length > 0">
      <div class="coord-item" v-for="(c, i) in displayCoords" :key="i">
        <span class="map">{{ c.map }}</span>
        <span class="xy">({{ c.x }},{{ c.y }})</span>
      </div>
    </div>

    <div class="empty" v-else>
      <p>暂无坐标</p>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--color-primary);
  font-weight: bold;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 11px;
}

.list {
  font-size: 11px;
  max-height: 200px;
  overflow-y: auto;
}

.coord-item {
  background: var(--bg-card);
  padding: 6px;
  margin-bottom: 4px;
  border-radius: 4px;
  border-left: 3px solid var(--color-success);
  display: flex;
  justify-content: space-between;
}

.coord-item .map {
  color: var(--color-secondary);
  font-weight: bold;
}

.coord-item .xy {
  color: var(--color-success);
}

.empty p {
  color: var(--color-text-muted);
  text-align: center;
  padding: 20px;
}
</style>