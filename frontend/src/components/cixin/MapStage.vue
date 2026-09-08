<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import MapPreview from '@/components/cixin/MapPreview.vue'
import type { OthelloCoordinate } from '@/services/cixinApi'

const props = withDefaults(defineProps<{
  coordinate: OthelloCoordinate | null
  /** 视口高度（px），内联面板与画中画可不同 */
  viewportHeight?: number
  /** 是否启用内部缩放/平移：内联面板用 true；画中画用整窗缩放，传 false */
  zoomable?: boolean
}>(), {
  viewportHeight: 440,
  zoomable: true
})

const mapViewportRef = ref<HTMLElement | null>(null)
const mapZoomRef = ref<HTMLElement | null>(null)
const previewRef = ref<InstanceType<typeof MapPreview> | null>(null)
const mapZoom = ref(1)
const mapPanX = ref(0)
const mapPanY = ref(0)
const MAP_MIN = 0.5
const MAP_MAX = 6

// 转发内部 MapPreview 的 canvas（用于浏览器原生画中画）
defineExpose({
  getCanvas: () => previewRef.value?.getCanvas?.() ?? null,
  hasContent: () => previewRef.value?.hasContent?.() ?? false
})


function mapMeasure() {
  const el = mapZoomRef.value
  const vp = mapViewportRef.value
  if (!el || !vp) return null
  const bW = el.offsetWidth
  const bH = el.offsetHeight
  if (!bW || !bH) return null
  const aw = vp.clientWidth
  const ah = vp.clientHeight
  const fit = Math.min(aw / bW, ah / bH, 1)
  return { bW, bH, aw, ah, fit }
}
function mapApplyView() {
  const m = mapMeasure()
  if (!m) return
  const z = mapZoom.value * m.fit
  const cw = m.bW * z
  const ch = m.bH * z
  const limX = Math.max(0, (cw - m.aw) / 2)
  const limY = Math.max(0, (ch - m.ah) / 2)
  mapPanX.value = Math.max(-limX, Math.min(limX, mapPanX.value))
  mapPanY.value = Math.max(-limY, Math.min(limY, mapPanY.value))
  const el = mapZoomRef.value!
  el.style.transform = `translate(${mapPanX.value}px, ${mapPanY.value}px) scale(${z})`
}
// 以指定锚点（视口内坐标）为基准做等比例缩放，保持锚点下的内容点不动
function mapZoomAt(factor: number, anchorX: number, anchorY: number) {
  if (!props.zoomable) return
  const oldZoom = mapZoom.value
  const newZoom = Math.max(MAP_MIN, Math.min(MAP_MAX, oldZoom * factor))
  if (newZoom === oldZoom) return
  // 缩放前后锚点下的内容坐标不变：pan' = anchor - (anchor - pan) * (newZoom / oldZoom)
  mapPanX.value = anchorX - (anchorX - mapPanX.value) * (newZoom / oldZoom)
  mapPanY.value = anchorY - (anchorY - mapPanY.value) * (newZoom / oldZoom)
  mapZoom.value = newZoom
  mapApplyView()
}
// 按钮缩放：以视口中心为锚点
function mapZoomBy(factor: number) {
  if (!props.zoomable) return
  const m = mapMeasure()
  mapZoomAt(factor, m ? m.aw / 2 : 0, m ? m.ah / 2 : 0)
}
function mapResetView() {
  mapZoom.value = 1
  const m = mapMeasure()
  if (m) {
    const z = m.fit
    mapPanX.value = (m.aw - m.bW * z) / 2
    mapPanY.value = (m.ah - m.bH * z) / 2
  }
  mapApplyView()
}
function mapOnWheel(e: WheelEvent) {
  if (!props.zoomable) return
  e.preventDefault()
  const vp = mapViewportRef.value
  if (!vp) return
  const rect = vp.getBoundingClientRect()
  // 以鼠标指针为锚点做等比例缩放
  mapZoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top)
}
let mdrag = false
let mlx = 0
let mly = 0
function mapDragDown(e: MouseEvent) {
  if (!props.zoomable) return
  mdrag = true
  mlx = e.clientX
  mly = e.clientY
  window.addEventListener('mousemove', mapDragMove)
  window.addEventListener('mouseup', mapDragUp)
}
function mapDragMove(e: MouseEvent) {
  if (!mdrag) return
  mapPanX.value += e.clientX - mlx
  mapPanY.value += e.clientY - mly
  mlx = e.clientX
  mly = e.clientY
  mapApplyView()
}
function mapDragUp() {
  mdrag = false
  window.removeEventListener('mousemove', mapDragMove)
  window.removeEventListener('mouseup', mapDragUp)
}
function onMapDrawn(size: { w: number; h: number }) {
  if (size.w > 0 && size.h > 0) {
    requestAnimationFrame(() => mapResetView())
  } else {
    mapZoom.value = 1
    mapPanX.value = 0
    mapPanY.value = 0
    mapApplyView()
  }
}
// 视口高度变化（如画中画整窗缩放）时重新适配
watch(() => props.viewportHeight, () => requestAnimationFrame(mapResetView))
onMounted(() => {
  requestAnimationFrame(() => mapResetView())
})
</script>

<template>
  <div
    class="map-viewport"
    ref="mapViewportRef"
    :class="{ 'no-zoom': !zoomable }"
    @wheel.prevent="mapOnWheel"
    :style="{ height: viewportHeight + 'px' }"
  >
    <div class="map-zoom" ref="mapZoomRef" @mousedown.prevent="mapDragDown">
      <MapPreview ref="previewRef" :coordinate="coordinate" @drawn="onMapDrawn" />
    </div>
    <div class="zoom-ctrl" v-if="zoomable">
      <button type="button" title="放大" @click="mapZoomBy(1.25)">＋</button>
      <button type="button" title="缩小" @click="mapZoomBy(1 / 1.25)">－</button>
      <button type="button" title="重置视图" @click="mapResetView">⤢</button>
      <span class="zoom-val">{{ Math.round(mapZoom * 100) }}%</span>
    </div>
  </div>
</template>

<style scoped>
/* 地图：内联视口 + 角落缩放控件（与挖图助手一致） */
.map-viewport {
  position: relative;
  width: 100%;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  border: 1px solid var(--border-color, #2a4d7a);
}
.map-viewport:active {
  cursor: grabbing;
}
.map-viewport.no-zoom {
  cursor: default;
}
.map-zoom {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
  display: flex;
  align-items: center;
  justify-content: center;
}
.zoom-ctrl {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.5);
  padding: 4px;
  border-radius: 8px;
  z-index: 2;
}
.zoom-ctrl button {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color, #2a4d7a);
  background: var(--bg-input, #0f3460);
  color: var(--color-text, #eee);
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.zoom-ctrl button:hover {
  border-color: var(--color-primary, #4fc3f7);
}
.zoom-val {
  font-size: 11px;
  color: #cfe8ff;
  min-width: 36px;
  text-align: center;
}
</style>
