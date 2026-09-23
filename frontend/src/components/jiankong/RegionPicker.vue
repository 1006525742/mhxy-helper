<script setup lang="ts">
/**
 * 可视化拖拽选框组件（对齐原站 mhxyai.com 选区交互）
 * - 在选框内部按下 = 整体移动
 * - 在四角手柄按下 = 调整大小
 * - 在空白区按下 = 重新框选
 * 坐标以「相对比例 0~1」存储，天然适配任何显示缩放，监控时乘以视频实际分辨率。
 *
 * 可选 dets / showBoxes：用于叠加 YOLO 检测框（归一化全屏坐标 0~1），
 * 与预览图同屏比例，自动对齐。
 */
import { ref, watch, computed } from 'vue'

interface DetBox {
  className: string
  classId: number
  conf: number
  nx1: number
  ny1: number
  nx2: number
  ny2: number
}

const props = withDefaults(
  defineProps<{
    previewSrc?: string
    dets?: DetBox[]
    showBoxes?: boolean
  }>(),
  { previewSrc: '', dets: () => [], showBoxes: true }
)

interface Ratio {
  x: number
  y: number
  w: number
  h: number
}

const ratio = ref<Ratio>({ x: 0.3, y: 0.35, w: 0.4, h: 0.3 })
const containerRef = ref<HTMLElement | null>(null)

type Mode = 'create' | 'move' | 'nw' | 'ne' | 'sw' | 'se'
let mode: Mode = 'create'
let sx = 0
let sy = 0
let origin: Ratio = { x: 0, y: 0, w: 0, h: 0 }

function toLocal(e: PointerEvent) {
  const r = containerRef.value!.getBoundingClientRect()
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  return { x, y }
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function down(e: PointerEvent, m: Mode) {
  e.preventDefault()
  e.stopPropagation()
  mode = m
  const p = toLocal(e)
  sx = p.x
  sy = p.y
  origin = { ...ratio.value }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function move(e: PointerEvent) {
  const p = toLocal(e)
  const dx = p.x - sx
  const dy = p.y - sy
  if (mode === 'create') {
    ratio.value = {
      x: Math.min(sx, p.x),
      y: Math.min(sy, p.y),
      w: Math.abs(dx),
      h: Math.abs(dy)
    }
  } else if (mode === 'move') {
    ratio.value = {
      ...origin,
      x: clamp(origin.x + dx, 0, 1 - origin.w),
      y: clamp(origin.y + dy, 0, 1 - origin.h)
    }
  } else {
    let { x, y, w, h } = origin
    const right = origin.x + origin.w
    const bottom = origin.y + origin.h
    if (mode.includes('w')) {
      x = clamp(p.x, 0, right - 0.02)
      w = right - x
    }
    if (mode.includes('e')) {
      w = clamp(p.x - origin.x, 0.02, 1 - origin.x)
    }
    if (mode.includes('n')) {
      y = clamp(p.y, 0, bottom - 0.02)
      h = bottom - y
    }
    if (mode.includes('s')) {
      h = clamp(p.y - origin.y, 0.02, 1 - origin.y)
    }
    ratio.value = { x, y, w, h }
  }
}

function up() {
  mode = 'create'
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', up)
}

/* ---------- YOLO 检测框叠加 ---------- */
const canvasRef = ref<HTMLCanvasElement | null>(null)
const natW = ref(0)
const natH = ref(0)

/* 预览显示上限：绝不放大到超过源分辨率（否则会比游戏窗口还大）；
   同时限制最大高度，避免高窗口把页面撑得过长。 */
const MAX_PREVIEW_H = 480
const previewMaxW = computed(() => {
  const w = natW.value
  const h = natH.value
  if (!w || !h) return ''
  const scaled = h > MAX_PREVIEW_H ? Math.round((w * MAX_PREVIEW_H) / h) : w
  return Math.min(w, scaled) + 'px'
})

function colorOf(cls: string): string {
  if (cls === '自动战斗') return '#42b983'
  if (cls === '四小人') return '#ff9800'
  return '#3aa0ff'
}

function draw() {
  const cv = canvasRef.value
  if (!cv || !natW.value) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  cv.width = natW.value
  cv.height = natH.value
  ctx.clearRect(0, 0, cv.width, cv.height)
  if (!props.showBoxes) return
  for (const d of props.dets) {
    const x = d.nx1 * cv.width
    const y = d.ny1 * cv.height
    const w = (d.nx2 - d.nx1) * cv.width
    const h = (d.ny2 - d.ny1) * cv.height
    const c = colorOf(d.className)
    const lw = Math.max(2, cv.width / 320)
    ctx.lineWidth = lw
    ctx.strokeStyle = c
    ctx.strokeRect(x, y, w, h)
    const label = `${d.className} ${Math.round(d.conf * 100)}%`
    const fs = Math.max(13, Math.round(cv.width / 42))
    ctx.font = `${fs}px sans-serif`
    const tw = ctx.measureText(label).width
    const lh = fs + 6
    ctx.fillStyle = c
    ctx.fillRect(x, y - lh, tw + 8, lh)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 4, y - 4)
  }
}

function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natW.value = img.naturalWidth
  natH.value = img.naturalHeight
  draw()
}

