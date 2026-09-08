<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useWatuStore } from '@/stores/watuStore'
import { loadFentuModel, detectFentu, isFentuModelLoaded, disposeFentuModel, clearFentuModelCache } from '@/services/fentuYolo'
import { mergeDetectionsIntoGrid, type DetectMode, type AnchorBox, getMapDefaultColor } from '@/services/fentuLogic'
import { recognizeWatuCoord } from '@/services/watuOcr'
import { planRoute, drawPathOverview, getDigOrder, getMapNames, type PathStep } from '@/services/watuLogic'
import ScreenShare from '@/components/common/ScreenShare.vue'
import HelpDrawer from '@/components/common/HelpDrawer.vue'

const store = useWatuStore()
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)
const sharing = ref(false)
const showPreview = ref(true)

// —— 物品栏锁定 + 手动改坐标 ——
const mapOptions = getMapNames()
const editing = ref<{ index: number } | null>(null)
const editForm = reactive({ mapname: '', x: '', y: '' })

function toggleLock() {
  store.toggleGridLocked()
}

function onCellClick(idx: number) {
  if (!store.gridLocked) return
  const cell = store.grid[idx]
  editForm.mapname = cell?.mapname || ''
  editForm.x = cell?.x ? String(cell.x) : ''
  editForm.y = cell?.y ? String(cell.y) : ''
  editing.value = { index: idx }
}

function closeCellEditor() {
  editing.value = null
}

function saveCellEdit() {
  if (!editing.value) return
  const idx = editing.value.index
  const x = parseInt(editForm.x, 10)
  const y = parseInt(editForm.y, 10)
  if (!editForm.mapname.trim() || isNaN(x) || isNaN(y) || x <= 0 || y <= 0) {
    alert('请填写有效的地图名、坐标 x 和 y（正整数）')
    return
  }
  store.setCellCoord(idx, x, y, editForm.mapname.trim())
  store.setPlanResult(null)
  store.clearMask()
  closeCellEditor()
}

function clearCellEdit() {
  if (!editing.value) return
  store.clearCell(editing.value.index)
  store.setPlanResult(null)
  store.clearMask()
  closeCellEditor()
}

/** 模型路径（与分图助手共用同一个 cbaotu 模型；用未量化版 cbaotu_orig，量化版 cbaotu 权重全 uint8 在 TF.js 无法加载） */
const MODEL_URL = '/models/cbaotu_orig/model.json'

let detectLoopId: number | null = null
let inFlight = false
const ocrCooldown = new Map<number, number>()

/** 锚框时间平滑（消除网格抖动） */
let smoothAnchor: AnchorBox | null = null
let lockClass: string | null = null
let anchorLostCount = 0
const SMOOTH_ALPHA = 0.4
const LOST_TOLERANCE = 12

/** 可视化 Canvas 引用 */
const visualCanvasRef = ref<HTMLCanvasElement | null>(null)
const visualWrapRef = ref<HTMLElement | null>(null)

/** 本次模型来源 */
const modelSource = ref<'cache' | 'download' | null>(null)

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mapColor(mapName: string): string {
  return getMapDefaultColor(mapName)
}

/** 加载 TF.js graph model */
async function loadModel() {
  store.setModelLoading(true)
  store.setError('')
  try {
    await loadFentuModel(
      { modelUrl: MODEL_URL },
      (fraction) => { store.setModelProgress(fraction) },
      (source) => { modelSource.value = source }
    )
    store.setModelLoaded(true)
  } catch (e) {
    console.error(e)
    store.setError('模型加载失败：' + (e as Error).message)
    store.setModelLoaded(false)
  } finally {
    store.setModelLoading(false)
  }
}

async function clearCache() {
  await clearFentuModelCache()
  modelSource.value = null
  loadModel()
}

const modelStatusText = computed(() => {
  if (store.modelLoading) {
    return modelSource.value === 'cache' ? '从浏览器缓存加载模型…' : `模型下载中 ${Math.round(store.modelProgress * 100)}%`
  }
  if (store.lastError) return '模型加载失败 · 点击重试'
  if (store.modelLoaded) {
    return modelSource.value === 'cache' ? '模型已就绪 ✓（本地缓存）' : '模型已就绪 ✓'
  }
  return '准备中…'
})
const statusClass = computed(() => {
  if (store.modelLoading) return 'loading'
  if (store.lastError) return 'error'
  if (store.modelLoaded) return 'ready'
  return ''
})
function onStatusClick() {
  if (store.lastError || !store.modelLoaded) loadModel()
}

