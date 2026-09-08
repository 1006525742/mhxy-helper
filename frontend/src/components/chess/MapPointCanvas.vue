<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

export interface GameCoord {
  name: string
  x: number
  y: number
}

export interface MapDef {
  id: string
  name: string
  image: string
  maxX: number
  maxY: number
}

const props = defineProps<{
  map: MapDef
  points: GameCoord[]
}>()

const imgRef = ref<HTMLImageElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const loaded = ref(false)

/**
 * 核心绘制：游戏坐标 → canvas 像素
 * px = x * sx, py = (maxY - y) * sy （Y 轴翻转：游戏 y 向上为正）
 */
const draw = () => {
  const img = imgRef.value
  const c = canvasRef.value
  if (!img || !c || !loaded.value) return

  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, c.width, c.height)
  const sx = c.width / props.map.maxX
  const sy = c.height / props.map.maxY

  props.points.forEach((p) => {
    const px = p.x * sx
    const py = (props.map.maxY - p.y) * sy
    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.arc(px, py, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
  })
}

const onImgLoad = () => {
  loaded.value = true
  draw()
}

watch(
  () => [props.map.id, props.points],
  () => {
    if (loaded.value) draw()
  },
  { deep: true }
)

onMounted(draw)
</script>

<template>
  <div class="map-container">
    <img
      ref="imgRef"
      :src="map.image"
      :alt="map.name"
      class="map-image"
      @load="onImgLoad"
    />
    <canvas ref="canvasRef" class="map-overlay" />
  </div>
</template>

<style scoped>
.map-container {
  position: relative;
  display: inline-block;
  max-height: 500px;
  max-width: 100%;
  overflow: auto;
  background: #0a0e18;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}
.map-image {
  display: block;
  width: auto;
  height: auto;
  max-width: none;
}
.map-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
</style>
