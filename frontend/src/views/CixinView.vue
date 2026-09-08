<script setup lang="ts">
import { ref, onUnmounted, onMounted, computed, watch } from 'vue'
import { useCixinStore } from '@/stores/cixinStore'
import { analyzeUploadedImage, analyzeManualRect, runSolve } from '@/services/cixinLogic'
import { loadImageData, detectBoard, legalMoves as calcLegalMoves, type DetectedBoard } from '@/services/cixinDetect'
import BoardCanvas from '@/components/cixin/BoardCanvas.vue'
import MapStage from '@/components/cixin/MapStage.vue'
import StrengthControl from '@/components/cixin/StrengthControl.vue'
import ScreenShare from '@/components/common/ScreenShare.vue'

// 内联地图面板里的 MapStage（用于浏览器原生画中画：复制其 canvas）
const mapStageRef = ref<InstanceType<typeof MapStage> | null>(null)

const store = useCixinStore()
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)

const board = computed(() => store.detection?.board ?? new Array(64).fill(0))
const action = computed(() => store.result?.action ?? null)
const legalMoves = computed(() => store.result?.legal_moves ?? [])
const coordinate = computed(() => store.result?.coordinate ?? null)
const boxes = computed(() => store.detection?.boxes ?? [])
/** 原生画中画提示文案（无落点时点击按钮显示，提示先识别棋盘） */
const pipHint = ref('')

// 速刷模式优先地图对应的棋盘格（慈心坐标表）：长寿村 / 朱紫国 / 傲来国
const TASK_CELLS = [
  2, 3, 4, 5, 6, 8, // 长寿村
  18, 26, 34, // 朱紫国
  22, 30, 38, 46, 54, // 傲来国
]

// —— 后台检测循环（屏幕共享时，捕获整帧自动识别+求解，不在页面内联展示画面） ——
const sharing = ref(false)
let detTimer: number | null = null
const VOTE_K = 3 // 跨帧投票帧数：纯 CV 比小模型更脆，需多数决抑制单帧抖动
let boardBuf: number[][] = [] // 最近 VOTE_K 帧原始 board（环形缓冲）
let voteSig = '' // 上一帧投票结果签名
let voteStable = 0 // 投票结果连续一致帧数（对齐 mhxyai：连续 2 帧相同才确认/触发搜索）
let failCount = 0 // 连续识别失败帧数（对齐 mhxyai 的 tt/Ke：短时丢帧不闪）
let lastShownBoard: number[] | null = null // 最近一次稳定显示的有效棋盘（用于子数骤降守卫）
let solvedSig = '' // 已触发 AI 求解的棋盘签名（去重，对齐 mhxyai 的 U）
let computing = false

function onShareStarted() {
  sharing.value = true
  store.setSharing(true)
  store.resetResult()
  startDetectLoop()
}
function onShareStopped() {
  sharing.value = false
  store.setSharing(false)
  stopDetectLoop()
  boardBuf = []
  voteSig = ''
  voteStable = 0
  failCount = 0
  lastShownBoard = null
  solvedSig = ''
}
function startDetectLoop() {
  const loop = async () => {
    if (!sharing.value) { detTimer = null; return }
    await detectTick()
    detTimer = window.setTimeout(loop, 700)
  }
  loop()
}
/**
 * 多数决：对缓冲中的最近 VOTE_K 帧按格投票，得到抑制了单帧抖动后的稳定棋盘。
 * 纯 CV 每帧网格对齐/阈值都有抖动，单帧 board 不可靠；跨帧投票可把偶发误判（某格空/子翻转）
 * 在多数帧的共识下纠正回来。mhxyai 用视觉小模型、同一棋盘每帧结果确定，无需此步；
 * 我们的纯 CV 必须靠投票才能稳定收敛，否则精确签名永远对不齐、搜索永不触发（卡在"等待稳定"）。
 */
function voteBoard(): number[] {
  const ref0 = boardBuf[0]
  const n = ref0.length
  const out = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let bc = 0, wc = 0, ec = 0
    for (const b of boardBuf) {
      const v = b[i]
      if (v === 1) bc++
      else if (v === -1) wc++
      else ec++
    }
    if (bc >= wc && bc >= ec) out[i] = 1
    else if (wc >= bc && wc >= ec) out[i] = -1
    else out[i] = 0
  }
  return out
}