function startDetect() {
  store.setDetecting(true)
  startDetectLoop()
}

function stopDetect() {
  store.setDetecting(false)
  stopDetectLoop()
  resetAnchor()
}

function resetAnchor() {
  smoothAnchor = null
  lockClass = null
  anchorLostCount = 0
}

function stopDetectLoop() {
  if (detectLoopId) {
    clearTimeout(detectLoopId)
    detectLoopId = null
  }
}

async function startDetectLoop() {
  const loop = async () => {
    if (!store.isDetecting || !screenShareRef.value) return
    if (!isFentuModelLoaded()) { scheduleLoop(); return }
    if (inFlight) { scheduleLoop(); return }

    inFlight = true
    try {
      const dataUrl = screenShareRef.value.captureFull()
      if (!dataUrl) { scheduleLoop(); return }

      const imageData = await dataUrlToImageData(dataUrl)
      if (!imageData) { scheduleLoop(); return }

      await processFrame(imageData, {
        drawOverlay: showPreview.value && !!screenShareRef.value,
        videoSize: screenShareRef.value ? screenShareRef.value.getVideoSize() : null
      })
    } catch (e) {
      console.error('[watu] 检测出错:', e)
    } finally {
      inFlight = false
    }
    scheduleLoop()
  }
  loop()
}

function scheduleLoop() {
  if (!store.isDetecting) return
  const interval = document.hidden ? 250 : 80
  detectLoopId = window.setTimeout(() => {
    void (async () => { await startDetectLoop() })()
  }, interval)
}

async function processFrame(
  imageData: ImageData,
  opts: { drawOverlay?: boolean; videoSize?: { width: number; height: number } | null }
) {
  const detections = await detectFentu(imageData)

  const isWarehouse = store.mode !== 'horizontal'
  const panelClass = isWarehouse
    ? (store.mode === 'warehouse-left' ? '仓库' : '仓库物品栏')
    : '物品栏'
  const current =
    detections.find(d => d.className === panelClass) ||
    (lockClass ? detections.find(d => d.className === lockClass) : undefined)

  if (current) {
    if (!lockClass) lockClass = current.className
    if (!smoothAnchor) {
      smoothAnchor = { className: current.className, x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 }
    } else {
      smoothAnchor = {
        className: current.className,
        x1: lerp(smoothAnchor.x1, current.x1, SMOOTH_ALPHA),
        y1: lerp(smoothAnchor.y1, current.y1, SMOOTH_ALPHA),
        x2: lerp(smoothAnchor.x2, current.x2, SMOOTH_ALPHA),
        y2: lerp(smoothAnchor.y2, current.y2, SMOOTH_ALPHA)
      }
    }
    anchorLostCount = 0
  } else {
    anchorLostCount++
    if (anchorLostCount > LOST_TOLERANCE) {
      lockClass = null
      smoothAnchor = null
      anchorLostCount = 0
    }
  }

  const { grid: mergedGrid, baotu2 } = mergeDetectionsIntoGrid(store.grid, detections, store.mode, {
    anchorOverride: smoothAnchor
  })
  if (!store.gridLocked) store.setGrid(mergedGrid)
  store.setDetections(
    detections.map((d) => ({ className: d.className, cx: d.cx, cy: d.cy, conf: d.conf }))
  )

  if (opts.drawOverlay && screenShareRef.value) {
    screenShareRef.value.drawOverlay({
      detections: detections.map((d) => ({
        className: d.className, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, conf: d.conf
      })),
      anchor: smoothAnchor,
      grid: store.gridLocked ? store.grid : mergedGrid
    })
  }

  let ocrTarget = baotu2
  if (!ocrTarget) {
    const b2 = detections.find(d => d.className === '藏宝图2')
    if (b2) ocrTarget = { index: -1, x1: b2.x1, y1: b2.y1, x2: b2.x2, y2: b2.y2 }
  }
  if (ocrTarget && !store.gridLocked) {
    const box = ocrTarget
    const now = Date.now()
    const cdKey = box.index >= 0 ? box.index : -1
    const last = ocrCooldown.get(cdKey) ?? 0
    if (now - last > 2500) {
      ocrCooldown.set(cdKey, now)
      recognizeWatuCoord(imageData, box)
        .then((res) => {
          if (res.map) {
            const cx = res.coord?.x ?? 0
            const cy = res.coord?.y ?? 0
            if (box.index >= 0) {
              store.setCellCoord(box.index, cx, cy, res.map)
            }
          }
        })
        .catch((e) => console.error('[watu] OCR 异常:', e))
    }
  }
}

