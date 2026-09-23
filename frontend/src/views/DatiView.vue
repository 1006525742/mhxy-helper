<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ScreenCapture } from '@/services/screenCapture'
import { initYOLO, runYOLO, isModelLoaded, type Detection } from '@/services/onnxYolo'
import { initDatiBank, matchIconLocal, isBankReady, bankSize, type DatiCandidate } from '@/services/datiMatcher'

const cap = new ScreenCapture()
const sharing = ref(false)
const previewUrl = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)

// 屏幕监控模式
const monitoring = ref(false)
let monitorTimer: number | null = null
const monitorLog = ref<string[]>([])

const result = ref<any>(null)
const loading = ref(false)
const error = ref('')
const status = ref('')

// 选项匹配
const optionsText = ref('')
const optionResult = ref<any>(null)

// 手动拖拽裁剪框 (显示坐标 px)
const sel = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let dragging = false
let startX = 0
let startY = 0

// ===== 自动框题（dati YOLO）=====
// 注：mhxyai 前端加载 dati 时传 labels:[]（无类别名），选框靠「置信度排序 + top-left 落于画面内侧(x>100,y>100)」
// 而非 class 索引。因此本模块同样不依赖类别语义，直接复用该几何启发式。
const MODEL_PATH = '/models/dati_best.onnx'
// 模型 metadata names（Ultralytics 训练）：0=签到答题 1=安全问答 2=梦幻课堂 3=科举
// 这是「面板级」检测：一屏只会出一个答题面板框，不检测单个选项格
const DATI_CLASSES = ['签到答题', '安全问答', '梦幻课堂', '科举']
const modelLoading = ref(false)
const modelReady = ref(false)
const autoMode = ref(false)
const autoWarn = ref(false)
const detections = ref<Detection[]>([]) // 视频原生坐标
const monitorDetections = ref<Detection[]>([]) // 屏幕监控模式的 YOLO 框（视频原生坐标）
const selBox = ref<Detection | null>(null) // 当前选中的图标框（视频原生坐标）
let detectTimer: number | null = null
let lastAutoMatch = 0

// ===== 本地题库（175dt 式：纯前端匹配，不依赖后端识别）=====
const bankReady = ref(false)
const bankLoading = ref(false)
const useLocal = ref(true) // 本地优先，失败自动回落后端
const localMs = ref(0)
const matchVia = ref('')

async function loadBank() {
  if (bankReady.value) return true
  bankLoading.value = true
  const ok = await initDatiBank()
  bankReady.value = ok
  bankLoading.value = false
  if (ok) status.value = `本地题库已加载（${bankSize()} 条技能，纯前端匹配）`
  return ok
}

// 统一匹配入口：本地优先，失败回落后端
async function doMatch(canvas: HTMLCanvasElement): Promise<{ cands: DatiCandidate[]; via: string; ms: number }> {
  if (useLocal.value) {
    if (!bankReady.value) await loadBank()
    if (isBankReady()) {
      const t0 = performance.now()
      const cands = matchIconLocal(canvas, 5)
      const ms = performance.now() - t0
      if (cands.length) return { cands, via: '本地', ms }
    }
  }
  // 回落后端
  const t0 = performance.now()
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
  const fd = new FormData()
  fd.append('img', blob, 'icon.png')
  const res = await fetch('/api/dati/icon-match', { method: 'POST', body: fd })
  const j = await res.json()
  if (!j.success) throw new Error(j.error || '后端匹配失败')
  return {
    cands: (j.candidates || []).map((c: any) => ({
      name: c.name, school: c.school,
      mtScore: c.mt_score ?? c.score, hashScore: c.score, icon: c.icon,
    })),
    via: '后端',
    ms: performance.now() - t0,
  }
}

async function loadDatiModel() {
  if (modelReady.value) return true
  if (modelLoading.value) return false
  modelLoading.value = true
  const ok = await initYOLO({
    modelPath: MODEL_PATH,
    inputSize: 480,
    confidenceThreshold: 0.4,
    classNames: DATI_CLASSES,
    letterbox: true, // 必须：YOLO 训练用 letterbox，直接拉伸会导致框偏移
  }).catch(() => false)
  modelReady.value = ok
  modelLoading.value = false
  // 加载失败不提示 —— 监控模式不依赖 YOLO，仅损失叠加显示
  return ok
}

async function toggleAuto() {
  if (!sharing.value) { status.value = '请先开始屏幕共享'; return }
  autoMode.value = !autoMode.value
  if (autoMode.value) {
    const ok = await loadDatiModel()
    if (!ok) { autoMode.value = false; return }
    status.value = '自动框题已开启：检测答题界面中...'
    startDetect()
  } else {
    stopDetect()
    detections.value = []
    selBox.value = null
    status.value = '自动框题已关闭'
  }
}

function startDetect() {
  if (detectTimer) return
  let lastDetTs = 0
  const loop = async () => {
    if (!autoMode.value) return
    const v = videoEl.value
    if (v && v.videoWidth && isModelLoaded()) {
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.drawImage(v, 0, 0)
          const imageData = ctx.getImageData(0, 0, c.width, c.height)
          const dets = await runYOLO(imageData)
          detections.value = dets
          if (dets.length) {
            lastDetTs = Date.now()
            autoWarn.value = false
            // 复用 mhxyai 的选框启发式：按置信度排序，取 top-left 落在画面内侧(>100,>100)的第一个框
            // （避开左上角 UI 装饰），与类别索引无关
            const thrX = 100 * (v.videoWidth / 480)
            const thrY = 100 * (v.videoHeight / 480)
            const sorted = [...dets].sort((a, b) => b.conf - a.conf)
            const pick = sorted.find((d) => d.x1 > thrX && d.y1 > thrY) || sorted[0]
            selBox.value = pick
            const now = Date.now()
            if (now - lastAutoMatch > 1200) {
              lastAutoMatch = now
              await matchIconBox(pick)
            }
          } else if (Date.now() - lastDetTs > 3000) {
            autoWarn.value = true
          }
        }
      } catch (e: any) {
        error.value = '检测失败: ' + e.message
      }
    }
    detectTimer = window.setTimeout(loop, 500)
  }
  loop()
}

function stopDetect() {
  if (detectTimer) { clearTimeout(detectTimer); detectTimer = null }
}

async function toggleMonitor() {
  if (monitoring.value) {
    stopMonitor()
    return
  }
  if (!sharing.value) {
    status.value = '请先开始屏幕共享，再开启自动答题监控'
    return
  }
  monitoring.value = true
  status.value = '自动答题中…'
  monitorLog.value = []
  monitorDetections.value = []
  runMonitorLoop()
  // YOLO 模型静默加载，仅用于叠加检测框，失败也不影响答题
  loadDatiModel().then((ok) => {
    if (ok && monitoring.value) monitorDetections.value = [] // 清空，等待检测
  })
}

