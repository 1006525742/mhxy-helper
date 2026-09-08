/**
 * 通用监控核心逻辑
 * 复刻 mhxyai.com/v2/jiankong1：屏幕共享画面区域像素变化检测 + 预警
 *
 * 设计：完全复用 @/services/screenCapture 的 getDisplayMedia 与 captureRegion，
 * 本模块只负责「抓帧解码 → 像素差异比对 → 阈值判断 → 播放预警音」，
 * 不依赖任何音频资源文件（蜂鸣用 Web Audio 合成，语音用 Web Speech API）。
 */

import { ScreenCapture } from '@/services/screenCapture'

/** 监控区域（视频实际分辨率坐标，单位：px） */
export interface MonitorRegion {
  x: number
  y: number
  width: number
  height: number
}

/** 监控配置 */
export interface MonitorConfig {
  /** 变化阈值（百分比 0~100），变化率超过即判定为"变了" */
  threshold: number
  /** 触发时连续播放次数 */
  playTimes: number
  /** 监控频率（秒） */
  intervalSec: number
  /** 预警音类型：beep=蜂鸣 / tts=语音 / both=蜂鸣+语音 */
  soundType: 'beep' | 'tts' | 'both'
  /** 语音预警播报的自定义内容（soundType 含 tts 时生效） */
  ttsText?: string
  /** 开启离线检测：标签页隐藏时尽量继续检测（受浏览器后台节流限制） */
  offlineDetect?: boolean
}

/** 监控回调 */
export interface MonitorCallbacks {
  /** 每次比对后回调当前变化率（百分比） */
  onRate?: (ratePct: number) => void
  /** 检测到变化（达到阈值）时回调 */
  onAlert: (ratePct: number) => void
  /** 长时间静止（连续 20 次无变化）反向提醒时回调 */
  onIdleAlert?: () => void
  /** 出错时回调 */
  onError?: (msg: string) => void
  /** 每帧抓取时回调（用于更新状态） */
  onTick?: () => void
  /** 引擎停止时回调 */
  onStop?: () => void
}

/**
 * 像素差异检测：返回变化像素占比（0~1）
 * 算法对齐原站：RGB→灰度（取平均），单像素灰度差 > 15 计为变化像素。
 */
export function diffRate(cur: ImageData, prev: ImageData): number {
  if (cur.data.length !== prev.data.length) return 1
  let changed = 0
  const total = cur.data.length / 4 // RGBA，每像素 4 字节
  for (let i = 0; i < cur.data.length; i += 4) {
    const g1 = (cur.data[i] + cur.data[i + 1] + cur.data[i + 2]) / 3
    const g2 = (prev.data[i] + prev.data[i + 1] + prev.data[i + 2]) / 3
    if (Math.abs(g1 - g2) > 15) changed++
  }
  return changed / total
}

/**
 * 将 captureRegion 返回的 base64（JPEG）解码为 ImageData。
 * 用 fetch(dataURL)→blob→createImageBitmap 走 GPU 解码，比 Image+canvas 更快。
 */
export async function decodeRegion(b64: string): Promise<ImageData | null> {
  try {
    const res = await fetch(b64)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bitmap.width
    c.height = bitmap.height
    const ctx = c.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height)
    bitmap.close()
    return data
  } catch {
    return null
  }
}

/* ============== 预警音 ============== */

let audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new Ctor()
    }
    return audioCtx
  } catch {
    return null
  }
}

/** 蜂鸣预警：Web Audio 合成方波，无需音频文件 */
export function playBeep(times = 1) {
  const ctx = getAudioCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const n = Math.max(1, Math.min(10, times)) // 限制 1~10 次（对齐原站）
  for (let i = 0; i < n; i++) {
    const start = ctx.currentTime + i * 0.25
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, start)
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.2)
  }
}