async function dataUrlToImageData(dataUrl: string): Promise<ImageData | null> {
  try {
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch (e) {
    console.error('[watu] dataURL 转 ImageData 失败:', e)
    return null
  }
}

function setMode(m: DetectMode) {
  store.setMode(m)
  resetAnchor()
  store.clearGrid()
}

function clearGrid() {
  store.clearGrid()
}

function onShareStarted() {
  sharing.value = true
  startDetect()
}
function onShareStopped() {
  sharing.value = false
  stopDetect()
  resetAnchor()
}

// —— 路径规划 ——
async function doPlanRoute() {
  if (store.recognizedCount === 0) {
    alert('暂无已识别的宝图，请先通过屏幕共享或上传截图识别宝图坐标')
    return
  }
  store.setPlanning(true)
  try {
    const result = await planRoute(store.grid)
    store.setPlanResult(result)
    // 自动展示第一个地图的挖图顺序总览
    if (result.validSteps.length > 0) {
      const firstMap = result.validSteps[0].mapName
      const steps = result.validSteps.filter((s) => s.mapName === firstMap)
      await showOverview(firstMap, steps)
    }
  } catch (e) {
    console.error('[watu] 路径规划失败:', e)
    alert('路径规划失败：' + (e as Error).message)
  } finally {
    store.setPlanning(false)
  }
}

/** 点列表「地图名」→ 该图全部挖点总览 */
async function showOverview(mapName: string, steps: PathStep[]) {
  overviewInfo.value = { mapName, count: steps.length }
  await nextTick()
  const canvas = visualCanvasRef.value
  if (!canvas) return
  await drawPathOverview(canvas, mapName, steps)
  // 画中画缩放：按容器自适应尺寸后挂载视图
  onMapDrawn(canvas.width, canvas.height)
  // 蒙版：物品栏数字 = 该图「挖N」顺序（与地图可视化一致，由 getDigOrder 算出）
  const orderInfo = getDigOrder(mapName, steps)
  const masked = orderInfo
    ? orderInfo.ordered.map((o) => ({ index: o.cell - 1, order: o.order, x: o.x, y: o.y }))
    : steps.map((s, i) => ({ index: s.cell - 1, order: i + 1, x: s.x, y: s.y }))
  store.setMask(masked)
}

// —— 画中画缩放 / 平移 ——
const viewZoom = ref(1)
const viewPanX = ref(0)
const viewPanY = ref(0)
let mapBase: { jW: number; jH: number; fitScale: number; fitW: number; fitH: number; availW: number; availH: number } | null = null

const MIN_ZOOM = 0.5
const MAX_ZOOM = 6

/** 地图绘制完成后调用：按容器计算自适应显示尺寸并重置视图 */
function onMapDrawn(jW: number, jH: number) {
  const wrap = visualWrapRef.value
  if (!wrap) return
  const availW = Math.max(80, wrap.clientWidth - 16)
  const availH = Math.max(80, wrap.clientHeight - 16)
  const fitScale = Math.min(availW / jW, availH / jH, 1)
  mapBase = { jW, jH, fitScale, fitW: jW * fitScale, fitH: jH * fitScale, availW, availH }
  viewZoom.value = 1
  viewPanX.value = 0
  viewPanY.value = 0
  applyView()
}

function clampPan() {
  if (!mapBase) return
  const cw = mapBase.fitW * viewZoom.value
  const ch = mapBase.fitH * viewZoom.value
  const limX = Math.max(0, (cw - mapBase.availW) / 2)
  const limY = Math.max(0, (ch - mapBase.availH) / 2)
  viewPanX.value = Math.max(-limX, Math.min(limX, viewPanX.value))
  viewPanY.value = Math.max(-limY, Math.min(limY, viewPanY.value))
}

function applyView() {
  const c = visualCanvasRef.value
  if (!c || !mapBase) return
  c.style.width = mapBase.fitW * viewZoom.value + 'px'
  c.style.height = mapBase.fitH * viewZoom.value + 'px'
  c.style.transform = `translate(${viewPanX.value}px, ${viewPanY.value}px)`
}

function zoomBy(factor: number) {
  viewZoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewZoom.value * factor))
  clampPan()
  applyView()
}