async function detectTick() {
  if (computing || !screenShareRef.value) return
  const dataUrl = screenShareRef.value.captureFull()
  if (!dataUrl) return
  let img: ImageData
  try {
    img = await loadImageData(dataUrl)
  } catch {
    return
  }
  const det = detectBoard(img)
  // 游戏画面没有棋盘（识别失败）：不清空前端，连续失败 Ke=3 才清屏（对齐 mhxyai，短时丢帧不闪）
  if (!det || !det.isPlausible) {
    failCount++
    if (failCount >= 3) {
      boardBuf = []
      voteSig = ''
      voteStable = 0
      lastShownBoard = null
      store.setDetection(null)
    }
    return
  }
  failCount = 0
  // 子数骤降守卫（针对纯 CV 比小模型更脆）：本帧相对已稳定棋盘丢失超 40% 棋子，
  // 视为误识别，丢弃本帧、不入缓冲、保留上一帧，避免"棋盘突然没棋子"闪烁。
  if (lastShownBoard && shouldDropAsFlicker(det, lastShownBoard)) return
  // 入投票缓冲
  boardBuf.push(det.board.slice())
  if (boardBuf.length > VOTE_K) boardBuf.shift()
  // 多数决得到稳定棋盘 + 重算合法走子
  const vb = voteBoard()
  const whiteMoves = calcLegalMoves(vb, -1)
  const blackMoves = calcLegalMoves(vb, 1)
  const vSig = vb.join(',')
  // 展示投票后棋盘（视觉稳定，不再每帧抖）
  store.setDetection({ ...det, board: vb, whiteMoves, blackMoves, isPlausible: true })
  lastShownBoard = vb.slice()
  // 投票结果连续一致（对齐 mhxyai：连续 2 帧相同才确认棋局 / 触发搜索）
  if (vSig === voteSig) voteStable++
  else { voteSig = vSig; voteStable = 0 }
  if (voteStable >= 1 && whiteMoves.length > 0 && vSig !== solvedSig) {
    solvedSig = vSig
    computing = true
    // 用投票后稳定棋盘求解（后端按 board 重算合法走子）
    await runSolve({ ...det, board: vb, boxes: det.boxes })
    computing = false
  }
}

/**
 * 棋子数骤降判定（防"棋盘突然没棋子"的识别抖动）。
 * 基准棋盘棋子较少（<8）时不启用守卫，避免误丢开局/残局的正常低子数局面。
 */
function shouldDropAsFlicker(det: DetectedBoard, base: number[]): boolean {
  const baseStones = base.filter((v) => v !== 0).length
  if (baseStones < 8) return false
  const curStones = det.board.filter((v) => v !== 0).length
  return curStones < baseStones * 0.6
}
function stopDetectLoop() {
  if (detTimer) { clearTimeout(detTimer); detTimer = null }
}

// 页面可见性变化：切回前台时，video 可能已被浏览器暂停、且后台累积的可能是冻结帧，
// 重置检测稳定状态并重新 play()，避免恢复后用旧帧误判 / 继续"检查不到东西"。
function onVisibilityChange() {
  if (document.hidden) return
  failCount = 0
  boardBuf = []
  voteSig = ''
  voteStable = 0
  lastShownBoard = null
  solvedSig = ''
  screenShareRef.value?.ensurePlaying()
}
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange))

