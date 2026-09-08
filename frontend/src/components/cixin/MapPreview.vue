<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { CIXIN_MAPS, CIXIN_MAP_BORDER } from '@/services/cixinMaps'
import type { OthelloCoordinate } from '@/services/cixinApi'

type MapCfg = (typeof CIXIN_MAPS)[string]

const props = defineProps<{
  coordinate: OthelloCoordinate | null
}>()

/** 绘制完成后通知父组件（含底图异步加载），用于内联缩放重新适配 */
const emit = defineEmits<{
  drawn: [size: { w: number; h: number }]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const missing = ref(false)
const missingReason = ref('')

// 底图缓存 + 动画循环（落点呼吸效果，确保醒目）
const border = CIXIN_MAP_BORDER
let imgCache: HTMLImageElement | null = null
let currentMapName = ''
let currentCfg: MapCfg | null = null
let raf = 0
let t0 = 0

function baseUrl(): string {
  return import.meta.env.BASE_URL || '/'
}

function drawPin(ctx: CanvasRenderingContext2D, coord: OthelloCoordinate, cfg: MapCfg, time: number) {
  const iw = imgCache!.naturalWidth
  const ih = imgCache!.naturalHeight
  const scaleW = cfg.width / iw
  const scaleH = cfg.height / ih
  // 与 ghost_predictor 一致的变换：px = x*imgW/gameW + border; py = imgH + border - y*imgH/gameH
  const px = coord.x / scaleW + border
  const py = ih + border - coord.y / scaleH
  const baseR = Math.max(10, Math.min(18, iw * 0.035))
  const p = Math.sin(time * 3) * 0.5 + 0.5 // 0..1 呼吸
  // 扩散黄环（醒目引导）
  const ringR = baseR * (1.4 + p * 0.7)
  ctx.beginPath()
  ctx.arc(px, py, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(255, 206, 58, ${0.55 * (1 - p)})`
  ctx.lineWidth = 3
  ctx.stroke()
  // 黄圈（常亮 + 黄色外发光）
  ctx.save()
  ctx.beginPath()
  ctx.arc(px, py, baseR, 0, Math.PI * 2)
  ctx.shadowColor = 'rgba(255, 206, 58, 0.95)'
  ctx.shadowBlur = 14
  ctx.lineWidth = 4
  ctx.strokeStyle = '#ffce3a'
  ctx.stroke()
  ctx.restore()
  // 白子（白→浅灰径向渐变，与棋盘推荐点一致）
  const g = ctx.createRadialGradient(px - baseR * 0.35, py - baseR * 0.35, baseR * 0.15, px, py, baseR)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(1, '#d4d4d4')
  ctx.beginPath()
  ctx.arc(px, py, baseR - 2, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
}

function ensureAnim() {
  if (raf) return
  t0 = performance.now()
  const loop = (now: number) => {
    const canvas = canvasRef.value
    const coord = props.coordinate
    if (canvas && imgCache) {
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(imgCache, border, border)
      if (coord && currentCfg) drawPin(ctx, coord, currentCfg, (now - t0) / 1000)
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
}

function cancelAnim() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function clearCanvas(canvas: HTMLCanvasElement) {
  cancelAnim()
  imgCache = null
  currentMapName = ''
  currentCfg = null
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  emit('drawn', { w: 0, h: 0 })
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const coord = props.coordinate
  if (!coord) {
    missing.value = false
    clearCanvas(canvas)
    return
  }
  const cfg = CIXIN_MAPS[coord.mapName]
  if (!cfg || !cfg.available || !cfg.file) {
    missing.value = true
    missingReason.value =
      cfg && cfg.file
        ? `「${coord.mapName}」有底图但缺游戏尺寸配置`
        : `「${coord.mapName}」底图缺失，待补充图片`
    clearCanvas(canvas)
    return
  }
  missing.value = false
  // 同图短路：底图已缓存，直接复用并保活动画
  if (imgCache && currentMapName === coord.mapName) {
    ensureAnim()
    emit('drawn', { w: canvas.width, h: canvas.height })
    return
  }
  const img = new Image()
  img.onload = () => {
    imgCache = img
    currentMapName = coord.mapName
    currentCfg = cfg
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    canvas.width = iw + border * 2
    canvas.height = ih + border * 2
    ensureAnim()
    emit('drawn', { w: canvas.width, h: canvas.height })
  }
  img.onerror = () => {
    missing.value = true
    missingReason.value = `「${coord.mapName}」底图加载失败`
    clearCanvas(canvas)
  }
  img.src = `${baseUrl()}cixin-maps/${cfg.file}`
}

onMounted(draw)
watch(() => props.coordinate, draw, { deep: true })
onUnmounted(cancelAnim)

// 暴露渲染 canvas 给父组件（用于浏览器原生画中画：复制 canvas → captureStream → video → PiP）
defineExpose({
  getCanvas: () => canvasRef.value,
  hasContent: () => !!imgCache
})
</script>

<template>
  <div class="map-preview">
    <canvas ref="canvasRef" class="map-canvas" />
    <div v-if="missing" class="map-missing">
      <div class="mm-title">{{ coordinate?.mapName ?? '无地图' }}</div>
      <div class="mm-coord" v-if="coordinate">坐标 ({{ coordinate.x }}, {{ coordinate.y }})</div>
      <div class="mm-reason">{{ missingReason }}</div>
    </div>
    <div v-if="!coordinate && !missing" class="map-empty">等待 AI 给出落点坐标…</div>
  </div>
</template>

<style scoped>
.map-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.map-canvas {
  max-width: 100%;
  border-radius: 8px;
  background: #0f3460;
  border: 1px solid var(--border-color, #2a4d7a);
}
.map-missing,
.map-empty {
  font-size: 13px;
  color: var(--color-text-muted, #9bb);
  text-align: center;
}
.mm-title {
  font-weight: 700;
  color: var(--color-text, #eee);
}
.mm-coord {
  color: #ff8a9b;
}
.mm-reason {
  font-size: 12px;
  opacity: 0.8;
}
</style>