function stopMonitor() {
  if (!monitoring.value) return
  monitoring.value = false
  status.value = '屏幕监控已停止'
  monitorAnswer.value = null
  monitorDetections.value = []
  if (monitorTimer) { clearTimeout(monitorTimer); monitorTimer = null }
}

async function runMonitorLoop() {
  if (!monitoring.value || !sharing.value) return
  const v = videoEl.value
  if (!v || !v.videoWidth) {
    monitorTimer = window.setTimeout(runMonitorLoop, 500)
    return
  }

  // YOLO 检测框：既叠加展示，也作为后端定位基准（YOLO 框内相对比例）
  let yoloPanel: Detection | null = null
  if (isModelLoaded()) {
    try {
      const cy = document.createElement('canvas')
      cy.width = v.videoWidth
      cy.height = v.videoHeight
      const cty = cy.getContext('2d')
      if (cty) {
        cty.drawImage(v, 0, 0)
        const dets = await runYOLO(cty.getImageData(0, 0, cy.width, cy.height))
        monitorDetections.value = dets
        if (dets.length) yoloPanel = [...dets].sort((a, b) => b.conf - a.conf)[0]
      }
    } catch (e) {
      // 检测异常不打断答题链路
    }
  }

  // 将视频帧缩放到后端标定分辨率（约 800px 宽）再上传，避免高分辨率下 OCR 阈值失效
  const maxW = 800
  const scale = v.videoWidth > maxW ? maxW / v.videoWidth : 1
  const w = Math.round(v.videoWidth * scale)
  const h = Math.round(v.videoHeight * scale)

  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.drawImage(v, 0, 0, w, h)

  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'))
  const fd = new FormData()
  fd.append('img', blob, 'screen.png')
  // YOLO 面板框：视频原生坐标 -> 缩放后上传图坐标，再交给后端做相对定位
  if (yoloPanel) {
    const k = w / v.videoWidth
    fd.append('panel', [
      (yoloPanel.x1 * k).toFixed(1), (yoloPanel.y1 * k).toFixed(1),
      (yoloPanel.x2 * k).toFixed(1), (yoloPanel.y2 * k).toFixed(1),
    ].join(','))
  }

  loading.value = true
  try {
    const t0 = performance.now()
    const resp = await fetch('/api/dati/solve-image', { method: 'POST', body: fd })
    const j = await resp.json()
    const ms = performance.now() - t0

    if (j.success) {
      solveResult.value = j
      monitorLog.value.push(
        `[${new Date().toLocaleTimeString()}] ${j.best_letter || '?'} · ${j.best?.name || '?'} (NCC ${(j.best?.score ?? 0).toFixed(3)}) ${ms.toFixed(0)}ms`
      )
      if (monitorLog.value.length > 20) monitorLog.value.shift()
      // 答案红框：answer_box 是缩放后上传图(w×h)坐标，换算回视频原生坐标
      if (j.answer_box && j.best_letter) {
        const f = v.videoWidth / w
        const b = j.answer_box
        const pad = 5
        monitorAnswer.value = {
          x1: Math.max(0, (b.x - pad) * f), y1: Math.max(0, (b.y - pad) * f),
          x2: (b.x + b.w + pad) * f, y2: (b.y + b.h + pad) * f,
          conf: 1, classId: 0,
        }
      } else {
        monitorAnswer.value = null
      }
      if (j.best_letter && j.best?.score > 0.02) {
        error.value = ''
      } else {
        error.value = `置信度偏低（NCC=${j.best?.score}），未出现稳定答案`
      }
    }
  } catch (e: any) {
    error.value = '监控识别失败: ' + e.message
  } finally {
    loading.value = false
  }

  monitorTimer = window.setTimeout(runMonitorLoop, 1500)
}

// 视频原生坐标 -> 显示坐标
function toDisplay(d: Detection) {
  const v = videoEl.value
  const s = stageEl.value
  if (!v || !s) return { x: 0, y: 0, w: 0, h: 0 }
  const sx = s.clientWidth / v.videoWidth
  const sy = s.clientHeight / v.videoHeight
  return { x: d.x1 * sx, y: d.y1 * sy, w: (d.x2 - d.x1) * sx, h: (d.y2 - d.y1) * sy }
}

// 点击某个检测框 -> 设为图标框并匹配
function pickBox(d: Detection) {
  selBox.value = d
  matchIconBox(d)
}

// 裁剪视频原生坐标框 -> 按面板比例裁出题干小图标并匹配
async function matchIconBox(box: Detection) {
  const v = videoEl.value
  if (!v || !v.videoWidth) return
  // 如果 box 是完整面板，则按固定比例从中裁出小图标；若已是小框，则直接使用
  const bw = box.x2 - box.x1
  const bh = box.y2 - box.y1
  const useInner = bw > 80 && bh > 80 && (bw / bh) > 1.2 // 面板宽高比较大
  const ib = useInner
    ? {
        x1: box.x1 + bw * ICON_REL.x1,
        y1: box.y1 + bh * ICON_REL.y1,
        x2: box.x1 + bw * ICON_REL.x2,
        y2: box.y1 + bh * ICON_REL.y2,
      }
    : { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(ib.x2 - ib.x1))
  c.height = Math.max(1, Math.round(ib.y2 - ib.y1))
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.drawImage(v, ib.x1, ib.y1, c.width, c.height, 0, 0, c.width, c.height)
  loading.value = true
  error.value = ''
  try {
    const { cands, via, ms } = await doMatch(c)
    result.value = { candidates: cands }
    matchVia.value = via
    localMs.value = Math.round(ms)
    const top = cands[0]
    if (top && top.mtScore < 60) {
      error.value = `识别置信度偏低（${top.mtScore}%）：请确认框选的是【单个技能图标】（不要框整个题目/答案区），或框得更紧凑些后重试`
    } else {
      error.value = ''
    }
    if (optionsText.value.trim()) matchOptions(top?.name)
  } catch (e: any) {
    error.value = '匹配失败: ' + e.message
  } finally {
    loading.value = false
  }
}

async function startShare() {
  status.value = '正在请求屏幕共享...'
  const ok = await cap.start()
  if (!ok) {
    status.value = '屏幕共享失败（需 HTTPS 或 localhost，并授权）'
    return
  }
  sharing.value = true
  const s = cap.getStream()
  if (videoEl.value && s) videoEl.value.srcObject = s
  status.value = '屏幕共享已开启，自动答题中...'
  // 注：这里原本每帧（60fps）跑一次 getPreviewFrame()（全屏 JPEG 编码）写入 previewUrl，
  // 但模板里 previewUrl 只在「未共享」时才显示 → 共享中产出的数据永远看不见，纯烧 CPU，
  // 与 ScreenShare 的预览循环同属「点开监控后浏览器卡死/闪退」的诱因，已移除。
  // 共享中画面由 <video> 直出媒体流，零编码开销。
  // 共享后自动开始答题监控
  toggleMonitor()
}