function resetView() {
  viewZoom.value = 1
  viewPanX.value = 0
  viewPanY.value = 0
  applyView()
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
}

// 主图拖拽平移
let dragging = false
let lastX = 0
let lastY = 0
function onCanvasDown(e: MouseEvent) {
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}
function onCanvasMove(e: MouseEvent) {
  if (!dragging) return
  viewPanX.value += e.clientX - lastX
  viewPanY.value += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  clampPan()
  applyView()
}
function onCanvasUp() {
  dragging = false
}

/** 结果列表点击委托：点地图名 → 该图挖图顺序总览 */
function onPlanResultClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const mapEl = target.closest('.watu-map-name') as HTMLElement | null
  if (!mapEl) return
  const mapName = mapEl.getAttribute('data-map') || ''
  const steps = (store.planResult?.validSteps ?? []).filter((s) => s.mapName === mapName)
  showOverview(mapName, steps)
}

/** 总览信息（点地图名查看该图全部挖点时显示） */
const overviewInfo = ref<{ mapName: string; count: number } | null>(null)

/** 点击地图名后的蒙版映射（cell.index -> {order, x, y}） */
const maskMap = computed(() => {
  const m = new Map<number, { order: number; x: number; y: number }>()
  for (const c of store.maskedCells || []) m.set(c.index, { order: c.order, x: c.x, y: c.y })
  return m
})

onMounted(async () => {
  await loadModel()
})

onUnmounted(() => {
  stopDetectLoop()
  disposeFentuModel()
})
</script>