/** 语音预警：Web Speech API 朗读自定义内容（默认「画面变化提醒」） */
export function speakAlert(text = '画面变化提醒', times = 1, voiceName?: string) {
  if (!('speechSynthesis' in window)) return
  const n = Math.max(1, Math.min(10, times))
  let voice: SpeechSynthesisVoice | undefined
  if (voiceName) {
    voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceName || v.voiceURI === voiceName)
  }
  for (let i = 0; i < n; i++) {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1.1
    u.pitch = 1
    if (voice) u.voice = voice
    const delay = i * 900
    if (delay === 0) window.speechSynthesis.speak(u)
    else window.setTimeout(() => window.speechSynthesis.speak(u), delay)
  }
}

/**
 * 预警音可选音色。
 * - beep / tts / both：兼容 jiankong1 的旧三态（纯蜂鸣 / 纯语音 / 蜂鸣+语音）
 * - tone1 ~ tone5：复刻原站 jiankong4 的 5 个提示音文件（/mp3/1~5.mp3）
 *
 * 当前原站活代码只引用 /mp3/4.mp3（月光挂机提醒音，即 tone4/铃声①）。
 * 5 个文件的「角色名↔文件」配对原站未标注，已按用户实测试听确认：
 *   tone1=少女音 / tone2=秘书音 / tone3=老表音(广西口音) / tone4=铃声① / tone5=铃声②。
 */
export type AlertSoundType =
  | 'beep'
  | 'tts'
  | 'both'
  | 'tone1'
  | 'tone2'
  | 'tone3'
  | 'tone4'
  | 'tone5'

/** 5 种音色下拉项（label 用于 UI，file 为本地托管的 mp3）
 * 标签↔文件配对已按用户实测试听确认：
 *   文件1=少女音 / 文件2=秘书音 / 文件3=老表音(广西口音) / 文件4=铃声① / 文件5=铃声②
 * 其中 /mp3/4.mp3 即原站活代码实际引用的月光挂机提醒音（默认音）。
 */
export const SOUND_OPTIONS: { value: AlertSoundType; label: string; file: string }[] = [
  { value: 'tone1', label: '👧 少女音（文件1）', file: '/mp3/1.mp3' },
  { value: 'tone2', label: '💼 秘书音（文件2）', file: '/mp3/2.mp3' },
  { value: 'tone3', label: '🌶 老表音（文件3·广西口音）', file: '/mp3/3.mp3' },
  { value: 'tone4', label: '🔔 铃声①（文件4·原站默认）', file: '/mp3/4.mp3' },
  { value: 'tone5', label: '🔔 铃声②（文件5）', file: '/mp3/5.mp3' }
]

function soundFileOf(type: AlertSoundType): string {
  return SOUND_OPTIONS.find((o) => o.value === type)?.file ?? SOUND_OPTIONS[0].file
}

/** 仅播放某个音色的提示音（试听用），不叠加 TTS */
export function previewTone(type: AlertSoundType) {
  initAudio()
  playMp3(soundFileOf(type), 1)
}

/** 播放 mp3 提示音，顺序连播 times 次（用 onended 串联，避免重叠） */
export function playMp3(file: string, times = 1) {
  const n = Math.max(1, Math.min(10, times))
  let i = 0
  const playNext = () => {
    if (i >= n) return
    i++
    const a = new Audio(file)
    a.preload = 'auto'
    a.volume = 1
    a.onended = playNext
    void a.play().catch(() => {
      // 自动播放策略拦截时跳过本次，继续后续（不影响计数）
      playNext()
    })
  }
  playNext()
}

/** 统一报警入口 */
export function playAlarm(soundType: AlertSoundType, times: number, ttsText?: string, ttsVoice?: string) {
  const text = ttsText && ttsText.trim() ? ttsText.trim() : '画面变化提醒'
  if (soundType === 'beep') {
    playBeep(times)
  } else if (soundType === 'tts') {
    speakAlert(text, times, ttsVoice)
  } else if (soundType === 'both') {
    playBeep(times)
    speakAlert(text, times, ttsVoice)
  } else {
    // 五种音色：先播对应 mp3，再（可选）用浏览器 TTS 播报自定义文案（可用自选嗓音）
    playMp3(soundFileOf(soundType), times)
    if (ttsText && ttsText.trim()) speakAlert(text, times, ttsVoice)
  }
}

