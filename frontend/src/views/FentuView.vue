<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useFentuStore } from '@/stores/fentuStore'
import { loadFentuModel, detectFentu, isFentuModelLoaded, disposeFentuModel, clearFentuModelCache } from '@/services/fentuYolo'
import { mergeDetectionsIntoGrid, type DetectMode, type AnchorBox, type GridCell, LABEL_COLORS, getMapDefaultColor } from '@/services/fentuLogic'
import { recognizeBaotuCoord } from '@/services/fentuOcr'
import ScreenShare from '@/components/common/ScreenShare.vue'
import HelpDrawer from '@/components/common/HelpDrawer.vue'
import ScenePanel from '@/components/fentu/ScenePanel.vue'

const store = useFentuStore()
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)
const sharing = ref(false)
/** 是否展示监控画面（关掉 = 后台监控，仅黄框状态） */
const showPreview = ref(true)
/** OCR 裁剪预览图（发给后端的坐标区域），用于页面核对截取是否正确 */
const ocrCropPreview = ref('')

/** 模型路径（白嫖自 mhxyai.com，仅本地学习）
 * 用未量化版 cbaotu_orig：量化版 cbaotu 的全部权重为 uint8，
 * TF.js graph 执行器不支持权重为 uint8（报 Unsupported dtype: uint8），
 * 而未量化版为 float32/int32 可正常加载，且精度更高。 */
const MODEL_URL = '/models/cbaotu_orig/model.json'

let detectLoopId: number | null = null
let inFlight = false
/** OCR 防抖：格位 index → 上次识别时间戳 */
const ocrCooldown = new Map<number, number>()

/**
 * 锚框时间平滑（消除「网格一上一下」抖动）
 * 根因：YOLO 每帧输出的物品栏框有像素级抖动，直接拿它算 origin/cellW 会让整张
 * 网格随帧跳动；且 round() 在格边界附近会把格子跨格跳。EMA 平滑吸收抖动，
 * 并在类别上「锁定」，避免某帧没检测到物品栏而 fallback 到仓库框导致 origin 突变。
 */
let smoothAnchor: AnchorBox | null = null
let lockClass: string | null = null
let anchorLostCount = 0
const SMOOTH_ALPHA = 0.4 // 平滑系数：新帧占比，越小越稳
const LOST_TOLERANCE = 12 // 连续丢失多少帧才解除锁定重新选锚

/** 对齐调试信息 */
const debug = ref<{
  videoSize: string
  anchorClass: string
  anchorRect: string
  cell: string
  locked: boolean
  lost: number
  cropSize: string
}>({ videoSize: '-', anchorClass: '-', anchorRect: '-', cell: '-', locked: false, lost: 0, cropSize: '-' })

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 地图名 → 仓库默认颜色
 * 依据「仓库宝图存放设置」（sceneSlots）中该地图名所在的槽位序号取色，
 * 这样相同地图名的格子/坐标统一着色，不同地图一眼区分；设置改了颜色实时变。
 */
function mapColor(mapName: string): string {
  return getMapDefaultColor(mapName)
}

/**
 * 地图名 → 所在仓库槽位号（1 基，如 花果山 → 2）
 * 依据「仓库宝图存放设置」(sceneSlots) 中该地图名所在的槽位序号。
 * 找不到（OCR 识别出不在 16 图内的地图，如宝象国）返回 -1。
 */
function warehouseSlotNum(mapName: string): number {
  const idx = store.sceneSlots.findIndex((s) => s === mapName)
  return idx >= 0 ? idx + 1 : -1
}

/**
 * 物品栏格子显示的数字：优先用「该地图对应的仓库槽位号」（与仓库颜色一致），
 * 仅当地图不在仓库设置中（无法对应仓库）时，回退显示物品栏格子序号。
 */
function cellDisplayNum(cell: GridCell, idx: number): number {
  const w = warehouseSlotNum(cell.mapname)
  return w >= 0 ? w : idx + 1
}

/**
 * 加载 TF.js graph model（进入页面自动调用）
 */