function stopShare() {
  cap.stop()
  sharing.value = false
  previewUrl.value = ''
  if (videoEl.value) videoEl.value.srcObject = null
  sel.value = null
  if (autoMode.value) toggleAuto()
  if (monitoring.value) stopMonitor()
}

function onDown(e: MouseEvent) {
  if (autoMode.value) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dragging = true
  startX = e.clientX - r.left
  startY = e.clientY - r.top
  sel.value = { x: startX, y: startY, w: 0, h: 0 }
}
function onMove(e: MouseEvent) {
  if (!dragging || !sel.value) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const cx = Math.max(0, Math.min(e.clientX - r.left, r.width))
  const cy = Math.max(0, Math.min(e.clientY - r.top, r.height))
  sel.value = { x: Math.min(startX, cx), y: Math.min(startY, cy), w: Math.abs(cx - startX), h: Math.abs(cy - startY) }
}
function onUp() { dragging = false }

async function recognize() {
  if (!sel.value || sel.value.w < 8 || sel.value.h < 8) {
    error.value = '请先在画面上框选技能图标区域'
    return
  }
  const v = videoEl.value
  if (!v || !v.videoWidth) { error.value = '预览未就绪'; return }
  const rect = (document.querySelector('.preview-stage') as HTMLElement).getBoundingClientRect()
  const sx = v.videoWidth / rect.width
  const sy = v.videoHeight / rect.height
  const box: Detection = {
    x1: Math.round(sel.value.x * sx), y1: Math.round(sel.value.y * sy),
    x2: Math.round((sel.value.x + sel.value.w) * sx), y2: Math.round((sel.value.y + sel.value.h) * sy),
    conf: 1, classId: 0,
  }
  await matchIconBox(box)
}

async function matchOptions(recognized?: string) {
  const opts = optionsText.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean)
  if (opts.length === 0) { error.value = '请先填写 4 个选项文字（每行一个或逗号分隔）'; return }
  try {
    const res = await fetch('/api/dati/options-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: opts, recognized: recognized || result.value?.candidates?.[0]?.name || '' }),
    })
    optionResult.value = await res.json()
  } catch (e: any) {
    error.value = '选项匹配失败: ' + e.message
  }
}

async function reportError() {
  const name = prompt('请输入正确技能名（用于纠错扩充题库）：')
  if (!name) return
  await fetch('/api/dati/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correct_name: name }),
  })
  status.value = '已上报，感谢纠错！'
}

// ===== 本地图片上传测试 =====
// 完整跑通链路：上传图 -> 后端 /api/dati/solve-image 一体化识别（OCR 4 选项 + 受限图标匹配）
// 后端已完成：裁面板 -> 8001 OCR -> 175dt 受限匹配 -> best_letter
const fileInput = ref<HTMLInputElement | null>(null)
const uploadedUrl = ref('')
const testImgReady = ref(false)
const testLog = ref<string[]>([])
const testRunning = ref(false)
const imgNat = ref({ w: 0, h: 0 })
// solve-image 完整结果：{ options, best, best_letter, scores, used_fallback, time_ms }
const solveResult = ref<any>(null)
// 用于显示裁出的图标（仅展示）
const iconCropUrl = ref('')
// 测试面板框（用于模板叠加显示面板区域）
const panelBox = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
// 题目图标框（面板内比例换算回整图坐标，绿色叠加框，所见即后端实际裁切）
const iconBox = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
// 答案红框（OCR 选项文字 bbox，全图绝对像素，来自 solve-image 的 answer_box）
const answerBox = ref<{ x: number; y: number; w: number; h: number } | null>(null)
// ===== 调试可视化（排查"到底在哪块区域找、找到哪了"）=====
const searchBox = ref<{ x: number; y: number; w: number; h: number } | null>(null) // 模板滑窗搜索区
const iconCands = ref<any[]>([])      // 4 个候选各自的命中框 + NCC
const ocrWindow = ref<{ x: number; y: number; w: number; h: number } | null>(null) // OCR 候选窗口
const ocrBlocks = ref<any[]>([])      // OCR 全部文字块（含被过滤的）
const answerCells = ref<any[]>([])    // YOLO 选项区几何切分的 4 个答案格（A/B/C/D，识别前即可见）

// 各区域独立开关（逐个核对用）
const layers = ref({
  panel: true,    // 基准面板框（后端换算基准）
  yolo: true,     // YOLO 原始检测框
  search: true,   // 模板滑窗搜索区
  ocrwin: true,   // OCR 候选窗口
  blocks: true,   // OCR 全部文字块
  cands: true,    // 4 个候选命中框
  icon: true,     // 最佳候选绿框
  cells: true,    // 4 个答案格（OCR 文字位置 + options_zone 自适应切分，贴合真实色块）
  answer: true,   // 答案红框
})
const LAYER_LABELS = [
  { key: 'panel', label: '基准面板', color: '#e6d800' },
  { key: 'yolo', label: 'YOLO 检测框', color: '#e6b800' },
  { key: 'search', label: '模板搜索区', color: '#ff9f43' },
  { key: 'ocrwin', label: 'OCR 窗口', color: '#4dabf7' },
  { key: 'blocks', label: 'OCR 文字块', color: '#22d3ee' },
  { key: 'cands', label: '候选命中框', color: '#2ee6a0' },
  { key: 'icon', label: '最佳候选', color: '#2ee6a0' },
  { key: 'cells', label: '答案格(自适应)', color: '#c77dff' },
  { key: 'answer', label: '答案红框', color: '#ff4d4d' },
] as const
function allLayers(on: boolean) {
  Object.keys(layers.value).forEach((k) => { (layers.value as any)[k] = on })
}
function soloLayer(key: string) {
  Object.keys(layers.value).forEach((k) => { (layers.value as any)[k] = (k === key) })
}

function pctBox(b: { x: number; y: number; w: number; h: number }) {
  return {
    left: pct(b.x, imgNat.value.w) + '%', top: pct(b.y, imgNat.value.h) + '%',
    width: pct(b.w, imgNat.value.w) + '%', height: pct(b.h, imgNat.value.h) + '%',
  }
}
// 上传图片本地 YOLO 检测框（图片原生坐标）
const imgDetections = ref<Detection[]>([])
// 屏幕监控模式：答案红框（视频原生坐标，Detection 形状以便复用 toDisplay）
const monitorAnswer = ref<Detection | null>(null)

// 题目小图标在答题面板内的预估比例（仅在上传后、接口返回前先画个预估框；
// 后端已改为模板滑窗匹配，命中后接口返回 icon_box 会替换此框，此值不再需要和后端同步）
const ICON_REL = { x1: 0.29, y1: 0.09, x2: 0.41, y2: 0.29 }

