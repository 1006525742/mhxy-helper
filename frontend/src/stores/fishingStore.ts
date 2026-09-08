import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ScreenCapture } from '@/services/screenCapture'
import { recognize, loadModels } from '@/services/paddleOcr'
import { FishingMatcher, isRoundEnd, type MatchResult } from '@/services/fishingMatcher'
import rulesData from '@/data/fishingRules.json'

const matcher = new FishingMatcher()
matcher.load(rulesData as any)

const ROI_KEY = 'fishing_roi_v1'

function loadRoi(): { x: number; y: number; width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(ROI_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// 用 Web Audio 生成提示音，免去二进制资源
let audioCtx: AudioContext | null = null
function beep(freq: number, durMs = 120, gain = 0.04) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.frequency.value = freq
    osc.type = 'sine'
    g.gain.value = gain
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start()
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durMs / 1000)
    osc.stop(audioCtx.currentTime + durMs / 1000)
  } catch {
    /* 忽略音频错误 */
  }
}

export const useFishingStore = defineStore('fishing', () => {
  const places = matcher.getPlaces()
  const place = ref<string>(places[0] || '傲来国')
  const isSharing = ref(false)
  const isMonitoring = ref(false)
  const interval = ref(500)
  const ocrReady = ref(false)
  const ocrError = ref('')
  const ocrLoading = ref(false)
  const previewFrame = ref('')
  const observed = ref<string[]>([])
  const result = ref<MatchResult | null>(null)
  const history = ref<Array<{ fish: string; action: string[]; rare: boolean; at: number }>>([])
  const roi = ref<{ x: number; y: number; width: number; height: number } | null>(loadRoi())
  const audioEnabled = ref(true)
  const status = ref('待命')

  let capture: ScreenCapture | null = null
  let timer: number | null = null
  let busy = false
  let previewRaf: number | null = null

  const bestText = computed(() => {
    if (!result.value?.best) return '—'
    const a = result.value.best.action
    return `${result.value.best.fish}（力度:${a[0]} 角度:${a[1]} 速度:${a[2]}）`
  })

  async function initOcr() {
    ocrLoading.value = true
    ocrError.value = ''
    try {
      await loadModels()
      ocrReady.value = true
    } catch (e: any) {
      ocrError.value = '模型加载失败：' + (e?.message || e) + '（请先运行 node scripts/fetch_paddle_models.mjs）'
    } finally {
      ocrLoading.value = false
    }
  }

  async function startShare() {
    capture = new ScreenCapture()
    const ok = await capture.start()
    if (!ok) {
      status.value = '屏幕共享失败（需 HTTPS 或 localhost，且浏览器允许）'
      return
    }
    isSharing.value = true
    status.value = '已开启屏幕共享，请框选钓鱼聊天区域'
    startPreviewLoop()
    if (!ocrReady.value) await initOcr()
  }

  function stopShare() {
    stopMonitor()
    if (capture) capture.stop()
    capture = null
    isSharing.value = false
    stopPreviewLoop()
    previewFrame.value = ''
    status.value = '已停止'
  }

  function startPreviewLoop() {
    const loop = () => {
      if (!capture || !capture.isActive()) return
      const f = capture.getPreviewFrame()
      if (f) previewFrame.value = f
      previewRaf = requestAnimationFrame(loop)
    }
    loop()
  }
  function stopPreviewLoop() {
    if (previewRaf) cancelAnimationFrame(previewRaf)
    previewRaf = null
  }

  function setRoi(r: { x: number; y: number; width: number; height: number }) {
    roi.value = r
    localStorage.setItem(ROI_KEY, JSON.stringify(r))
  }

  async function startMonitor() {
    if (!capture || !ocrReady.value) {
      status.value = '请先开启屏幕共享并等待模型加载完成'
      return
    }
    if (!roi.value || roi.value.width < 20 || roi.value.height < 20) {
      status.value = '请先在预览画面上拖出钓鱼聊天区域'
      return
    }
    isMonitoring.value = true
    status.value = '监控中…'
    tick()
  }

  function stopMonitor() {
    isMonitoring.value = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function resetRound() {
    matcher.reset(place.value)
    observed.value = []
    result.value = null
  }

  async function tick() {
    if (!isMonitoring.value || !capture || !roi.value) return
    if (busy) {
      timer = window.setTimeout(tick, 100)
      return
    }
    busy = true
    try {
      capture.ensurePlaying()
      const dataUrl = capture.captureRegion(roi.value)
      if (dataUrl) {
        const img = new Image()
        img.src = dataUrl
        await new Promise<void>((resolve) => {
          if (img.complete) resolve()
          else img.onload = () => resolve()
        })
        const lines = await recognize(img)
        if (lines.length) {
          if (isRoundEnd(lines.join('\n'))) {
            finalizeRound()
          } else {
            const before = matcher.getObserved(place.value).length
            const res = matcher.feed(place.value, lines)
            observed.value = res.observed
            result.value = res
            if (matcher.getObserved(place.value).length > before && audioEnabled.value) {
              beep(880, 90, 0.03) // 咬钩提示
            }
            status.value = res.determined ? `已识别：${res.best?.fish}` : '识别中…'
          }
        }
      }
    } catch (e: any) {
      status.value = '识别异常：' + (e?.message || e)
    } finally {
      busy = false
      if (isMonitoring.value) timer = window.setTimeout(tick, Math.max(200, interval.value))
    }
  }

  function finalizeRound() {
    const r = matcher.analyze(place.value)
    if (r.best) {
      history.value.unshift({ fish: r.best.fish, action: r.best.action, rare: r.best.rare, at: Date.now() })
      if (audioEnabled.value) beep(r.best.rare ? 1320 : 1040, 220, 0.06)
      status.value = `回合结束：${r.best.fish}（${r.best.action.join(' / ')}）`
    } else {
      status.value = '回合结束：未能确定鱼种'
    }
    resetRound()
  }

  function setPlace(p: string) {
    place.value = p
    resetRound()
  }

  function setIntervalMs(ms: number) {
    interval.value = ms
  }

  function toggleAudio() {
    audioEnabled.value = !audioEnabled.value
  }

  return {
    places,
    place,
    isSharing,
    isMonitoring,
    interval,
    ocrReady,
    ocrError,
    ocrLoading,
    previewFrame,
    observed,
    result,
    history,
    roi,
    audioEnabled,
    status,
    bestText,
    initOcr,
    startShare,
    stopShare,
    startMonitor,
    stopMonitor,
    resetRound,
    setRoi,
    setPlace,
    setIntervalMs,
    toggleAudio
  }
})