// —— 上传图片测试 + 框选（角落浮窗，不占主布局） ——
const previewImage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const stage = ref<HTMLDivElement | null>(null)
const selecting = ref(false)
const sel = ref({ x: 0, y: 0, w: 0, h: 0 })
let dragStart: { x: number; y: number } | null = null

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}
async function onImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  previewImage.value = await fileToDataUrl(file)
  await analyzeUploadedImage(previewImage.value)
  input.value = ''
}
function clearImage() {
  previewImage.value = ''
  cancelSelect()
}
function stageRect(): DOMRect {
  return stage.value!.getBoundingClientRect()
}
function onStageDown(e: MouseEvent) {
  if (!selecting.value) return
  const r = stageRect()
  dragStart = { x: e.clientX - r.left, y: e.clientY - r.top }
  sel.value = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 }
}
function onStageMove(e: MouseEvent) {
  if (!selecting.value || !dragStart) return
  const r = stageRect()
  const x = Math.max(0, Math.min(r.width, e.clientX - r.left))
  const y = Math.max(0, Math.min(r.height, e.clientY - r.top))
  sel.value = {
    x: Math.min(dragStart.x, x),
    y: Math.min(dragStart.y, y),
    w: Math.abs(x - dragStart.x),
    h: Math.abs(y - dragStart.y)
  }
}
function onStageUp() {
  dragStart = null
  if (sel.value.w >= 10 && sel.value.h >= 10) void confirmSelect()
}
function startSelect() {
  if (!previewImage.value) return
  selecting.value = true
  sel.value = { x: 0, y: 0, w: 0, h: 0 }
  window.addEventListener('mousemove', onStageMove)
  window.addEventListener('mouseup', onStageUp)
}
function cancelSelect() {
  selecting.value = false
  sel.value = { x: 0, y: 0, w: 0, h: 0 }
  dragStart = null
  window.removeEventListener('mousemove', onStageMove)
  window.removeEventListener('mouseup', onStageUp)
}
async function confirmSelect() {
  const el = imgEl.value
  if (!el || !previewImage.value) return
  const r = stageRect()
  if (r.width < 1 || r.height < 1) return
  const sx = el.naturalWidth / r.width
  const sy = el.naturalHeight / r.height
  const rect = {
    x: sel.value.x * sx,
    y: sel.value.y * sy,
    width: sel.value.w * sx,
    height: sel.value.h * sy
  }
  selecting.value = false
  window.removeEventListener('mousemove', onStageMove)
  window.removeEventListener('mouseup', onStageUp)
  await analyzeManualRect(previewImage.value, rect)
}

onUnmounted(() => {
  stopDetectLoop()
  window.removeEventListener('mousemove', onStageMove)
  window.removeEventListener('mouseup', onStageUp)
  cleanupNativePip()
})

// ========== 浏览器原生画中画（与 ghost_monitor.html 一致：canvas → captureStream → video → PiP）==========
// 原生 PiP 是浏览器/系统级独立窗口，主浏览器窗口最小化后它依然留在屏幕上
// 一旦 AI 给出落点坐标（coordinate 出现），自动清除「请先识别棋盘」提示
watch(coordinate, (c) => {
  if (c) pipHint.value = ''
})

const pipCanvasRef = ref<HTMLCanvasElement | null>(null)
const pipVideoRef = ref<HTMLVideoElement | null>(null)
let pipStream: MediaStream | null = null
let pipTimer: number | null = null
const nativePipOn = ref(false)

function copyMapToPipCanvas() {
  const src = mapStageRef.value?.getCanvas()
  const dst = pipCanvasRef.value
  if (!src || !dst) return
  if (dst.width !== src.width || dst.height !== src.height) {
    dst.width = src.width
    dst.height = src.height
  }
  const ctx = dst.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, dst.width, dst.height)
  ctx.drawImage(src, 0, 0)
}

async function toggleNativePip() {
  if (!document.pictureInPictureEnabled) {
    alert('当前浏览器不支持画中画（请使用 Chrome / Edge / Safari）')
    return
  }
  try {
    // 已在画中画 → 退出
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture()
      return
    }
    // 需要已有落点地图；无落点时给内联提示，不弹窗打断
    if (!mapStageRef.value?.hasContent()) {
      pipHint.value = '请先识别棋盘，等待 AI 给出落点坐标后再开启画中画'
      return
    }
    pipHint.value = ''
    // 画首帧 + 创建流
    copyMapToPipCanvas()
    const video = pipVideoRef.value!
    video.muted = true
    video.playsInline = true
    if (!pipStream) {
      pipStream = (pipCanvasRef.value as HTMLCanvasElement).captureStream(8)
      video.srcObject = pipStream
      await video.play()
    }
    // 持续把最新地图复制到 PiP canvas（落点呼吸/坐标变化都会刷新）
    if (!pipTimer) {
      pipTimer = window.setInterval(copyMapToPipCanvas, 120)
    }
    await video.requestPictureInPicture()
    nativePipOn.value = true
  } catch (e) {
    console.error('慈心原生画中画开启失败:', e)
    const msg = e instanceof Error ? e.message : String(e)
    // 把失败原因暴露给用户（如浏览器不支持 captureStream→PiP，常见于 Safari）
    pipHint.value = `画中画开启失败：${msg || '浏览器不支持'}（建议用 Chrome / Edge）`
    cleanupNativePip()
  }
}