<template>
  <div class="watu-page">
    <!-- 顶栏 -->
    <header class="page-header">
      <div class="title">
        <span class="logo">⛏️</span>
        <div class="title-text">
          <h2>挖图助手</h2>
          <p class="subtitle">宝图识别 · 路径规划 · 目标点可视化</p>
        </div>
      </div>
      <div class="model-status" :class="statusClass" @click="onStatusClick" title="点击重试">
        <span class="dot"></span>
        <span>{{ modelStatusText }}</span>
        <div v-if="store.modelLoading" class="progress-track">
          <div class="progress-fill" :style="{ width: (store.modelProgress * 100) + '%' }"></div>
        </div>
        <button
          v-if="store.modelLoaded && modelSource === 'cache'"
          class="cache-clear"
          @click.stop="clearCache"
          title="清除浏览器中的模型缓存"
        >清除缓存</button>
      </div>
    </header>

    <!-- 主体 -->
    <div class="content">
      <!-- 工具栏 -->
      <div class="card toolbar-card">
        <div class="tool-bar-inline">
          <button class="btn btn-warning" @click="clearGrid">🗑 清空</button>
          <button class="btn btn-success" @click="doPlanRoute" :disabled="store.planning || store.recognizedCount === 0">
            {{ store.planning ? '规划中…' : `🗺️ 路径规划 (${store.recognizedCount})` }}
          </button>
          <button class="btn" @click="store.clearMask()" :disabled="!store.maskedCells">🧹 清除蒙版</button>
        </div>
        <p class="upload-tip">屏幕共享识别宝图后点击「路径规划」自动生成挖图路线</p>
      </div>

      <!-- 识别位置 -->
      <div class="card mode-card">
        <span class="inline-label">识别位置</span>
        <div class="mode-tabs">
          <button class="mode-tab" :class="{ active: store.mode === 'horizontal' }" @click="setMode('horizontal')">横板物品栏</button>
          <button class="mode-tab" :class="{ active: store.mode === 'warehouse-left' }" @click="setMode('warehouse-left')">仓库页左</button>
          <button class="mode-tab" :class="{ active: store.mode === 'warehouse-right' }" @click="setMode('warehouse-right')">仓库页右</button>
        </div>
      </div>

      <!-- 主区上排：物品栏 + 目标可视化 横向对齐 -->
      <div class="main-row">
        <!-- 左：物品栏网格 -->
        <div class="card grid-card">
          <button
            class="grid-lock-btn"
            :class="{ on: store.gridLocked }"
            @click="toggleLock"
            :title="store.gridLocked ? '物品栏已锁定：点击解锁（或清空自动解锁）' : '锁定物品栏：识别不再更新坐标，可点格子手动改坐标'"
          >{{ store.gridLocked ? '🔓 已锁定' : '🔒 锁定' }}</button>
          <div class="fentu-grid-wrap">
            <div class="fentu-grid">
              <div
                v-for="(cell, idx) in store.grid"
                :key="idx"
                class="cell"
                :class="{ filled: cell.isRecognized, 'cell-editable': store.gridLocked }"
                @click="onCellClick(idx)"
              >
                <template v-if="cell.isRecognized">
                  <span class="cell-map" :style="{ color: mapColor(cell.mapname) }">{{ cell.mapname }}</span>
                  <span v-if="cell.x && cell.y" class="cell-coord">{{ cell.x }},{{ cell.y }}</span>
                </template>
                <div v-if="maskMap.get(idx)" class="cell-mask">
                  <span class="m-order">{{ maskMap.get(idx)!.order }}</span>
                  <span class="m-coord">{{ maskMap.get(idx)!.x }},{{ maskMap.get(idx)!.y }}</span>
                </div>
              </div>
            </div>
          </div>
          <p class="legend">物品栏 4×5 网格 · 颜色对应地图 · 下方显示坐标（规划后点地图名显示挖图顺序蒙版）</p>
          <p v-if="store.gridLocked" class="lock-hint">🔒 物品栏已锁定：识别不再更新坐标，点击任意格子可手动修改；再次点「已锁定」或「清空」即解锁</p>
        </div>

        <!-- 右：目标点可视化（与物品栏横向对齐） -->
        <div class="card visual-card">
          <h3>🗺️ 目标点可视化</h3>
          <div class="legend" style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#9aa0a6;margin:4px 0 10px;">
            <span style="display:inline-flex;align-items:center;gap:5px;"><i style="display:inline-block;width:12px;height:12px;border-radius:50%;border:3px solid #00E676;background:rgba(0,230,118,0.4);"></i>绿圈 = 出发点</span>
            <span style="display:inline-flex;align-items:center;gap:5px;"><i style="display:inline-block;width:14px;height:14px;border-radius:50%;border:3px solid #FFEB3B;background:#caa15a;"></i>藏宝图 = 挖掘点</span>
            <span style="display:inline-flex;align-items:center;gap:5px;"><i style="display:inline-block;width:0;height:0;border-left:7px solid #FFD400;border-top:5px solid transparent;border-bottom:5px solid transparent;"></i>黄箭头 = 导航路线</span>
          </div>
          <div class="visual-wrap" ref="visualWrapRef" @wheel.prevent="onWheel">
            <canvas
              ref="visualCanvasRef"
              class="visual-canvas"
              @mousedown="onCanvasDown"
              @mousemove="onCanvasMove"
              @mouseup="onCanvasUp"
              @mouseleave="onCanvasUp"
            ></canvas>
            <p v-if="!overviewInfo" class="empty">点击左侧地图名查看挖图顺序总览</p>

            <!-- 缩放控制 -->
            <div class="zoom-ctrl">
              <button type="button" title="放大" @click="zoomBy(1.25)">＋</button>
              <button type="button" title="缩小" @click="zoomBy(1 / 1.25)">－</button>
              <button type="button" title="重置视图" @click="resetView">⤢</button>
              <span class="zoom-val">{{ Math.round(viewZoom * 100) }}%</span>
            </div>
          </div>
          <div v-if="overviewInfo" class="visual-info">
            <span :style="{ color: mapColor(overviewInfo.mapName) }">{{ overviewInfo.mapName }}</span>
            <span>共 {{ overviewInfo.count }} 个挖点</span>
            <span>顺序：起点出发，由近到远</span>
          </div>
        </div>
      </div>

      <!-- 路径规划结果：全宽 -->
      <div class="card plan-card">
        <h3>📌 路径规划结果</h3>
        <div v-if="store.planResult" class="plan-result" v-html="store.planResult.resultHtml" @click="onPlanResultClick"></div>
        <p v-else class="empty">识别宝图后点击「路径规划」生成路线</p>
      </div>

      <p class="watu-tip">挖图与路径规划请配合左上角屏幕共享浮窗；识别到宝图后点击「路径规划」即可生成最优挖图路线并可视化目标点位置</p>

      <!-- 屏幕共享：左侧监控竖条 -->
      <ScreenShare
        ref="screenShareRef"
        label="挖图监控"
        :display-preview="showPreview"
        @started="onShareStarted"
        @stopped="onShareStopped"
      />

      <!-- 坐标手动编辑弹窗（锁定状态下点击格子出现） -->
      <div v-if="editing" class="cell-edit-mask" @click.self="closeCellEditor">
        <div class="cell-edit-dialog">
          <h4>修改宝图坐标 · 物品栏 {{ editing.index + 1 }}</h4>
          <label class="ce-row">
            <span>地图名</span>
            <select v-model="editForm.mapname" class="ce-input">
              <option v-for="m in mapOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
          <div class="ce-row">
            <span>坐标 X</span>
            <input v-model="editForm.x" class="ce-input" type="number" min="0" placeholder="如 71" />
          </div>
          <div class="ce-row">
            <span>坐标 Y</span>
            <input v-model="editForm.y" class="ce-input" type="number" min="0" placeholder="如 24" />
          </div>
          <div class="ce-actions">
            <button class="btn btn-success" @click="saveCellEdit">保存</button>
            <button class="btn btn-danger" @click="clearCellEdit">清空此格</button>
            <button class="btn" @click="closeCellEditor">取消</button>
          </div>
          <p class="ce-tip">保存后记得重新点「路径规划」生成路线</p>
        </div>
      </div>
    </div>
    <HelpDrawer moduleKey="watu" />
  </div>