function triggerUpload() { fileInput.value?.click() }

function onFilePicked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (uploadedUrl.value) URL.revokeObjectURL(uploadedUrl.value)
  uploadedUrl.value = URL.createObjectURL(f)
  testImgReady.value = false
  result.value = null
  optionResult.value = null
  solveResult.value = null
  iconCropUrl.value = ''
  panelBox.value = null
  iconBox.value = null
  answerBox.value = null
  imgDetections.value = []
  searchBox.value = null
  iconCands.value = []
  ocrWindow.value = null
  ocrBlocks.value = []
  answerCells.value = []
  const img = new Image()
  img.onload = () => {
    testImgReady.value = true
    imgNat.value = { w: img.naturalWidth, h: img.naturalHeight }
    runUploadTest(img)
  }
  img.src = uploadedUrl.value
}

async function runUploadTest(img: HTMLImageElement) {
  testRunning.value = true
  testLog.value = []
  error.value = ''
  solveResult.value = null
  const log = (s: string) => testLog.value.push(s)
  try {
    log(`① 图片 ${img.naturalWidth}×${img.naturalHeight}`)

    // 1) 客户端裁出题目小图标（仅用于显示，不影响匹配）
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    // PANEL_REL × ICON_REL 复合
    const px = { x1: 0.157, y1: 0.278, x2: 0.837, y2: 0.727 } // panel 相对整图
    const panelW = c.width * (px.x2 - px.x1)
    const panelH = c.height * (px.y2 - px.y1)
    const ix1 = c.width * px.x1 + panelW * ICON_REL.x1
    const iy1 = c.height * px.y1 + panelH * ICON_REL.y1
    const ix2 = c.width * px.x1 + panelW * ICON_REL.x2
    const iy2 = c.height * px.y1 + panelH * ICON_REL.y2
    panelBox.value = {
      x1: c.width * px.x1, y1: c.height * px.y1,
      x2: c.width * px.x2, y2: c.height * px.y2,
    }
    iconBox.value = { x1: ix1, y1: iy1, x2: ix2, y2: iy2 }
    const ic = document.createElement('canvas')
    ic.width = Math.max(1, Math.round(ix2 - ix1))
    ic.height = Math.max(1, Math.round(iy2 - iy1))
    ic.getContext('2d')!.drawImage(c, ix1, iy1, ic.width, ic.height, 0, 0, ic.width, ic.height)
    iconCropUrl.value = ic.toDataURL('image/png')
    log(`② 裁出图标 ${ic.width}×${ic.height}`)

    // 2) 先跑前端 YOLO 拿答题面板框：后端按「YOLO 框内相对比例」定位图标区与选项区
    let panelRect: { x1: number; y1: number; x2: number; y2: number } | null = null
    try {
      if (!isModelLoaded()) await loadDatiModel()
      if (isModelLoaded()) {
        const dets = await runYOLO(ctx.getImageData(0, 0, c.width, c.height))
        imgDetections.value = dets
        if (dets.length) {
          const top = [...dets].sort((a, b) => b.conf - a.conf)[0]
          panelRect = { x1: top.x1, y1: top.y1, x2: top.x2, y2: top.y2 }
          panelBox.value = { ...panelRect }
          log(`② YOLO 面板 (${top.x1.toFixed(0)},${top.y1.toFixed(0)})-(${top.x2.toFixed(0)},${top.y2.toFixed(0)}) `
              + `${(top.x2 - top.x1).toFixed(0)}×${(top.y2 - top.y1).toFixed(0)} ${(top.conf * 100).toFixed(0)}%`)
        } else {
          log('② YOLO 未检测到答题面板 → 后端回退固定比例')
        }
      }
    } catch (e: any) {
      log('② YOLO 检测失败: ' + e.message)
    }

    // 3) 整图发后端一体化识别
    loading.value = true
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'))
    const fd = new FormData()
    fd.append('img', blob, 'screen.png')
    // YOLO 面板框（后端据此换算图标区/选项区；不传则后端回退固定比例）
    if (panelRect) fd.append('panel', `${panelRect.x1},${panelRect.y1},${panelRect.x2},${panelRect.y2}`)
    // 用户在文本框手动填的 4 选项作为 fallback（OCR 失败时使用）
    const fb = optionsText.value.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
    if (fb.length >= 2) fd.append('fallback_options', fb.join(','))

    const t0 = performance.now()
    const resp = await fetch('/api/dati/solve-image', { method: 'POST', body: fd })
    const j = await resp.json()
    const ms = performance.now() - t0
    loading.value = false

    if (!j.success) {
      log('✗ ' + (j.error || '后端返回失败'))
      error.value = j.error || '识别失败'
      return
    }
    solveResult.value = j
    log(`③ OCR 4 选项: ${j.options.join(' / ')}${j.used_fallback ? '（手动兜底）' : ''}`)

    // 答案红框：后端把 4 个文字框还原成 2×2 整格，前端只外扩 5px 与科举一致
    if (j.answer_box) {
      const b = j.answer_box
      const pad = 5
      answerBox.value = {
        x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad),
        w: b.w + pad * 2, h: b.h + pad * 2,
      }
    }

    // ===== 调试图层：把后端实际用到的区域全部摊开 =====
    searchBox.value = j.search_box || null
    iconCands.value = Array.isArray(j.icon_boxes) ? j.icon_boxes : []
    ocrWindow.value = j.ocr_debug?.window || null
    ocrBlocks.value = Array.isArray(j.ocr_debug?.blocks) ? j.ocr_debug.blocks : []
    answerCells.value = Array.isArray(j.answer_cells) ? j.answer_cells : []
    if (j.search_box) {
      const sb = j.search_box
      log(`④ 模板搜索区 (${sb.x},${sb.y}) ${sb.w}×${sb.h}`)
    }
    const topCand = iconCands.value[0]
    if (topCand?.box) {
      log(`⑤ 最佳候选「${topCand.name}」落点 (${topCand.box.x},${topCand.box.y}) ${topCand.box.w}px NCC=${topCand.ncc}${topCand.pass ? ' ✓过阈值' : ' ✗未过阈值(0.60)'}`)
      log(`   全部候选: ${iconCands.value.map((x: any) => `${x.name}=${x.ncc}`).join(', ')}`)
    }
    if (ocrWindow.value) {
      const od = ocrBlocks.value
      log(`⑥ OCR 窗口 (${ocrWindow.value.x},${ocrWindow.value.y}) ${ocrWindow.value.w}×${ocrWindow.value.h}｜文字块 ${od.length} 个，保留 ${od.filter((b: any) => b.kept).length} 个，最终入选 4 个`)
    }

    // 模板匹配命中时，用后端返回的真实图标位置替换前端预估的绿色框（所见即命中位置）
    if (j.icon_box) {
      const ib = j.icon_box
      const bx1 = img.naturalWidth * ib.x1, by1 = img.naturalHeight * ib.y1
      const bx2 = img.naturalWidth * ib.x2, by2 = img.naturalHeight * ib.y2
      iconBox.value = { x1: bx1, y1: by1, x2: bx2, y2: by2 }
      const rc = document.createElement('canvas')
      rc.width = Math.max(1, Math.round(bx2 - bx1))
      rc.height = Math.max(1, Math.round(by2 - by1))
      rc.getContext('2d')!.drawImage(c, bx1, by1, rc.width, rc.height, 0, 0, rc.width, rc.height)
      iconCropUrl.value = rc.toDataURL('image/png')
    }

    log(`④ ${j.method === 'template' ? '模板滑窗匹配' : '175dt 受限匹配'} ${j.time_ms}ms → 正确选项 ${j.best_letter} 「${j.best.name}」 (NCC=${j.best.ncc ?? j.best.score})`)
    log(`   候选: ${j.scores.map((x: any) => `${x.name}=${x.ncc ?? x.score}`).join(', ')}`)
    log(`⑤ 总耗时 ${ms.toFixed(0)}ms（含网络）`)

    if (j.best_letter && j.best.score > 0.02) {
      error.value = ''
    } else {
      error.value = `置信度偏低（NCC=${j.best.score}），请确认游戏画面里是否已弹出答题面板`
    }

  } catch (e: any) {
    log('✗ 异常: ' + e.message)
    error.value = '识别失败: ' + e.message
  } finally {
    testRunning.value = false
  }
}