async function loadModel() {
  store.setModelLoading(true)
  store.setError('')
  try {
    await loadFentuModel(
      { modelUrl: MODEL_URL },
      (fraction) => {
        store.setModelProgress(fraction)
      },
      (source) => {
        modelSource.value = source
      }
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

/** 本次模型来源：'cache'=浏览器缓存秒开 / 'download'=网络下载 / null=未加载 */
const modelSource = ref<'cache' | 'download' | null>(null)

/**
 * 清除浏览器模型缓存（下次会重新下载模型）
 */
async function clearCache() {
  await clearFentuModelCache()
  modelSource.value = null
  loadModel()
}

/**
 * 模型状态文案
 */
const modelStatusText = computed(() => {
  if (store.modelLoading) {
    return modelSource.value === 'cache'
      ? '从浏览器缓存加载模型…'
      : `模型下载中 ${Math.round(store.modelProgress * 100)}%`
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

/**
 * 开始检测循环
 */
function startDetect() {
  store.setDetecting(true)
  startDetectLoop()
}

/**
 * 停止检测循环
 */
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

/**
 * 检测循环（rAF 思路 + 防重入 + 页面隐藏降频）
 */
async function startDetectLoop() {
  const loop = async () => {
    if (!store.isDetecting || !screenShareRef.value) {
      return
    }
    // 模型尚未就绪：保持轮询，就绪后自动开始识别（对齐原站「选屏即自动识别」）
    if (!isFentuModelLoaded()) {
      scheduleLoop()
      return
    }

    // 防重入：上一帧未完成则跳过
    if (inFlight) {
      scheduleLoop()
      return
    }

    inFlight = true
    try {
      const dataUrl = screenShareRef.value.captureFull()
      if (!dataUrl) {
        scheduleLoop()
        return
      }

      const imageData = await dataUrlToImageData(dataUrl)
      if (!imageData) {
        scheduleLoop()
        return
      }

      await processFrame(imageData, {
        drawOverlay: showPreview.value && !!screenShareRef.value,
        videoSize: screenShareRef.value ? screenShareRef.value.getVideoSize() : null
      })
    } catch (e) {
      console.error('[fentu] 检测出错:', e)
    } finally {
      inFlight = false
    }

    scheduleLoop()
  }

  loop()
}

function scheduleLoop() {
  if (!store.isDetecting) return
  // 页面隐藏时降频到 250ms，可见时 80ms（约 12fps）
  const interval = document.hidden ? 250 : 80
  detectLoopId = window.setTimeout(() => {
    void (async () => {
      await startDetectLoop()
    })()
  }, interval)
}

/**
 * 处理一帧：检测 → 网格落格 → OCR（实时屏幕共享 与 「上传截图测试」共用）
 * @param imageData 整帧 ImageData（坐标系统与检测框一致）
 * @param opts.drawOverlay 是否在共享画面上绘制检测框（上传模式为 false）
 * @param opts.videoSize 采集分辨率（调试显示用；上传模式传图片尺寸）
 */
async function processFrame(
  imageData: ImageData,
  opts: { drawOverlay?: boolean; videoSize?: { width: number; height: number } | null }
) {
  const detections = await detectFentu(imageData)

  // —— 锚框平滑 + 类别锁定 ——
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
      smoothAnchor = {
        className: current.className,
        x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2
      }
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
      // 长时间丢失：解除锁定，下一帧重新选择
      lockClass = null
      smoothAnchor = null
      anchorLostCount = 0
    }
  }

  // 用平滑后的锚框【合并】进持久网格（anchorOverride 优先）。
  // 关键：不再每帧重建空白网格，已识别的坐标跨帧保留（修复多张宝图只显示最后一张的问题）。
  const { grid, baotu2 } = mergeDetectionsIntoGrid(store.grid, detections, store.mode, {
    anchorOverride: smoothAnchor
  })
  store.setGrid(grid)
  store.setDetections(
    detections.map((d) => ({
      className: d.className,
      cx: d.cx,
      cy: d.cy,
      conf: d.conf
    }))
  )

  // —— overlay 绘制（仅共享画面模式）——
  if (opts.drawOverlay && screenShareRef.value) {
    screenShareRef.value.drawOverlay({
      detections: detections.map((d) => ({
        className: d.className,
        x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2,
        conf: d.conf
      })),
      anchor: smoothAnchor,
      grid
    })
  }

  // —— 调试信息 ——
  const vs = opts.videoSize || (screenShareRef.value ? screenShareRef.value.getVideoSize() : null)
  debug.value = {
    videoSize: vs ? `${vs.width}×${vs.height}` : '-',
    anchorClass: smoothAnchor ? smoothAnchor.className : '(无锚框)',
    anchorRect: smoothAnchor
      ? `${Math.round(smoothAnchor.x1)},${Math.round(smoothAnchor.y1)} ~ ${Math.round(smoothAnchor.x2)},${Math.round(smoothAnchor.y2)}`
      : '-',
    cell: smoothAnchor
      ? `${Math.round((smoothAnchor.x2 - smoothAnchor.x1) / 5)} × ${Math.round((smoothAnchor.y2 - smoothAnchor.y1) / 4)}`
      : '-',
    locked: !!lockClass,
    lost: anchorLostCount,
    cropSize: debug.value.cropSize
  }

  // —— OCR 识别藏宝图2 坐标（防抖，避免重复识别）——
  // 优先用网格里的 baotu2；若整图直接截到藏宝图2（无物品栏锚框，如纯展开图上传）也触发，
  // 方便只测坐标识别、不必截到整个物品栏。
  let ocrTarget = baotu2
  if (!ocrTarget) {
    const b2 = detections.find(d => d.className === '藏宝图2')
    if (b2) ocrTarget = { index: -1, x1: b2.x1, y1: b2.y1, x2: b2.x2, y2: b2.y2 }
  }
  if (ocrTarget) {
    const box = ocrTarget
    const now = Date.now()
    const cdKey = box.index >= 0 ? box.index : -1
    const last = ocrCooldown.get(cdKey) ?? 0
    if (now - last > 2500) {
      ocrCooldown.set(cdKey, now)
      if (box.index < 0) {
        console.log('[fentu] 检测到藏宝图2(展开图)，但无藏宝图1 格，坐标显示在「最近识别坐标」')
      }
      recognizeBaotuCoord(imageData, box)
        .then((res) => {
          // 展示发给 OCR 的裁剪图，便于核对截取是否正确
          ocrCropPreview.value = res.cropDataUrl
          debug.value.cropSize = `框右缘起·右扩~2.65×框宽·下半框高·放大2×`
          // 分图助手只需地图名即可填格子；坐标为可选项（识别到就用，用于「识别位置」定位）
          if (res.map) {
            const cx = res.coord?.x ?? 0
            const cy = res.coord?.y ?? 0
            if (box.index >= 0) {
              store.setCellCoord(box.index, cx, cy, res.map)
            } else {
              store.setLatestCoord(cx, cy, res.map)
            }
          }
        })
        .catch((e) => console.error('[fentu] OCR 异常:', e))
    }
  }
}

/**
 * dataURL 转 ImageData
 */
async function dataUrlToImageData(dataUrl: string): Promise<ImageData | null> {
  try {
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
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
    console.error('[fentu] dataURL 转 ImageData 失败:', e)
    return null
  }
}

/**
 * 切换识别位置模式
 */
function setMode(m: DetectMode) {
  store.setMode(m)
  resetAnchor() // 切模式重置平滑
  store.clearGrid() // 不同布局的坐标不通用，切模式清空网格
}

/**
 * 清空网格
 */
function clearGrid() {
  store.clearGrid()
}

function onShareStarted() {
  sharing.value = true
  // 选屏即自动开始识别（原站无「开始识别」按钮）
  startDetect()
}
function onShareStopped() {
  sharing.value = false
  stopDetect()
  resetAnchor()
}

// —— 上传截图测试（免屏幕共享）——
const uploadMode = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

function triggerUpload() {
  fileInputRef.value?.click()
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/**
 * 选一张截图 → 走与屏幕共享完全相同的检测+网格+OCR 流程（一次性，无需 ScreenShare）
 * 支持：含物品栏/仓库的整屏截图（完整落格+OCR）；或仅「藏宝图2 展开图」（单独测坐标识别）
 */
async function onUploadFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadMode.value = true
  try {
    if (!isFentuModelLoaded()) {
      alert('模型尚未加载完成，请稍候再上传截图测试')
      return
    }
    const dataUrl = await fileToDataUrl(file)
    const imageData = await dataUrlToImageData(dataUrl)
    if (!imageData) {
      alert('图片解析失败，请换一张截图')
      return
    }
    await processFrame(imageData, {
      drawOverlay: false,
      videoSize: { width: imageData.width, height: imageData.height }
    })
  } catch (err) {
    console.error('[fentu] 上传测试失败:', err)
  } finally {
    input.value = '' // 允许重复选择同一文件
  }
}

// 进入页面自动加载模型
onMounted(() => {
  loadModel()
})

onUnmounted(() => {
  stopDetectLoop()
  disposeFentuModel()
})
</script>

<template>
  <div class="fentu-page">
    <!-- 顶栏 -->
    <header class="page-header">
      <div class="title">
        <span class="logo">🏮</span>
        <div class="title-text">
          <h2>分图助手</h2>
          <p class="subtitle">屏幕共享实时监控 · YOLO 识别藏宝图位置</p>
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
          title="清除浏览器中的模型缓存，下次重新下载"
        >清除缓存</button>
      </div>
    </header>

    <!-- 监控状态已统一到左侧 ScreenShare 竖条，此处不再重复展示 -->

    <!-- 主体：单列（学习原站 fentu 排版） -->
    <div class="content">
      <!-- 工具栏卡片（控制按钮栏） -->
      <div class="card toolbar-card">
        <div class="tool-bar-inline">
          <button class="btn btn-warning" @click="clearGrid">🗑 清空</button>
          <button class="btn" @click="triggerUpload">📷 上传截图测试</button>
          <input ref="fileInputRef" type="file" accept="image/*" class="hidden-file" @change="onUploadFile" />
        </div>
        <p class="upload-tip">免屏幕共享：选一张含物品栏/仓库的整屏截图，即可跑完整「检测→落格→OCR」；只截到「藏宝图2 展开图」也能单独测坐标识别</p>
      </div>

      <!-- 识别位置卡片（模式栏） -->
      <div class="card mode-card">
        <span class="inline-label">识别位置</span>
        <div class="mode-tabs">
          <button class="mode-tab" :class="{ active: store.mode === 'horizontal' }" @click="setMode('horizontal')">横板物品栏</button>
          <button class="mode-tab" :class="{ active: store.mode === 'warehouse-left' }" @click="setMode('warehouse-left')">仓库页左</button>
          <button class="mode-tab" :class="{ active: store.mode === 'warehouse-right' }" @click="setMode('warehouse-right')">仓库页右</button>
        </div>
      </div>

      <!-- 主区：物品栏 | 仓库宝图存放设置 -->
      <div class="main-row">
        <!-- 物品栏网格卡片 -->
        <div class="card grid-card">
          <div class="fentu-grid-wrap">
            <div class="fentu-grid">
              <div
                v-for="(cell, idx) in store.grid"
                :key="idx"
                class="cell"
                :class="{ filled: cell.isRecognized }"
              >
                <template v-if="cell.isRecognized">
                  <span class="cell-num" :style="{ color: mapColor(cell.mapname) }">{{ cellDisplayNum(cell, idx) }}</span>
                  <span class="cell-map">{{ cell.mapname }}</span>
                </template>
              </div>
            </div>
          </div>
          <p class="legend">网格按面板框实测尺寸贴合 · 标题栏偏移已校正 · 格内大数字＝该地图对应的「仓库宝图存放设置」槽位号，颜色＝该地图名的默认色（如 花果山→绿）；格子本身与地图名均不染色</p>
          <div v-if="store.latestCoord" class="latest-coord">
            <span v-if="store.latestCoord.map" class="coord-map">{{ store.latestCoord.map }}</span>
            <span v-else class="coord-map">藏宝图2</span>
            <span class="coord-hint">最近识别地图 · 来自藏宝图2(展开图) OCR（无对应藏宝图1 格时显示）</span>
          </div>
        </div>

        <!-- 右列：仓库宝图存放设置 -->
        <div class="side-col">
          <ScenePanel />
        </div>
      </div>

      <p class="fentu-tip">分图识别请使用页面左侧「分图监控」竖条开启屏幕共享；测试阶段 YOLO 检测框默认显示在共享画面内（含类别 / 置信度标签），便于核对识别效果。</p>

      <!-- 分图监控：左侧监控竖条 -->
      <ScreenShare
        ref="screenShareRef"
        :display-preview="showPreview"
        @started="onShareStarted"
        @stopped="onShareStopped"
      />

      <!-- 对齐调试（折叠，默认隐藏，对齐原站"隐藏检测噪声"） -->
      <details class="card debug-details" v-if="sharing || uploadMode" open>
        <summary>🔬 对齐调试 / 实时检测</summary>
        <div class="debug-inner">
          <div class="debug-grid">
            <div class="dbg"><span class="k">采集分辨率</span><span class="v">{{ debug.videoSize }}</span></div>
            <div class="dbg"><span class="k">锚框类</span><span class="v">{{ debug.anchorClass }}</span></div>
            <div class="dbg"><span class="k">锚框坐标</span><span class="v">{{ debug.anchorRect }}</span></div>
            <div class="dbg"><span class="k">单格尺寸</span><span class="v">{{ debug.cell }}</span></div>
            <div class="dbg"><span class="k">锚框锁定</span><span class="v">{{ debug.locked ? '已锁定' : '未锁定' }}</span></div>
            <div class="dbg"><span class="k">丢失计数</span><span class="v">{{ debug.lost }}</span></div>
          </div>
          <div class="det-list" v-if="store.lastDetections.length > 0">
            <div v-for="(d, i) in store.lastDetections" :key="i" class="det-item">
              <span class="cls" :style="{ color: LABEL_COLORS[d.className as keyof typeof LABEL_COLORS] || '#fff' }">● {{ d.className }}</span>
              <span class="conf">{{ Math.round(d.conf * 100) }}%</span>
            </div>
          </div>
          <p v-else class="empty">等待检测…</p>

          <!-- OCR 裁剪预览：发给后端 OCR 的「截图部分」，用于核对截取是否正确 -->
          <div class="ocr-crop">
            <div class="ocr-crop-head">
              <span class="k">OCR 裁剪预览</span>
              <span class="v">{{ debug.cropSize }}</span>
            </div>
            <div class="ocr-crop-body">
              <img v-if="ocrCropPreview" :src="ocrCropPreview" alt="OCR 裁剪图" class="ocr-crop-img" />
              <p v-else class="empty">检测到藏宝图2(展开图)后显示</p>
            </div>
            <p class="ocr-crop-tip">此为发送给后端 /api/fentu/capture 的坐标区域（对齐原站：藏宝图2 框右下方，右扩约2.65×框宽、取下半框高、放大2×），核对是否截对</p>
          </div>
        </div>
      </details>
    </div>
    <HelpDrawer moduleKey="fentu" />
  </div>
</template>

<style scoped>
.fentu-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  gap: 10px;
}

/* 顶栏 */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 12px;
}
.title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  font-size: 22px;
}
.title-text h2 {
  font-size: 16px;
  color: var(--color-text);
  margin: 0;
}
.subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
  margin: 1px 0 0;
}
.model-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  cursor: default;
  user-select: none;
}
.model-status.error {
  cursor: pointer;
}
.model-status .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.model-status.ready .dot {
  background: var(--color-success);
  box-shadow: 0 0 8px var(--color-success);
}
.model-status.loading .dot {
  background: var(--color-warning);
  animation: pulse 1s infinite;
}
.model-status.error {
  color: var(--color-danger);
  border-color: var(--color-danger);
}
.model-status.error .dot {
  background: var(--color-danger);
}
/* 模型加载进度条 */
.progress-track {
  width: 90px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
  margin-left: 4px;
}
.progress-fill {
  height: 100%;
  background: var(--color-warning);
  border-radius: 2px;
  transition: width 0.2s;
}
/* 清除缓存按钮（模型来自浏览器缓存时显示） */
.cache-clear {
  margin-left: 6px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.cache-clear:hover {
  color: var(--color-text);
  border-color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.06);
}