function onLeavePictureInPicture() {
  nativePipOn.value = false
  cleanupNativePip()
}

function cleanupNativePip() {
  if (pipTimer) {
    clearInterval(pipTimer)
    pipTimer = null
  }
  if (pipStream) {
    pipStream.getTracks().forEach((t) => t.stop())
    pipStream = null
  }
}
</script>

<template>
  <div class="cixin-page">
    <div class="cixin-content">
    <!-- 工具栏 -->
    <div class="toolbar-card">
      <div class="toolbar-actions">
        <StrengthControl v-model="store.strength" />
        <div class="strategy-switch" role="radiogroup" aria-label="策略">
          <button
            type="button"
            class="seg"
            :class="{ active: store.strategy === 'winFirst' }"
            @click="store.setStrategy('winFirst')"
            title="优先赢棋（默认）"
          >♟ 胜负</button>
          <button
            type="button"
            class="seg"
            :class="{ active: store.strategy === 'boxFirst' }"
            @click="store.setStrategy('boxFirst')"
            title="优先抢宝箱"
          >🎁 宝箱</button>
          <button
            type="button"
            class="seg"
            :class="{ active: store.strategy === 'taskFirst' }"
            @click="store.setStrategy('taskFirst')"
            title="速刷：优先前往落地可刷任务的地图（长寿村/朱紫国/傲来国）"
          >⚡ 速刷</button>
        </div>
        <button class="btn btn-secondary" @click="fileInput?.click()">📷 上传图片测试</button>
        <button class="btn btn-ghost" @click="toggleNativePip" :class="{ active: nativePipOn }" title="浏览器原生画中画：浮出为系统级独立窗口，主浏览器最小化后仍在屏幕上">
          📍 原生画中画
        </button>
        <span v-if="pipHint" class="pip-hint">{{ pipHint }}</span>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onImageSelected" />
        <span class="status" :class="{ computing: store.isComputing, error: store.error }">
          {{ store.statusText }}
        </span>
      </div>
    </div>

    <!-- 主区：♟️ 棋盘（左） + 🗺️ 地图落点（右，内联展示） -->
    <div class="workspace">
      <section class="panel">
        <h3>♟️ 识别棋盘</h3>
        <BoardCanvas :board="board" :action="action" :boxes="boxes" :legal-moves="legalMoves" :task-cells="TASK_CELLS" :strategy="store.strategy" />
        <div class="legend">
          <span class="lg lg-legal"><i></i>可落点</span>
          <span class="lg lg-action"><i></i>AI 推荐</span>
          <span class="lg lg-box" v-if="store.detection?.counts.box">🎁 宝箱</span>
        </div>
        <div class="strategy-hint" v-if="store.strategy === 'taskFirst'">
          ⚡ 速刷：AI 优先落子在 <b>长寿村 / 朱紫国 / 傲来国</b>（落地即可刷任务，已金色高亮）
        </div>
        <div class="counts" v-if="store.detection">
          黑 {{ store.detection.counts.black }} · 白
          {{ store.detection.counts.white }} · 空
          {{ store.detection.counts.empty }} ·
          <span :class="{ 'box-count': store.detection.counts.box > 0 }">宝箱 {{ store.detection.counts.box }}</span>
          · 置信 {{ (store.detection.confidence * 100).toFixed(0) }}%
        </div>
        <p class="hint" v-else>
          点击左侧「慈心监控」竖条开始共享游戏窗口，或点「上传图片测试」截图验证
        </p>
      </section>

      <section class="panel map-panel">
        <h3>🗺️ 地图落点</h3>
        <MapStage ref="mapStageRef" :coordinate="coordinate" />
        <p class="map-legend"><span class="ml-dot"></span>白子黄圈＝AI 落点坐标（呼吸黄环处即落子位置）</p>
      </section>
    </div>
    </div>

    <!-- 屏幕共享控件（与挖图助手一致：左侧竖条 + 🖼 浮窗即「画中画」，不在主区展示画面） -->
    <ScreenShare
      ref="screenShareRef"
      label="慈心监控"
      :display-preview="true"
      @started="onShareStarted"
      @stopped="onShareStopped"
    />

    <!-- 浏览器原生画中画所需的隐藏 canvas + video（地图经此浮出为系统级窗口） -->
    <canvas ref="pipCanvasRef" style="position: fixed; top: -9999px; left: -9999px;" width="380" height="300" />
    <video
      ref="pipVideoRef"
      muted
      playsinline
      style="position: fixed; top: -9999px; left: -9999px;"
      @leavepictureinpicture="onLeavePictureInPicture"
    />

    <!-- 上传图片测试浮窗（框选用，固定在右下角，不占主布局） -->
    <div v-if="previewImage" class="test-float">
      <div class="tf-head">
        <span>📷 图片测试</span>
        <div class="tf-head-actions">
          <button v-if="!selecting" class="mini" @click="startSelect" :disabled="!previewImage">框选棋盘</button>
          <button v-else class="mini danger" @click="cancelSelect">取消框选</button>
          <button class="mini" @click="clearImage" title="关闭">✕</button>
        </div>
      </div>
      <div class="tf-body">
        <div v-if="previewImage" class="preview-stage" ref="stage">
          <img
            ref="imgEl"
            :src="previewImage"
            class="preview"
            alt="测试图"
            draggable="false"
            @dragstart.prevent
            @mousedown.prevent="onStageDown"
          />
          <div v-if="selecting" class="sel-hint">在棋盘上按住拖出 8×8 方框</div>
          <div
            v-if="selecting"
            class="sel-overlay"
            :style="{ left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' }"
          ></div>
        </div>
        <p v-else class="tf-empty">加载中…</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cixin-page {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--color-text, #eee);
}
.cixin-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  min-height: 0;
}
.toolbar-card {
  background: var(--bg-card, #16213e);
  border: 1px solid var(--border-color, #2a4d7a);
  border-radius: 10px;
  padding: 7px 12px;
  width: 100%;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.status {
  font-size: 14px;
  color: var(--color-text-muted, #9bb);
}
.status.computing {
  color: var(--color-secondary, #4fc3f7);
}
.status.error {
  color: #ff6b6b;
}

/* 主区：左右排版，紧凑 */
.workspace {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: stretch;
}
.panel {
  flex: 1 1 340px;
  min-width: 300px;
  background: var(--bg-card, #16213e);
  border: 1px solid var(--border-color, #2a4d7a);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.panel h3 {
  font-size: 14px;
  margin: 0;
  width: 100%;
  color: var(--color-text, #eee);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
/* 地图落点图例 */
.map-legend {
  margin: 8px 2px 0;
  font-size: 12px;
  color: var(--color-text-muted, #9bb);
  display: flex;
  align-items: center;
  gap: 6px;
}
.map-legend .ml-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: radial-gradient(circle at 35% 30%, #ffffff, #d4d4d4);
  border: 2px solid #ffce3a;
  box-shadow: 0 0 5px 1px rgba(255, 206, 58, 0.7);
}
.counts {
  font-size: 12px;
  color: var(--color-text-muted, #9bb);
}
.box-count {
  color: #ffc864;
  font-weight: 600;
}
.strategy-hint {
  font-size: 12px;
  color: #ffc864;
  background: rgba(255, 200, 100, 0.1);
  border: 1px solid rgba(255, 200, 100, 0.35);
  border-radius: 6px;
  padding: 4px 8px;
  text-align: center;
}
.strategy-hint b {
  color: #ffe0a0;
}

/* 棋盘标记图例 */
.legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted, #9bb);
}
.legend .lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend .lg i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  display: inline-block;
}
.legend .lg-legal i {
  background: radial-gradient(circle at 40% 35%, #eafff4, #4fe0a0 70%);
  box-shadow: 0 0 6px 1px rgba(79, 224, 160, 0.7);
}
.legend .lg-action i {
  box-sizing: border-box;
  background: radial-gradient(circle at 35% 30%, #ffffff, #d4d4d4);
  border: 2px solid #ffce3a;
  box-shadow: 0 0 5px 1px rgba(255, 206, 58, 0.7);
}

/* 策略分段控件（胜负 / 宝箱） */
.strategy-switch {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-color, #2a4d7a);
  border-radius: 6px;
  padding: 2px;
}
.strategy-switch .seg {
  border: none;
  background: transparent;
  color: var(--color-text-muted, #9bb);
  font-size: 13px;
  padding: 4px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-weight: 600;
  transition: all 0.15s ease;
}
.strategy-switch .seg:hover {
  color: var(--color-text, #eee);
}
.strategy-switch .seg.active {
  background: var(--bg-input, #0f3460);
  color: var(--color-secondary, #4fc3f7);
  box-shadow: 0 0 0 1px var(--color-secondary, #4fc3f7);
}
.hint {
  font-size: 12px;
  color: var(--color-text-muted, #9bb);
  text-align: center;
  line-height: 1.6;
  margin: 4px 0 0;
}

/* 按钮基础样式（与挖图助手等保持一致） */
.btn {
  border: none;
  border-radius: 6px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 600;
}
.btn-secondary {
  background: #3a6ea5;
  color: #fff;
}
.btn-ghost {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text, #eee);
  border: 1px solid var(--border-color, #2a4d7a);
  padding: 7px 14px;
}
.btn-ghost:hover {
  border-color: var(--color-primary, #4fc3f7);
  background: rgba(79, 195, 247, 0.12);
}
.btn-ghost.active {
  border-color: #ffce3a;
  background: rgba(255, 206, 58, 0.18);
  color: #ffce3a;
}

/* 地图面板：内联常驻展示 */
.map-panel {
  align-items: stretch;
}

/* 原生画中画无落点时的内联提示 */
.pip-hint {
  font-size: 12px;
  color: #ffc864;
  background: rgba(255, 200, 100, 0.12);
  border: 1px solid rgba(255, 200, 100, 0.4);
  border-radius: 6px;
  padding: 4px 10px;
  white-space: nowrap;
}

/* 上传图片测试浮窗（右下角，不挡主区） */
.test-float {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9998;
  width: 360px;
  max-width: calc(100vw - 32px);
  background: var(--bg-card, #16213e);
  border: 1px solid var(--border-color, #2a4d7a);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}
.tf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-panel, #0f3460);
  border-bottom: 1px solid var(--border-color, #2a4d7a);
  font-size: 12px;
  color: var(--color-secondary, #4fc3f7);
}
.tf-head-actions {
  display: flex;
  gap: 4px;
}
.mini {
  padding: 3px 9px;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 6px;
  border: 1px solid var(--border-color, #2a4d7a);
  background: var(--bg-input, #0f3460);
  color: var(--color-text, #eee);
  cursor: pointer;
}
.mini:hover {
  border-color: var(--color-primary, #4fc3f7);
}
.mini:disabled {
  opacity: 0.5;
  cursor: default;
}
.mini.danger {
  border-color: #e74c3c;
  color: #ff8a7a;
}
.tf-body {
  background: #000;
  line-height: 0;
  display: flex;
  justify-content: center;
}
.preview-stage {
  position: relative;
  display: inline-block;
  line-height: 0;
  max-width: 100%;
  user-select: none;
}
.preview {
  display: block;
  max-width: 100%;
  max-height: 56vh;
  cursor: crosshair;
  user-select: none;
  -webkit-user-drag: none;
}
.sel-hint {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  background: rgba(10, 15, 31, 0.85);
  color: #4fc3f7;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 2;
}
.sel-overlay {
  position: absolute;
  border: 2px dashed #4fc3f7;
  background: rgba(79, 195, 247, 0.18);
  pointer-events: none;
  box-sizing: border-box;
}
.tf-empty {
  display: block;
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted, #9bb);
  font-size: 12px;
}
</style>
