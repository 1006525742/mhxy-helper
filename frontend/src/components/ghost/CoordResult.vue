<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  mapName: string
  x: number
  y: number
  positionAreas: string[]
  cornerAreas: string[]
  confidence: number
}>()

const hasResult = computed(() => props.mapName && props.x > 0)
const confidencePercent = computed(() => Math.round(props.confidence * 100))
</script>

<template>
  <div class="coord-result card" v-if="hasResult">
    <h3>🎯 当前识别</h3>

    <div class="map-name">{{ mapName }}</div>
    <div class="coord">{{ x }}, {{ y }}</div>

    <div class="areas">
      <div class="area-item" v-if="positionAreas.length > 0">
        <span class="label">预测区域</span>
        <span class="value">{{ positionAreas.join(', ') }}</span>
      </div>
      <div class="area-item" v-if="cornerAreas.length > 0">
        <span class="label">角落区域</span>
        <span class="value">{{ cornerAreas.join(', ') }}</span>
      </div>
    </div>

    <div class="confidence-bar">
      <div
        class="confidence-fill"
        :style="{ width: confidencePercent + '%' }"
      ></div>
    </div>
  </div>

  <div class="coord-result card placeholder" v-else>
    <h3>🎯 当前识别</h3>
    <p>等待识别...</p>
  </div>
</template>

<style scoped>
.coord-result {
  text-align: center;
}

.map-name {
  font-size: 18px;
  color: var(--color-success);
  margin-bottom: 10px;
}

.coord {
  font-size: 24px;
  color: var(--color-secondary);
  font-weight: bold;
  margin: 10px 0;
}

.areas {
  margin-top: 10px;
}

.area-item {
  background: var(--bg-input);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.area-item .label {
  color: var(--color-text-muted);
}

.area-item .value {
  color: var(--color-secondary);
  font-weight: bold;
}

.confidence-bar {
  height: 4px;
  background: var(--border-color);
  border-radius: 2px;
  margin-top: 10px;
  overflow: hidden;
}

.confidence-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-success), var(--color-secondary));
  transition: width 0.3s;
}

.placeholder p {
  color: var(--color-text-muted);
  text-align: center;
  padding: 20px;
}
</style>