/* 监控状态已统一到左侧 ScreenShare 竖条，.monitor-bar 等样式不再使用 */
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--color-text-muted);
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  align-self: flex-start;
}
.btn-ghost:hover {
  color: var(--color-text);
  border-color: var(--color-primary);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 对齐调试 */
.debug-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 12px;
}
.dbg {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dbg .k {
  font-size: 11px;
  color: var(--color-text-muted);
}
.dbg .v {
  font-size: 13px;
  font-family: 'SF Mono', Menlo, monospace;
  color: var(--color-text);
}

/* 主体：居中，整体最大宽 1388px（margin:0 auto 居中），清空/识别位置/物品栏+仓库三板块随之居中 */
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  min-height: 0;
  width: 100%;
  max-width: 1388px;
  margin: 0 auto;
}
/* 工具栏卡片 */
.toolbar-card {
  width: 100%;
  padding: 8px 12px;
}
/* 上传截图测试 */
.hidden-file {
  display: none;
}
.upload-tip {
  font-size: 11px;
  color: var(--color-text-muted);
  margin: 8px 0 0;
  line-height: 1.5;
}
/* 识别位置卡片 */
.mode-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}
.tool-bar-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.inline-label {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-left: 2px;
}
.grid-card {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.fentu-grid-wrap {
  display: flex;
  justify-content: center;
  width: 100%;
}
.fentu-tip {
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.6;
  text-align: center;
  margin: 0;
  padding: 0 8px;
}
/* 主区：左右结构（物品栏 | 仓库宝图存放设置），强制并排不换行 */
.main-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
}
.share-col {
  flex: 0 0 auto;
  align-self: flex-start;
}
.side-col {
  flex: 1 1 300px;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 调试折叠（默认隐藏，对齐原站"隐藏检测噪声"） */
.debug-details {
  width: 100%;
}
.debug-details summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
  user-select: none;
}
.debug-details summary::-webkit-details-marker {
  color: var(--color-text-muted);
}
.debug-inner {
  margin-top: 8px;
}