</template>

<style scoped>
.watu-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  gap: 10px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 12px;
}
.title { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 22px; }
.title-text h2 { font-size: 16px; color: var(--color-text); margin: 0; }
.subtitle { font-size: 11px; color: var(--color-text-muted); margin: 1px 0 0; }
.model-status {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; padding: 5px 12px; border-radius: 20px;
  border: 1px solid var(--border-color); background: var(--bg-input);
  cursor: default; user-select: none;
}
.model-status.error { cursor: pointer; }
.model-status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-muted); }
.model-status.ready .dot { background: var(--color-success); box-shadow: 0 0 8px var(--color-success); }
.model-status.loading .dot { background: var(--color-warning); animation: pulse 1s infinite; }
.model-status.error { color: var(--color-danger); border-color: var(--color-danger); }
.model-status.error .dot { background: var(--color-danger); }
.progress-track { width: 90px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.15); overflow: hidden; margin-left: 4px; }
.progress-fill { height: 100%; background: var(--color-warning); border-radius: 2px; transition: width 0.2s; }
.cache-clear {
  margin-left: 6px; padding: 2px 8px; font-size: 11px; line-height: 1.4;
  border-radius: 10px; border: 1px solid var(--border-color);
  background: transparent; color: var(--color-text-muted); cursor: pointer;
}
.cache-clear:hover { color: var(--color-text); border-color: var(--color-text-muted); background: rgba(255,255,255,0.06); }

/* 右侧监控竖条（现由 ScreenShare 组件统一渲染，此处仅保留 pulse 动画供模型状态点使用） */
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

