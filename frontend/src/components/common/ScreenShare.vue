<script setup lang="ts">
import { ref, computed, onUnmounted, withDefaults, defineProps } from 'vue'
import { ScreenCapture } from '@/services/screenCapture'
import { LABEL_COLORS, type GridCell } from '@/services/fentuLogic'

const props = withDefaults(defineProps<{
  /** 是否在网页中显示监控画面预览。false = 后台监控，网页不展示屏幕 */
  displayPreview?: boolean
  /** 竖条上显示的模块名，如「挖图监控」「分图监控」，用于区分不同模块 */
  label?: string
}>(), {
  displayPreview: true,
  label: '分图监控'
})

const emit = defineEmits<{
  started: []
  stopped: []
  error: [msg: string]
}>()

const screenCapture = new ScreenCapture()
const isSharing = ref(false)
/** 预览浮窗显隐（默认收起，不遮挡界面；点竖条「🖼」展开） */
const showPreviewFloat = ref(false)

/** 竖条文案：未监控=开始监控，监控中=分图监控·监控中 */
const railLabel = computed(() =>
  isSharing.value ? '分图监控·监控中' : '开始监控'
)

const previewImage = ref('')

const imgRef = ref<HTMLImageElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)

let previewLoopId: number | null = null

interface OverlayDetection {
  className: string
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
}
interface OverlayAnchor {
  className: string
  x1: number
  y1: number
  x2: number
  y2: number
}
interface OverlayPayload {
  detections: OverlayDetection[]
  anchor: OverlayAnchor | null
  grid: GridCell[]
}

/**
 * 开始屏幕共享
 */
async function startShare() {
  const success = await screenCapture.start()
  if (success) {
    isSharing.value = true
    emit('started')
    // 仅在需要展示预览时才跑预览循环，节省性能
    if (props.displayPreview) startPreviewLoop()
  } else {
    emit('error', '屏幕共享失败')
  }
}

/**
 * 停止屏幕共享
 */
function stopShare() {
  stopPreviewLoop()
  screenCapture.stop()
  isSharing.value = false
  previewImage.value = ''
  showPreviewFloat.value = false
  emit('stopped')
}

/**
 * 开始预览循环（仅 displayPreview=true 时）
 */
function startPreviewLoop() {
  const loop = () => {
    if (!screenCapture.isActive()) return

    const frame = screenCapture.getPreviewFrame()
    if (frame) {
      previewImage.value = frame
    }

    previewLoopId = requestAnimationFrame(loop)
  }
  loop()
}

/**
 * 停止预览循环
 */
function stopPreviewLoop() {
  if (previewLoopId) {
    cancelAnimationFrame(previewLoopId)
    previewLoopId = null
  }
}

/**
 * 截取指定区域
 */
function captureRegion(x: number, y: number, width: number, height: number): string | null {
  return screenCapture.captureRegion({ x, y, width, height })
}

/**
 * 截取全屏
 */
function captureFull(): string | null {
  return screenCapture.captureFull()
}

/**
 * 获取视频尺寸
 */
function getVideoSize() {
  return screenCapture.getVideoSize()
}

/**
 * 确保屏幕共享 video 仍在播放（页面被遮挡/切后台后浏览器可能暂停，重新 play 恢复帧解码）
 */
function ensurePlaying() {
  screenCapture.ensurePlaying()
}

/** 竖条点击：未监控时开始监控 */
function onRailClick() {
  if (!isSharing.value) startShare()
}

/** 切换预览浮窗显隐 */
function togglePreviewFloat() {
  showPreviewFloat.value = !showPreviewFloat.value
}

/**
 * 在预览画面上叠加绘制检测框 + 物品栏网格 + 宝图格高亮
 */
function drawOverlay(payload: OverlayPayload) {
  const img = imgRef.value
  const cv = overlayRef.value
  if (!img || !cv) return
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return

  cv.width = nw
  cv.height = nh
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, nw, nh)

  const base = Math.max(2, nw / 360)

  // 1) 物品栏网格线（仅在锚框存在时）
  if (payload.anchor) {
    const a = payload.anchor
    const cellW = (a.x2 - a.x1) / 5
    const cellH = (a.y2 - a.y1) / 4

    ctx.strokeStyle = 'rgba(245, 197, 24, 0.85)' // 黄色网格
    ctx.lineWidth = Math.max(1, nw / 720)
    for (let c = 0; c <= 5; c++) {
      const x = a.x1 + c * cellW
      ctx.beginPath(); ctx.moveTo(x, a.y1); ctx.lineTo(x, a.y2); ctx.stroke()
    }
    for (let r = 0; r <= 4; r++) {
      const y = a.y1 + r * cellH
      ctx.beginPath(); ctx.moveTo(a.x1, y); ctx.lineTo(a.x2, y); ctx.stroke()
    }

    // 锚框轮廓
    ctx.strokeStyle = LABEL_COLORS[a.className as keyof typeof LABEL_COLORS] || '#fff'
    ctx.lineWidth = base
    ctx.strokeRect(a.x1, a.y1, a.x2 - a.x1, a.y2 - a.y1)
  }

  // 2) 检测框 + 标签
  for (const d of payload.detections) {
    const color = LABEL_COLORS[d.className as keyof typeof LABEL_COLORS] || '#fff'
    ctx.strokeStyle = color
    ctx.lineWidth = base
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1)

    const label = `${d.className} ${Math.round((d.conf || 0) * 100)}%`
    ctx.font = `${Math.max(12, nw / 52)}px sans-serif`
    const tw = ctx.measureText(label).width
    ctx.fillStyle = color
    ctx.fillRect(d.x1, d.y1 - 16, tw + 6, 16)
    ctx.fillStyle = '#000'
    ctx.fillText(label, d.x1 + 3, d.y1 - 4)
  }

  // 3) 宝图格高亮（grid 中已识别坐标的）
  if (payload.anchor) {
    const a = payload.anchor
    const cellW = (a.x2 - a.x1) / 5
    const cellH = (a.y2 - a.y1) / 4
    for (const cell of payload.grid) {
      if (!cell.isRecognized) continue
      const row = Math.floor(cell.index / 5)
      const col = cell.index % 5
      const x = a.x1 + col * cellW
      const y = a.y1 + row * cellH
      ctx.strokeStyle = '#FF3B30'
      ctx.lineWidth = Math.max(3, nw / 200)
      ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
      ctx.fillStyle = 'rgba(255, 59, 48, 0.22)'
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2)
    }
  }
}