/* 卡片通用 */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 9px 11px;
}
.card h3 {
  margin: 0 0 10px;
  font-size: 17px;
  color: var(--color-text);
}

/* 识别位置 tab */
.mode-tabs {
  display: flex;
  gap: 6px;
}
.mode-tab {
  flex: 0 0 auto;
  padding: 6px 12px;
  font-size: 12px;
  white-space: nowrap;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  color: var(--color-text-muted);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.mode-tab:hover {
  color: var(--color-text);
}
.mode-tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

/* 控制按钮 */
.controls {
  display: flex;
  gap: 8px;
}
.controls .btn {
  flex: 1;
  white-space: nowrap;
}

/* 实时检测 */
.frames {
  float: right;
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: normal;
}
.det-list {
  font-size: 11px;
  max-height: 100px;
  overflow-y: auto;
}
.det-item {
  background: var(--bg-input);
  padding: 4px 6px;
  margin-bottom: 3px;
  border-radius: 4px;
  border-left: 3px solid var(--border-color);
  display: flex;
  justify-content: space-between;
}
.det-item .cls {
  font-weight: bold;
}
.det-item .conf {
  color: var(--color-success);
}
.empty {
  color: var(--color-text-muted);
  text-align: center;
  padding: 12px;
  font-size: 12px;
}
/* OCR 裁剪预览（核对截取区域） */
.ocr-crop {
  margin-top: 10px;
  border-top: 1px dashed var(--border-color);
  padding-top: 10px;
}
.ocr-crop-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  margin-bottom: 6px;
}
.ocr-crop-head .k {
  font-weight: 600;
  color: var(--color-text);
}
.ocr-crop-head .v {
  color: var(--color-text-muted);
  font-family: 'SF Mono', Menlo, monospace;
}
.ocr-crop-body {
  display: flex;
  justify-content: center;
  background: #000;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px;
  min-height: 80px;
  align-items: center;
}
.ocr-crop-img {
  max-width: 100%;
  max-height: 260px;
  image-rendering: pixelated;
  border-radius: 4px;
}
.ocr-crop-tip {
  font-size: 11px;
  color: var(--color-text-muted);
  margin: 6px 0 0;
  line-height: 1.5;
}
/* 最近识别坐标 */
.latest-coord {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.coord-map {
  font-size: 15px;
  font-weight: 700;
}
.coord-hint {
  font-size: 11px;
  color: var(--color-text-muted);
}
.error {
  color: var(--color-danger);
  font-size: 12px;
}

/* 4×5 网格 —— 还原梦幻西游物品栏外观 */
.fentu-grid {
  display: grid;
  grid-template-columns: repeat(5, 96px);
  grid-template-rows: repeat(4, 96px);
  gap: 4px;
  background: #b9bec9;
  border: 3px solid #9aa1b0;
  border-radius: 8px;
  padding: 5px;
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.22);
}
.cell {
  position: relative;
  background: #e3e5ec;
  border: 1px solid #b3b9c6;
  border-radius: 5px;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.8),
    inset 0 -1px 2px rgba(0, 0, 0, 0.1);
  color: #7f8693;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2px;
  overflow: hidden;
}
.cell.filled {
  background: linear-gradient(150deg, #eef0f5, #e3e6ee);
  border: 1px solid #aab0bd;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.85), inset 0 -1px 2px rgba(0, 0, 0, 0.06);
  color: #2b2f3a;
}
.cell-num {
  font-size: 46px;
  font-weight: 800;
  line-height: 1;
  font-family: 'SF Mono', Menlo, monospace;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.cell-map {
  font-size: 15px;
  font-weight: 800;
  margin-top: 3px;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: normal;
  overflow: visible;
  text-overflow: unset;
  line-height: 1.2;
  letter-spacing: 0.5px;
  color: #1b1e26;
}
.legend {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 6px;
  text-align: center;
}
</style>