.content {
  flex: 1; display: flex; flex-direction: column; align-items: stretch;
  gap: 10px; min-height: 0; width: 100%; max-width: 1388px; margin: 0 auto;
}
.toolbar-card { width: 100%; padding: 8px 12px; }
.upload-tip { font-size: 11px; color: var(--color-text-muted); margin: 8px 0 0; line-height: 1.5; }
.mode-card { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
.tool-bar-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.inline-label { font-size: 13px; color: var(--color-text-muted); margin-left: 2px; }
.grid-card { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; position: relative; }
.fentu-grid-wrap { display: flex; justify-content: center; width: 100%; }
.watu-tip { font-size: 11px; color: var(--color-text-muted); line-height: 1.6; text-align: center; margin: 0; padding: 0 8px; }

.main-row { display: flex; align-items: flex-start; gap: 12px; width: 100%; flex-wrap: nowrap; }
.visual-card { flex: 1 1 auto; min-width: 320px; display: flex; flex-direction: column; }

.card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 9px 11px; }
.card h3 { margin: 0 0 10px; font-size: 14px; color: var(--color-secondary); }

.mode-tabs { display: flex; gap: 6px; }
.mode-tab {
  flex: 0 0 auto; padding: 6px 12px; font-size: 12px; white-space: nowrap;
  border: 1px solid var(--border-color); background: var(--bg-input);
  color: var(--color-text-muted); border-radius: 6px; cursor: pointer; transition: all 0.2s;
}
.mode-tab:hover { color: var(--color-text); }
.mode-tab.active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }

.empty { color: var(--color-text-muted); text-align: center; padding: 12px; font-size: 12px; }