/**
 * 在用户手势中预热音频上下文。
 * 报警音（Web Audio）的 AudioContext 若首次创建于 setInterval 回调（脱离手势），
 * 会被浏览器自动播放策略挂起、resume() 在非手势上下文被拒绝 → 报警静音。
 * 在开始监控 / 试听 等点击手势里先调用本函数即可解锁。
 */
export function initAudio() {
  const ctx = getAudioCtx()
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

/**
 * 监控引擎：按频率抓帧比对，判断「变化 / 长时间静止」。
 *
 * 两个隐藏逻辑（对齐原站源码）：
 * 1. 触发报警后刷新基线帧（this.prev = cur），避免连续刷屏
 * 2. 连续 20 次（≈20×频率秒）无变化也反向报警——防止挂机断线 / 画面卡死无人知
 */
export class MonitorEngine {
  private sc: ScreenCapture
  private config: MonitorConfig
  private cb: MonitorCallbacks
  private timer: number | null = null
  private prev: ImageData | null = null
  private region: MonitorRegion | null = null
  private idleCount = 0
  private running = false
  private busy = false // 防止重叠 tick（decode 未完就进入下一帧）

  constructor(sc: ScreenCapture, config: MonitorConfig, cb: MonitorCallbacks) {
    this.sc = sc
    this.config = config
    this.cb = cb
  }

  /** 启动监控。region 为视频实际分辨率坐标（px） */
  start(region: MonitorRegion) {
    if (this.running) return
    if (!this.sc.isActive()) {
      this.cb.onError?.('屏幕共享未开启')
      return
    }
    this.region = region
    this.prev = null
    this.idleCount = 0
    this.running = true
    void this.tickOnce() // 立即抓第一帧建立基线
    this.timer = window.setInterval(() => void this.tickOnce(), Math.max(0.5, this.config.intervalSec) * 1000)
  }

  private async tickOnce() {
    if (!this.running || this.busy) return
    this.busy = true
    try {
      if (!this.region || !this.sc.isActive()) {
        this.stop()
        return
      }
      const b64 = this.sc.captureRegion(this.region)
      if (!b64) {
        this.cb.onError?.('抓帧失败')
        return
      }
      const cur = await decodeRegion(b64)
      if (!cur) return
      this.cb.onTick?.()

      // 第一帧只建立基线
      if (!this.prev) {
        this.prev = cur
        this.idleCount = 0
        return
      }

      const rate = diffRate(cur, this.prev)
      const ratePct = rate * 100
      this.cb.onRate?.(ratePct)

      if (rate >= this.config.threshold / 100) {
        this.cb.onAlert(ratePct)
        this.prev = cur // 触发后刷新基线，避免连续刷屏
        this.idleCount = 0
        playAlarm(this.config.soundType, this.config.playTimes, this.config.ttsText)
      } else {
        this.idleCount++
        if (this.idleCount > 20) {
          this.cb.onIdleAlert?.()
          this.idleCount = 0
          playAlarm(this.config.soundType, this.config.playTimes, this.config.ttsText)
        }
      }
    } finally {
      this.busy = false
    }
  }

  /** 停止监控 */
  stop() {
    this.running = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.cb.onStop?.()
  }

  /**
   * 可见性恢复时立即补一帧，缓解后台标签被节流导致的漏检。
   * 由 JiankongView 在 visibilitychange -> visible 时调用。
   */
  poke() {
    if (this.running && !this.busy) void this.tickOnce()
  }

  isRunning() {
    return this.running
  }
}