watch(
  () => [props.dets, props.showBoxes, props.previewSrc],
  () => draw(),
  { deep: true }
)

function containerDown(e: PointerEvent) {
  // 选框/手柄已 stopPropagation，能到这里说明点的是空白区 → 重新框选
  down(e, 'create')
}

defineExpose({
  /** 返回选区的相对比例（0~1），监控时乘以视频实际分辨率即可 */
  getRegionRatio: (): Ratio => ({ ...ratio.value })
})
</script>

<template>
  <div
    class="picker"
    ref="containerRef"
    :class="{ empty: !previewSrc }"
    :style="previewMaxW ? { maxWidth: previewMaxW } : undefined"
    @pointerdown="containerDown"
  >
    <img v-if="previewSrc" :src="previewSrc" class="picker-img" draggable="false" alt="屏幕共享预览" @load="onImgLoad" />
    <canvas v-if="previewSrc" ref="canvasRef" class="det-canvas"></canvas>
    <div v-else class="picker-placeholder">
      🖥 开始屏幕共享后，在此拖动红色框选择监控区域
    </div>

    <div
      v-if="previewSrc"
      class="selection-box"
      :style="{
        left: ratio.x * 100 + '%',
        top: ratio.y * 100 + '%',
        width: ratio.w * 100 + '%',
        height: ratio.h * 100 + '%'
      }"
      @pointerdown="down($event, 'move')"
    >
      <span class="sel-label">监控区 · 可拖动 / 缩放</span>
      <span class="handle handle-nw" @pointerdown="down($event, 'nw')"></span>
      <span class="handle handle-ne" @pointerdown="down($event, 'ne')"></span>
      <span class="handle handle-sw" @pointerdown="down($event, 'sw')"></span>
      <span class="handle handle-se" @pointerdown="down($event, 'se')"></span>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  width: 100%;
  margin-inline: auto;
  background: #000;
  border: 1px solid var(--site-border, rgba(180, 150, 100, 0.4));
  border-radius: 10px;
  overflow: hidden;
  line-height: 0;
  user-select: none;
  touch-action: none;
}
.picker.empty {
  cursor: default;
  min-height: 260px;
}
.picker-img {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}
.det-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.picker-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  font-size: 14px;
  color: #8a7a66;
  background: var(--site-surface, #fffdf7);
  line-height: 1.6;
}
.selection-box {
  position: absolute;
  border: 2px solid #ff3b30;
  background: rgba(255, 59, 48, 0.1);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.42);
  cursor: move;
  touch-action: none;
}
.sel-label {
  position: absolute;
  top: -22px;
  left: 0;
  font-size: 11px;
  color: #fff;
  background: #ff3b30;
  padding: 2px 6px;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
  line-height: 1.3;
  pointer-events: none;
}
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, #c49b2a, #96700a);
  border: 1.5px solid #fff;
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(180, 130, 50, 0.4);
}
.handle-nw { left: -6px; top: -6px; cursor: nwse-resize; }
.handle-ne { right: -6px; top: -6px; cursor: nesw-resize; }
.handle-sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
.handle-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
</style>