/* 4×5 网格 */
.fentu-grid {
  display: grid;
  grid-template-columns: repeat(5, 96px);
  grid-template-rows: repeat(4, 96px);
  gap: 4px;
  background: #b9bec9;
  border: 3px solid #9aa1b0;
  border-radius: 8px;
  padding: 5px;
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.22);
}
.cell {
  position: relative;
  background: #e3e5ec;
  border: 1px solid #b3b9c6;
  border-radius: 5px;
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -1px 2px rgba(0,0,0,0.1);
  color: #7f8693;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 2px; overflow: hidden;
}
.cell.filled {
  background: linear-gradient(150deg, #eef0f5, #e3e6ee);
  border: 1px solid #aab0bd;
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.85), inset 0 -1px 2px rgba(0,0,0,0.06);
  color: #2b2f3a;
}
.cell-num { font-size: 36px; font-weight: 800; line-height: 1; font-family: 'SF Mono', Menlo, monospace; text-shadow: 0 1px 2px rgba(0,0,0,0.12); }
.cell-map { font-size: 16px; font-weight: 700; margin-top: 1px; max-width: 100%; white-space: normal; word-break: keep-all; line-height: 1.1; color: #2b2f3a; }
.cell-coord { font-size: 14px; color: #666; margin-top: 2px; font-family: 'SF Mono', Menlo, monospace; }
.legend { font-size: 11px; color: var(--color-text-muted); margin-top: 6px; text-align: center; }

/* 路径规划结果 */
.plan-card { width: 100%; }
.plan-result { display: flex; flex-direction: column; gap: 8px; }
.plan-result :deep(.annotation-title) {
  font-weight: 700; margin: 0 0 2px; font-size: 14px; color: var(--color-text);
  display: flex; align-items: center; gap: 6px;
}
.plan-result :deep(.annotation-item) { padding: 3px 0; font-size: 12px; color: var(--color-text-muted); }
.plan-result :deep(.watu-map-group) {
  margin: 0; padding: 10px 12px; border-radius: 8px;
  background: var(--bg-input); border: 1px solid var(--border-color);
  transition: border-color 0.15s, background 0.15s;
}
.plan-result :deep(.watu-map-group:hover) { border-color: var(--color-primary); background: var(--bg-card); }
.plan-result :deep(.watu-map-name) {
  cursor: pointer; font-weight: 600; font-size: 15px; color: var(--color-text);
  display: flex; align-items: center; gap: 8px; transition: color 0.15s;
}
.plan-result :deep(.watu-map-name:hover) { color: var(--color-primary); }
.plan-result :deep(.watu-map-dot) {
  width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.06);
}
.plan-result :deep(.watu-map-icon) { font-size: 15px; }
.plan-result :deep(.watu-map-label) { color: var(--color-text); }
.plan-result :deep(.watu-count) {
  color: #fff; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 12px;
  background: var(--color-primary); margin-left: auto;
}
.plan-result :deep(.watu-cells) { display: none; }

/* 物品栏蒙版（点击地图名后覆盖：顺序数字 + 坐标） */
.cell-mask {
  position: absolute; inset: 0; z-index: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: rgba(15, 18, 25, 0.82); border: 2px solid #FFD400; border-radius: 5px;
  pointer-events: none;
}
.cell-mask .m-order { font-size: 30px; font-weight: 800; line-height: 1; color: #FFD400; text-shadow: 0 1px 3px #000; }
.cell-mask .m-coord { font-size: 11px; color: #fff; font-family: 'SF Mono', Menlo, monospace; text-shadow: 0 1px 1px #000; }

.btn-danger { background: #b3261e; border-color: #b3261e; color: #fff; }
.btn-danger:hover { background: #d33125; }

/* 物品栏锁定 */
.btn-lock-on { background: #FFD400; border-color: #FFD400; color: #1a1a1a; font-weight: 600; }
.btn-lock-on:hover { background: #ffdf33; }
.cell-editable { cursor: pointer; outline: 2px dashed #FFD400; outline-offset: -2px; }
.cell-editable:hover { background: #fff7d6; }
.lock-hint {
  font-size: 12px; color: #FFD400; background: rgba(255,212,0,0.1);
  border: 1px solid rgba(255,212,0,0.4); border-radius: 6px;
  padding: 5px 8px; margin-top: 6px; text-align: center;
}

/* 物品栏左上角锁定开关 */
.grid-lock-btn {
  position: absolute; top: 8px; left: 8px; z-index: 5;
  padding: 4px 9px; font-size: 12px; font-weight: 600; line-height: 1.2;
  border-radius: 6px; border: 1px solid var(--border-color);
  background: var(--bg-input); color: var(--color-text); cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.grid-lock-btn:hover { filter: brightness(1.08); }
.grid-lock-btn.on { background: #FFD400; border-color: #FFD400; color: #1a1a1a; }

/* 坐标手动编辑弹窗 */
.cell-edit-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.cell-edit-dialog {
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 10px; padding: 16px 18px; width: 320px;
  display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
.cell-edit-dialog h4 { margin: 0; font-size: 14px; color: var(--color-text); }
.ce-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--color-text); }
.ce-row > span { flex: 0 0 60px; color: var(--color-text-muted); }
.ce-input {
  flex: 1 1 auto; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--border-color); background: var(--bg-input);
  color: var(--color-text); font-size: 13px;
}
.ce-actions { display: flex; gap: 8px; margin-top: 4px; }
.ce-tip { font-size: 11px; color: var(--color-text-muted); margin: 2px 0 0; }

/* 可视化 */
.visual-card { display: flex; flex-direction: column; }
.visual-wrap {
  position: relative; display: flex; justify-content: center; align-items: center;
  background: #000; border: 1px solid var(--border-color); border-radius: 6px;
  padding: 8px; overflow: hidden;
  height: min(56vh, 560px); min-height: 280px;
}
.visual-canvas {
  max-width: none;
  max-height: none;
  width: auto;
  height: auto;
  border-radius: 4px;
  transform-origin: center center;
  cursor: grab;
}
.visual-canvas:active { cursor: grabbing; }
.zoom-ctrl {
  position: absolute; top: 10px; right: 10px; display: flex; align-items: center; gap: 4px;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 4px 6px;
  z-index: 3;
}
.zoom-ctrl button {
  width: 26px; height: 26px; border: none; border-radius: 5px; cursor: pointer;
  background: rgba(255,255,255,0.12); color: #fff; font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.zoom-ctrl button:hover { background: rgba(255,212,0,0.35); }
.zoom-ctrl .zoom-val { color: #fff; font-size: 11px; min-width: 34px; text-align: center; }
.visual-info {
  display: flex; gap: 16px; justify-content: center; margin-top: 8px;
  font-size: 13px; color: var(--color-text);
}
</style>
