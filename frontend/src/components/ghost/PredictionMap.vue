<script setup lang="ts">
defineProps<{
  annotatedImage: string
}>()
</script>

<template>
  <div class="prediction-map card" v-if="annotatedImage">
    <h3>🗺️ 预测地图</h3>
    <div class="map-container">
      <img :src="'data:image/png;base64,' + annotatedImage" alt="预测地图" />
    </div>
  </div>
</template>

<style scoped>
.prediction-map {
  text-align: center;
}

.map-container img {
  max-width: 100%;
  border-radius: 8px;
  border: 2px solid var(--border-color);
}
</style>