// 暴露方法给父组件
defineExpose({
  captureRegion,
  captureFull,
  getVideoSize,
  drawOverlay,
  startShare,
  stopShare,
  isSharing,
  ensurePlaying,
  togglePreviewFloat
})

onUnmounted(() => {
  stopShare()
})
</script>

<template>
  <div class="monitor-root">
    <!-- 右侧监控竖条：统一入口 + 状态 -->
    <div
      class="monitor-rail"
      :class="{ active: isSharing }"
      title="点击开始监控"
      @click="onRailClick"
    >
      <span class="rail-dot"></span>
      <span class="rail-label">{{ railLabel }}</span>
    </div>

    <!-- 监控中：竖排控制按钮（附在竖条右侧） -->
    <div v-if="isSharing" class="rail-actions">
      <button class="mini-btn" @click.stop="togglePreviewFloat" :title="showPreviewFloat ? '隐藏画面' : '显示画面'">🖼</button>
      <button class="mini-btn" @click.stop="stopShare" title="停止监控">✕</button>
    </div>

    <!-- 预览浮窗（左下角，不挡右侧地图） -->
    <div v-if="isSharing && showPreviewFloat" class="preview-float">
      <div class="pf-head">
        <span>📺 监控画面</span>
        <button class="mini-btn" @click="togglePreviewFloat" title="关闭">✕</button>
      </div>
      <div class="pf-body">
        <img v-if="previewImage" ref="imgRef" :src="previewImage" class="pf-image" />
        <canvas v-show="previewImage" ref="overlayRef" class="overlay"></canvas>
        <span v-if="!previewImage" class="pf-empty">加载预览中…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 右侧监控竖条：固定贴边，不占文档流、不顶内容 */
.monitor-rail {
  position: fixed; left: 0; top: 50%; transform: translateY(-50%);
  z-index: 60; display: flex; flex-direction: column; align-items: center; gap: 6px;
  width: 26px; padding: 12px 4px; cursor: pointer; user-select: none;
  background: var(--bg-card); border: 1px solid var(--border-color); border-left: none;
  border-radius: 0 10px 10px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  transition: background 0.2s, border-color 0.2s;
}
.monitor-rail:hover { background: rgba(255,255,255,0.07); border-color: var(--color-primary); }
.monitor-rail.active { border-color: #f5c518; box-shadow: 0 0 0 1px rgba(245,197,24,0.3); }
.rail-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--color-text-muted); flex-shrink: 0; }
.monitor-rail.active .rail-dot { background: #ff4d4f; box-shadow: 0 0 8px #ff4d4f; animation: pulse 1s infinite; }
.rail-label {
  writing-mode: vertical-rl; text-orientation: upright;
  font-size: 11px; letter-spacing: 2px; color: var(--color-text-muted);
}
.monitor-rail.active .rail-label { color: #f5c518; }

/* 监控中控制按钮（竖排，紧贴竖条右侧） */
.rail-actions {
  position: fixed; left: 32px; top: 50%; transform: translateY(-50%);
  z-index: 60; display: flex; flex-direction: column; gap: 4px;
}
.mini-btn {
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px;
  color: var(--color-text-muted); cursor: pointer; font-size: 13px; line-height: 1;
}
.mini-btn:hover { color: var(--color-text); background: rgba(255,255,255,0.08); border-color: var(--color-primary); }

/* 预览浮窗：左下角，不挡右侧地图 */
.preview-float {
  position: fixed; left: 36px; bottom: 16px; z-index: 9998;
  background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px;
  overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.55);
  width: 380px; max-width: calc(100vw - 32px);
}
.pf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; background: var(--bg-panel); border-bottom: 1px solid var(--border-color);
  font-size: 12px; color: var(--color-secondary);
}
.pf-body { position: relative; background: #000; line-height: 0; }
.pf-image { display: block; width: 100%; max-height: 60vh; }
.overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
.pf-empty { display: block; padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12px; }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