// 上传图 -> 百分比定位（stage 内 img 铺满，直接按原图比例换算）
function pct(v: number, total: number) { return total ? (v / total) * 100 : 0 }

onBeforeUnmount(() => {
  cap.stop()
  stopDetect()
  stopMonitor()
  if (uploadedUrl.value) URL.revokeObjectURL(uploadedUrl.value)
})

// 进页面即预加载检测模型（后台静默，不污染 status）。
// 监控模式不依赖 YOLO（后端用颜色分割），模型仅用于叠加显示检测框。
onMounted(() => {
  // 不再自动加载 YOLO，改按需静默加载
})
</script>

<template>
  <div class="dati-page">
    <header class="dati-head">
      <h1>答题助手 · 看图说话</h1>
      <p class="sub">框选技能图标 → 自动识别技能名 → 一键指出正确选项</p>
    </header>

    <div class="dati-body">
      <section class="left">
        <div class="toolbar">
          <button v-if="!sharing" class="btn primary" @click="startShare">① 开始屏幕共享</button>
          <button v-else class="btn warn" @click="stopShare">停止共享</button>
          <button class="btn" :class="{ active: monitoring }" :disabled="!sharing"
                  @click="toggleMonitor">
            {{ monitoring ? '■ 停止自动答题' : '② 开始自动答题' }}
          </button>
          <span class="divider"></span>
          <button class="btn ghost" @click="triggerUpload">上传图片测试</button>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onFilePicked" />
        </div>

        <!-- 图层开关：逐个区域单独查看 -->
        <div v-if="uploadedUrl" class="layer-bar">
          <span class="layer-title">图层</span>
          <button v-for="l in LAYER_LABELS" :key="l.key" class="layer-chip"
                  :class="{ on: (layers as any)[l.key] }" :style="{ '--c': l.color }"
                  @click="(layers as any)[l.key] = !(layers as any)[l.key]"
                  @dblclick="soloLayer(l.key)">
            <i class="dot"></i>{{ l.label }}
          </button>
          <span class="layer-sep"></span>
          <button class="layer-btn" @click="allLayers(true)">全开</button>
          <button class="layer-btn" @click="allLayers(false)">全关</button>
          <span class="layer-tip">双击 chip 可「只看这一层」</span>
        </div>
        <p class="status">
          {{ status }}
          <span v-if="bankLoading" class="bank-tag">本地题库加载中…</span>
          <span v-else-if="bankReady" class="bank-tag ok">本地题库 {{ bankSize() }} 条 · 纯前端匹配</span>
        </p>

        <div class="preview-stage" ref="stageEl" @mousedown="onDown" @mousemove="onMove" @mouseup="onUp">
          <video v-show="sharing" ref="videoEl" autoplay muted playsinline class="preview-video"></video>
          <img v-if="!sharing && previewUrl" :src="previewUrl" class="preview-video" />
          <!-- 本地上传测试图 -->
          <img v-if="!sharing && uploadedUrl" :src="uploadedUrl" class="preview-video" />
          <div v-if="!sharing && !previewUrl && !uploadedUrl" class="placeholder">
            点击「开始屏幕共享」并选择梦幻西游游戏窗口，共享成功后自动开始答题（每 1.5s 自动给出 A/B/C/D 答案）。
          </div>

          <div v-if="monitoring && sharing" class="monitor-badge">
            <span class="live-dot"></span>
            监控中 · 每 1.5s 自动识别一次
          </div>

          <!-- 上传测试：各区域独立图层，可用下方 chip 逐个开关 -->
          <template v-if="uploadedUrl && imgNat.w">
            <!-- 基准面板框（后端实际拿来换算的 YOLO 框） -->
            <div v-if="layers.panel && panelBox" class="up-box panel"
                 :style="{ left: pct(panelBox.x1, imgNat.w) + '%', top: pct(panelBox.y1, imgNat.h) + '%',
                           width: pct(panelBox.x2 - panelBox.x1, imgNat.w) + '%', height: pct(panelBox.y2 - panelBox.y1, imgNat.h) + '%' }">
              <span class="up-label">基准面板</span>
            </div>
            <!-- YOLO 原始检测框 -->
            <div v-if="layers.yolo" v-for="(d, i) in imgDetections" :key="'yolo' + i" class="up-box yolo"
                 :style="{ left: pct(d.x1, imgNat.w) + '%', top: pct(d.y1, imgNat.h) + '%',
                           width: pct(d.x2 - d.x1, imgNat.w) + '%', height: pct(d.y2 - d.y1, imgNat.h) + '%' }">
              <span class="up-label yolo-label">{{ d.className || ('c' + d.classId) }} {{ (d.conf * 100).toFixed(0) }}%</span>
            </div>
            <!-- 模板滑窗搜索区（橙） -->
            <div v-if="layers.search && searchBox" class="up-box search" :style="pctBox(searchBox)">
              <span class="up-label search-label">模板搜索区 {{ searchBox.w }}×{{ searchBox.h }}</span>
            </div>
            <!-- OCR 候选窗口（蓝） -->
            <div v-if="layers.ocrwin && ocrWindow" class="up-box ocrwin" :style="pctBox(ocrWindow)">
              <span class="up-label ocrwin-label">OCR 候选窗口</span>
            </div>
            <!-- OCR 全部文字块（青=保留 / 灰=过滤） -->
            <template v-if="layers.blocks">
              <div v-for="(b, i) in ocrBlocks" :key="'blk' + i" class="ocr-blk"
                   :class="{ kept: b.kept, chosen: b.chosen }" :style="pctBox(b)">
                <span class="blk-tag">{{ b.text }}<em v-if="!b.kept">·{{ b.reason }}</em></span>
              </div>
            </template>
            <!-- 4 个候选命中框（绿虚线，最佳为亮绿实线） -->
            <template v-if="layers.cands">
              <div v-for="(cd, i) in iconCands" :key="'cand' + i">
                <div v-if="cd.box" class="up-box cand" :class="{ pass: cd.pass, top: i === 0 }"
                     :style="pctBox(cd.box)">
                  <span class="up-label cand-label">{{ cd.name }} {{ cd.ncc }}</span>
                </div>
              </div>
            </template>
            <!-- 最佳候选绿框（实际送去做匹配的图） -->
            <div v-if="layers.icon && iconBox" class="up-box icon"
                 :style="{ left: pct(iconBox.x1, imgNat.w) + '%', top: pct(iconBox.y1, imgNat.h) + '%',
                           width: pct(iconBox.x2 - iconBox.x1, imgNat.w) + '%', height: pct(iconBox.y2 - iconBox.y1, imgNat.h) + '%' }">
              <span class="up-label icon-label">最佳候选（送去做匹配的图）</span>
            </div>
            <!-- 4 个答案格（OCR 文字位置 + options_zone 自适应切分，贴合真实 4 个色块；命中项高亮） -->
            <template v-if="layers.cells && answerCells.length">
              <div v-for="(c, i) in answerCells" :key="'cell' + i" class="up-box cell"
                   :class="{ hit: solveResult?.best_letter === String.fromCharCode(65 + i) }" :style="pctBox(c)">
                <span class="up-label cell-label">{{ String.fromCharCode(65 + i) }}</span>
              </div>
            </template>
            <!-- 正确答案红框（科举式：标在选项文字区域上） -->
            <div v-if="layers.answer && answerBox" class="up-box answer"
                 :style="{ left: pct(answerBox.x, imgNat.w) + '%', top: pct(answerBox.y, imgNat.h) + '%',
                           width: pct(answerBox.w, imgNat.w) + '%', height: pct(answerBox.h, imgNat.h) + '%' }">
              <span class="up-label ans-label">✓ 正确答案 {{ solveResult?.best_letter }}</span>
            </div>
          </template>

          <!-- 屏幕监控：YOLO 检测框（黄色虚线，只读，用于确认是否框到答题面板） -->
          <div v-if="monitoring" v-for="(d, i) in monitorDetections" :key="'myolo' + i"
               class="det-box monitor-det"
               :style="{ left: toDisplay(d).x + 'px', top: toDisplay(d).y + 'px', width: toDisplay(d).w + 'px', height: toDisplay(d).h + 'px' }">
            <span class="det-label">{{ d.className || ('c' + d.classId) }} {{ (d.conf * 100).toFixed(0) }}%</span>
          </div>

          <!-- 屏幕监控：正确答案红框（视频上实时标出） -->
          <div v-if="monitoring && sharing && monitorAnswer" class="vid-answer-box"
               :style="{ left: toDisplay(monitorAnswer).x + 'px', top: toDisplay(monitorAnswer).y + 'px',
                         width: toDisplay(monitorAnswer).w + 'px', height: toDisplay(monitorAnswer).h + 'px' }">
            <span class="ans-tag">✓ {{ solveResult?.best_letter }} · {{ solveResult?.best?.name }}</span>
          </div>

          <p v-if="autoWarn && autoMode" class="warn-msg">自动检测未命中答题框（该模型对当前游戏画面无效）。请关闭「YOLO 自动框图」，手动拖框【单个技能图标】再识别。</p>

          <!-- 自动检测框（仅调试模式开启 YOLO 自动框图时显示） -->
          <div v-if="autoMode" v-for="(d, i) in detections" :key="i" class="det-box"
               :class="{ picked: selBox === d }"
               :style="{ left: toDisplay(d).x + 'px', top: toDisplay(d).y + 'px', width: toDisplay(d).w + 'px', height: toDisplay(d).h + 'px' }"
               @click.stop="pickBox(d)">
            <span class="det-label">{{ d.className || ('c' + d.classId) }} {{ (d.conf * 100).toFixed(0) }}%</span>
          </div>

          <!-- 手动拖框（仅调试模式未开自动框图时） -->
          <div v-if="sel && !autoMode" class="sel-box"
               :style="{ left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' }"></div>
        </div>

        <!-- 调试工具折叠区：手动框图 / 答题细节 / 4 选项兜底 -->
        <details class="debug-fold">
          <summary>调试工具（手动框图 · 4 选项兜底 · 纠错上报）</summary>
          <div class="debug-toolbar">
            <button class="btn" :class="{ active: autoMode }" :disabled="!sharing || modelLoading"
                    @click="toggleAuto">
              {{ modelLoading ? '模型加载中…' : (autoMode ? '关闭 YOLO 自动框图' : 'YOLO 自动框图') }}
            </button>
            <button class="btn" :disabled="!sharing || !sel || autoMode" @click="recognize">识别技能（手动）</button>
            <button class="btn ghost" @click="reportError">纠错上报</button>
          </div>
          <p class="hint" style="margin-top:8px">
            调试说明：开「YOLO 自动框图」会用模型实时检测答题面板；如模型对当前界面无效，请手动拖框【单个技能图标】再点「识别技能（手动）」。
            OCR 漏字时可填写下方 4 选项作为兜底。
          </p>
          <div class="options-box" style="margin-top:8px">
            <h3 style="font-size:13px">选项匹配 <span class="hint-mini">（OCR 失败时手动填 4 选项兜底）</span></h3>
            <textarea v-model="optionsText" placeholder="粘贴 4 个选项，每行一个或用逗号分隔，例如：&#10;开天辟地&#10;延年益寿&#10;金刚护身&#10;乾坤借速"></textarea>
          </div>
        </details>

        <p class="hint monitor-hint">
          自动答题模式：每 1.5s 把当前共享画面发给后端（OCR 读 4 个选项 → 模板滑窗匹配），命中后立刻在视频上标出 A/B/C/D；置信度不足时显示「未识别」等待下一次截图，宁可不答也不乱答。
        </p>
      </section>

      <section class="right">
        <div v-if="loading" class="loading">识别中...</div>
        <div v-if="error" class="err">{{ error }}</div>

        <div v-if="result" class="result-card">
          <h3>
            识别结果（Top 5）
            <span v-if="matchVia" class="via">{{ matchVia }}匹配 · {{ localMs }}ms</span>
          </h3>
          <ol class="cands">
            <li v-for="(c, i) in result.candidates" :key="i" :class="{ top: i === 0 }">
              <img :src="c.icon" class="thumb" />
              <div class="c-meta">
                <span class="c-name">{{ c.name }}</span>
                <span class="c-school">{{ c.school }}</span>
              </div>
              <span class="c-score">匹配度 {{ c.mtScore }}%</span>
            </li>
          </ol>
        </div>

        <div v-if="solveResult" class="result-card answer-card">
          <h3>
            看图说话 · 自动答案
            <span class="via">175dt 后端匹配 · {{ solveResult.time_ms }}ms</span>
          </h3>
          <div v-if="solveResult.best_letter" class="answer-row">
            <span class="ans-letter">{{ solveResult.best_letter }}</span>
            <span class="ans-meta">
              <span class="ans-name">{{ solveResult.best.name }}</span>
              <span class="ans-sub">匹配度 NCC {{ solveResult.best.score }}</span>
            </span>
          </div>
          <div v-else class="answer-row warn">
            <span class="ans-meta">未能识别出正确选项</span>
          </div>
          <ol class="opt-list">
            <li v-for="(o, i) in solveResult.options" :key="i"
                :class="{ best: solveResult.best_letter && String.fromCharCode(65 + i) === solveResult.best_letter }">
              <span class="opt-letter">{{ String.fromCharCode(65 + i) }}</span>
              <span class="opt-name">{{ o }}</span>
              <span v-if="solveResult.scores[i]" class="opt-score">NCC {{ solveResult.scores[i].score }}</span>
            </li>
          </ol>
          <p v-if="solveResult.used_fallback" class="ocr-note">⚠️ OCR 漏字，使用了你手动填写的 4 选项</p>
        </div>

        <div v-if="monitorLog.length" class="result-card monitor-log-card">
          <h3>监控日志</h3>
          <ol class="tlog">
            <li v-for="(l, i) in monitorLog.slice().reverse()" :key="i">{{ l }}</li>
          </ol>
        </div>

        <div v-if="iconCropUrl" class="result-card">
          <h3>测试链路</h3>
          <div class="crop-row">
            <img :src="iconCropUrl" class="crop-img" />
            <div class="crop-meta">
              <div>最佳候选框裁出的图（后端实际拿去算分的图）</div>
              <div class="crop-sub">若这里不是完整技能图标，说明搜索区/尺度需要调</div>
              <ol v-if="iconCands.length" class="cand-list">
                <li v-for="(cd, i) in iconCands" :key="i" :class="{ top: i === 0, pass: cd.pass }">
                  <span class="cl-name">{{ cd.name }}</span>
                  <span class="cl-ncc">{{ cd.ncc }}</span>
                  <span v-if="cd.box" class="cl-box">({{ cd.box.x }},{{ cd.box.y }}) {{ cd.box.w }}px</span>
                </li>
              </ol>
            </div>
          </div>
          <ol v-if="testLog.length" class="tlog">
            <li v-for="(l, i) in testLog" :key="i">{{ l }}</li>
          </ol>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dati-page { padding: 16px 20px; color: var(--color-text, #e8e8e8); }
.dati-head h1 { margin: 0 0 4px; font-size: 20px; }
.sub { margin: 0 0 12px; color: #9aa; font-size: 13px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 7px 14px; border-radius: 8px; border: 1px solid #345; background: #1b2735; color: #dce; cursor: pointer; font-size: 13px; }
.btn.primary { background: #1e6f4f; border-color: #2a8; }
.btn.warn { background: #7a2e2e; border-color: #a44; }
.btn.ghost { background: transparent; }
.btn.active { background: #1e5f8f; border-color: #39f; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.status { font-size: 12px; color: #8ab; min-height: 16px; margin: 6px 0; }
.dati-body { display: flex; gap: 18px; flex-wrap: wrap; }
.left { flex: 1 1 460px; }
.right { flex: 1 1 320px; }
.preview-stage { position: relative; width: 100%; aspect-ratio: 4/3; background: #0c1118; border: 1px solid #2a3a4a; border-radius: 10px; overflow: hidden; cursor: crosshair; }
.preview-video { width: 100%; height: 100%; object-fit: fill; display: block; }
.placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #567; font-size: 13px; }
.sel-box { position: absolute; border: 2px solid #2ee6a0; background: rgba(46,230,160,.12); pointer-events: none; }
.det-box { position: absolute; border: 2px dashed #e6b800; background: rgba(230,184,0,.10); cursor: pointer; }
.det-box.picked { border-style: solid; border-color: #2ee6a0; background: rgba(46,230,160,.14); }
.det-box.monitor-det { cursor: default; pointer-events: none; }
.det-label { position: absolute; top: -16px; left: 0; font-size: 10px; background: rgba(0,0,0,.6); color: #ffd84d; padding: 0 3px; border-radius: 3px; white-space: nowrap; }
.hint { font-size: 12px; color: #789; margin-top: 6px; }
.warn-msg { font-size: 12px; color: #ffcf66; background: rgba(255,180,0,.12); border: 1px solid #b8860b; border-radius: 8px; padding: 6px 8px; margin-top: 6px; }
.result-card { background: #121a24; border: 1px solid #233; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
.result-card h3 { margin: 0 0 8px; font-size: 14px; }
.cands { list-style: none; margin: 0; padding: 0; }
.cands li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
.cands li.top { background: #16331f; }
.thumb { width: 36px; height: 36px; border-radius: 6px; background: #223; object-fit: contain; }
.c-meta { display: flex; flex-direction: column; flex: 1; }
.c-name { font-weight: 600; }
.c-school { font-size: 11px; color: #89a; }
.c-score { font-size: 12px; color: #2ee6a0; }
.options-box { background: #121a24; border: 1px solid #233; border-radius: 10px; padding: 12px; }
.options-box h3 { margin: 0 0 8px; font-size: 14px; }
textarea { width: 100%; height: 90px; background: #0c1118; color: #dce; border: 1px solid #2a3a4a; border-radius: 8px; padding: 8px; font-size: 13px; resize: vertical; }
.opt-result { margin-top: 8px; font-size: 13px; }
.ok { color: #2ee6a0; font-size: 16px; }
.loading { color: #8ab; padding: 8px; }
.err { color: #e88; padding: 8px; font-size: 13px; }
.divider { width: 1px; background: #2a3a4a; margin: 0 4px; align-self: stretch; }
.btn.test { background: #3a2a5f; border-color: #7a5fbf; }
/* 上传测试叠加框：百分比定位 */
.up-box { position: absolute; pointer-events: none; }
.up-box.panel { border: 2px dashed #e6b800; background: rgba(230,184,0,.08); }
.up-box.icon { border: 2px solid #3ddc84; background: rgba(61,220,132,.12); }
.up-box.icon .icon-label { color: #3ddc84; }
.up-box.icon { border: 2px solid #2ee6a0; background: rgba(46,230,160,.16); }
.up-label { position: absolute; top: -15px; left: 0; font-size: 10px; background: rgba(0,0,0,.65); color: #ffd84d; padding: 0 3px; border-radius: 3px; white-space: nowrap; }
.up-label.icon-label { color: #2ee6a0; }
/* YOLO 检测框（上传图，与视频模式 det-box 同款黄虚线） */
.up-box.yolo { border: 2px dashed #e6b800; background: rgba(230,184,0,.10); }
.up-box.yolo .yolo-label { color: #ffd84d; }
/* 正确答案红框（科举式） */
.up-box.answer { border: 3px solid #ff5252; background: rgba(255,82,82,.14); box-shadow: 0 0 0 2px rgba(255,82,82,.25); z-index: 3; }
.up-box.answer .ans-label { color: #ff5252; font-weight: 700; font-size: 11px; top: -18px; }
/* 视频监控答案红框 */
.vid-answer-box { position: absolute; border: 3px solid #ff5252; background: rgba(255,82,82,.14); box-shadow: 0 0 0 2px rgba(255,82,82,.25); pointer-events: none; z-index: 3; }
.vid-answer-box .ans-tag { position: absolute; top: -20px; left: -3px; font-size: 11px; font-weight: 700; background: #ff5252; color: #fff; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.crop-row { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
.crop-img { width: 72px; height: 72px; background: #223; border: 1px solid #345; border-radius: 8px; object-fit: contain; }
.crop-meta { flex: 1; font-size: 12px; line-height: 1.5; }
.crop-sub { color: #789; margin-top: 2px; }
.tlog { list-style: none; margin: 8px 0 0; padding: 8px; background: #0c1118; border: 1px solid #233; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.7; color: #9cb; white-space: pre-wrap; word-break: break-all; }

/* 看图说话 · 自动答案 */
.answer-card { background: linear-gradient(135deg, #14242a 0%, #121a24 60%); border: 1px solid #2a5f5f; }
.answer-row { display: flex; align-items: center; gap: 14px; padding: 10px 12px; border-radius: 10px; background: rgba(46,230,160,.10); margin-bottom: 10px; }
.answer-row.warn { background: rgba(255,180,0,.10); }
.ans-letter { font-size: 36px; font-weight: 700; color: #2ee6a0; background: rgba(46,230,160,.15); border-radius: 12px; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; }
.ans-meta { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.ans-name { font-size: 18px; font-weight: 600; }
.ans-sub { font-size: 12px; color: #8ab; }
.opt-list { list-style: none; margin: 0; padding: 0; }
.opt-list li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; }
.opt-list li.best { background: #16331f; border: 1px solid #2ee6a0; }
.opt-list li.best .opt-letter { color: #2ee6a0; }
.opt-list li.best .opt-name { font-weight: 700; }
.opt-letter { font-size: 16px; font-weight: 600; color: #b6e; width: 22px; }
.opt-name { flex: 1; font-size: 13px; }
.opt-score { font-size: 12px; color: #89a; font-family: ui-monospace, monospace; }
.ocr-note { margin: 8px 0 0; padding: 6px 10px; border-radius: 8px; background: rgba(255,180,0,.10); border: 1px solid #b8860b; color: #ffcf66; font-size: 12px; }
.hint-mini { font-weight: normal; font-size: 11px; color: #789; margin-left: 6px; }

/* 页签 */
.tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.tabs button { padding: 6px 14px; border-radius: 8px; border: 1px solid #2a3a4a; background: #0c1118; color: #9ab; cursor: pointer; font-size: 13px; }
.tabs button.active { background: #1e5f8f; border-color: #39f; color: #fff; }

/* 屏幕监控 */
.monitor-badge { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 6px; background: rgba(46,230,160,.16); border: 1px solid #2ee6a0; color: #2ee6a0; padding: 4px 10px; border-radius: 20px; font-size: 12px; z-index: 2; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: #2ee6a0; animation: livePulse 1.2s infinite; }
@keyframes livePulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.monitor-hint { color: #9ab; }
.monitor-log-card { border-color: #3a5a4a; }

/* 调试工具折叠区 */
.debug-fold { margin-top: 12px; padding: 10px 12px; border: 1px dashed #345; border-radius: 8px; background: rgba(255,255,255,.02); }
.debug-fold > summary { cursor: pointer; font-size: 13px; color: #cde; user-select: none; }
.debug-fold > summary:hover { color: #fff; }
.debug-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.debug-toolbar .btn { font-size: 12px; padding: 6px 10px; }
.debug-fold textarea { min-height: 70px; }

/* 调试图层：模板搜索区 / OCR 窗口 / 文字块 / 候选命中框 */
.up-box.search { border: 2px dashed #ff9f43; background: rgba(255,159,67,.06); }
.up-label.search-label { background: #ff9f43; color: #2b1a05; }
.up-box.ocrwin { border: 2px dashed #4dabf7; background: rgba(77,171,247,.06); }
.up-label.ocrwin-label { background: #4dabf7; color: #04243d; }
.ocr-blk { position: absolute; border: 1px solid rgba(160,160,160,.45); background: rgba(150,150,150,.10); pointer-events: none; }
.ocr-blk.kept { border-color: rgba(34,211,238,.75); background: rgba(34,211,238,.12); }
.ocr-blk.chosen { border-color: #22d3ee; background: rgba(34,211,238,.22); }
.blk-tag { position: absolute; top: -13px; left: 0; font-size: 10px; background: rgba(0,0,0,.65); color: #9aa; padding: 0 3px; border-radius: 3px; white-space: nowrap; }
.ocr-blk.chosen .blk-tag { color: #22d3ee; }
.up-box.cand { border: 1px dashed rgba(46,230,160,.55); background: rgba(46,230,160,.06); }
.up-box.cand.top { border: 2px solid #2ee6a0; background: rgba(46,230,160,.14); }
.up-label.cand-label { background: rgba(46,230,160,.85); color: #04231a; }
/* 4 个答案格（YOLO 选项区几何等分，识别前模板；命中项高亮） */
.up-box.cell { border: 2px dashed #c77dff; background: rgba(199,125,255,.05); }
.up-box.cell.hit { border: 2px solid #c77dff; background: rgba(199,125,255,.16); }
.up-label.cell-label { background: #c77dff; color: #2b0a3d; font-weight: 700; }
.cand-list { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12px; }
.cand-list li { display: flex; gap: 10px; align-items: center; padding: 3px 6px; border-radius: 6px; color: #9ab; }
.cand-list li.top { background: rgba(46,230,160,.12); color: #cfe; }
.cand-list .cl-name { min-width: 68px; }
.cand-list .cl-ncc { color: #ffd84d; font-variant-numeric: tabular-nums; }
.cand-list li.pass .cl-ncc { color: #2ee6a0; }
.cand-list .cl-box { color: #678; }
</style>
