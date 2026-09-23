/**
 * 自动战斗框监控引擎（复刻 mhxyai.com/v2/jiankong4）
 *
 * 每帧对屏幕共享画面做 YOLO 检测（detectJk4），判断画面中是否还存在「自动战斗框」：
 *   - 默认整屏检测；若 start() 传入 region（红框「限定监控区域」开启），则只检测该区域，
 *     聚焦游戏窗口、减少其它界面干扰、推理更快。
 *   - 检测到自动战斗框（conf>autoBattleConf）→ 视为正常挂机，清零"消失计数"
 *   - 自动战斗框连续 missFrames 帧未出现 → 视为异常（战斗结束/掉线/卡死），触发预警音
 *   - 四小人框（conf>fourPeopleConf）属于负面信号：只要「检测到」即视为异常，
 *     连续 missFrames 帧出现 → 触发预警音（与自动战斗「消失才报」相反）
 *   - 距上次报警超过 alertCooldownMs 才真正报警，避免刷屏（对齐原站 30s 冷却）
 *
 * 可选「通用监控」：复用 jiankong1 的像素差异（红框选区 diffRate>阈值 即报警）。
 * 报警音效复用 jiankongLogic.playAlarm（5 种音色 mp3 + 可选自定义语音叠加）。
 * 消息推送由视图层在报警时调用（企业微信群机器人 / QQ邮箱 / 微信，配置已持久化）。
 */
import { ScreenCapture } from '@/services/screenCapture'
import { detectJk4, type Jk4Detection } from '@/services/jiankong4Yolo'
import { diffRate, decodeRegion, playAlarm, type AlertSoundType, type MonitorRegion } from '@/services/jiankongLogic'

/** 归一化到「整块共享屏幕 0~1」的检测框，供视图叠加 canvas 对齐绘制 */
export interface Jk4NormDet {
  className: string
  classId: number
  conf: number
  /** 全屏归一化坐标（0~1） */
  nx1: number
  ny1: number
  nx2: number
  ny2: number
}

export interface Jk4Config {
  /** 自动战斗框消失（一个都没有）时报警（核心开关，默认开） */
  enableAlert: boolean
  /** 四小人框出现即报警（负面信号，默认开） */
  enableFourPeopleAlert: boolean
  /** 自动战斗框数量少于目标时报警（正向监测：多于目标不报，默认开） */
  enableCountAlert: boolean
  /** 目标自动战斗框数量（实际少于此值才报警，默认 4） */
  targetAutoBattleCount: number
  /** 连续报警时播放次数 */
  playTimes: number
  /** 预警音类型（5 种音色 + 兼容旧三态） */
  soundType: AlertSoundType
  /** 开启通用监控（红框像素差异） */
  enableGeneric: boolean
  /** 限定监控区域：开启后仅检测红框内（聚焦游戏窗口、更快更准），默认整屏 */
  limitRegion: boolean
  /** 通用监控变化阈值（%） */
  genericThreshold: number
  /* ---------- 推送渠道：单选一个（三渠道凭据独立保存，切换不丢） ---------- */
  /** 总开关 */
  enablePush: boolean
  /** 当前选中的推送渠道 */
  pushChannel: 'wecom' | 'qqmail' | 'wechat'
  /** 企业微信群机器人 webhook 地址 */
  wecom: { webhook: string }
  /** QQ 邮箱：接收 QQ 号 + 代发接口地址（默认本机 8011） */
  qqmail: { qq: string; mailApi: string }
  /** 微信测试号：接收人备注名 + 代发接口地址（openid 映射与模板 ID 由后端固定维护） */
  wechat: { receiver: string; apiBase: string }
  /** 主检测循环间隔（ms） */
  detectIntervalMs: number
  /** 连续多少帧异常（消失 / 数量不符）才判定为真实异常并报警 */
  missFrames: number
  /** 两次报警最小间隔（ms） */
  alertCooldownMs: number
  /** 自动战斗框置信度阈值（0~1，越高越严格） */
  autoBattleConf: number
  /** 四小人置信度阈值（0~1） */
  fourPeopleConf: number
  /** 监控界面是否叠加显示 YOLO 检测框 */
  showBoxes: boolean
}

export interface Jk4Callbacks {
  /** 更新状态文案 */
  onStatus: (text: string, color: string) => void
  /** 自动战斗框消失报警 */
  onAlert: () => void
  /** 消息推送回调（enablePush 开启时触发，视图层按选中渠道推送单一渠道） */
  onNotify?: (reason: string) => void
  /** 每帧检测结果（归一化全屏框 + 自动战斗/四小人数量） */
  onDetect?: (normDets: Jk4NormDet[], autoBattleCount: number, fourPeopleCount: number) => void
  /** 通用监控触发 */
  onGenericAlert?: (ratePct: number) => void
  /** 出错 */
  onError?: (msg: string) => void
  /** 引擎停止 */
  onStop?: () => void
}

const GREEN = '#42b983'
const ORANGE = '#ff9800'

export class Jk4Engine {
  private sc: ScreenCapture
  private config: Jk4Config
  private cb: Jk4Callbacks
  private detectTimer: number | null = null
  private genericTimer: number | null = null
  private running = false
  private busy = false
  private missCount = 0
  /** 数量监控：连续异常帧计数 */
  private countMiss = 0
  /** 四小人框：连续出现帧计数（出现即负面，连续出现才报警） */
  private fpMiss = 0
  private lastAlertTs = 0
  private region: MonitorRegion | null = null
  private genericPrev: ImageData | null = null

  constructor(sc: ScreenCapture, config: Jk4Config, cb: Jk4Callbacks) {
    this.sc = sc
    this.config = config
    this.cb = cb
  }

  start(region: MonitorRegion | null) {
    if (this.running) return
    if (!this.sc.isActive()) {
      this.cb.onError?.('屏幕共享未开启')
      return
    }
    this.region = region
    this.missCount = 0
    this.countMiss = 0
    this.fpMiss = 0
    this.lastAlertTs = 0
    this.running = true
    void this.detectTick()
    this.detectTimer = window.setInterval(() => void this.detectTick(), Math.max(300, this.config.detectIntervalMs))
    this.syncGeneric()
  }

  /** 把检测框（抓帧像素空间）映射到整块共享屏幕归一化坐标 0~1（区域限定时用 region 偏移还原） */
  private toNormDet(d: Jk4Detection, imgW: number, imgH: number): Jk4NormDet {
    const size = this.sc.getVideoSize()
    const vW = size?.width ?? imgW
    const vH = size?.height ?? imgH
    let x1 = d.x1
    let y1 = d.y1
    let x2 = d.x2
    let y2 = d.y2
    if (this.region) {
      x1 += this.region.x
      x2 += this.region.x
      y1 += this.region.y
      y2 += this.region.y
    }
    return {
      className: d.className,
      classId: d.classId,
      conf: d.conf,
      nx1: x1 / vW,
      ny1: y1 / vH,
      nx2: x2 / vW,
      ny2: y2 / vH
    }
  }

  private async detectTick() {
    if (!this.running || this.busy) return
    this.busy = true
    try {
      if (!this.sc.isActive()) {
        this.stop()
        return
      }
      const b64 = this.region ? this.sc.captureRegion(this.region) : this.sc.captureFull()
      if (!b64) return
      const img = await decodeRegion(b64)
      if (!img) return
      const dets = await detectJk4(img)
      // 计数（按各自置信度阈值过滤）
      const abCount = dets.filter(d => d.className === '自动战斗' && d.conf > this.config.autoBattleConf).length
      const fpCount = dets.filter(d => d.className === '四小人' && d.conf > this.config.fourPeopleConf).length
      const normDets = dets.map(d => this.toNormDet(d, img.width, img.height))
      this.cb.onDetect?.(normDets, abCount, fpCount)
      this.evaluate(abCount, fpCount)
      this.syncGeneric()
    } catch (e) {
      console.warn('[jk4Logic] detectTick 出错:', e)
    } finally {
      this.busy = false
    }
  }

  private evaluate(abCount: number, fpCount: number) {
    const mf = this.config.missFrames
    const noBox = abCount === 0
    // 正向数量监测：仅当实际数量「少于」目标才视为异常（多于目标不报警）
    const countShort = abCount < this.config.targetAutoBattleCount
    const fpDetected = fpCount > 0

    if (noBox) this.missCount++
    else this.missCount = 0
    if (countShort) this.countMiss++
    else this.countMiss = 0
    if (fpDetected) this.fpMiss++
    else this.fpMiss = 0

    const now = Date.now()
    const cooldownOk = now - this.lastAlertTs > this.config.alertCooldownMs

    // 组合报警判定（任一模式命中且过冷却即报警）
    let willAlert = false
    let reason = ''
    if (this.config.enableAlert && this.missCount > mf) {
      willAlert = true
      reason = '自动战斗框消失报警：画面中已无自动战斗框，疑似掉线 / 战斗结束 / 卡死'
    } else if (this.config.enableCountAlert && this.countMiss > mf) {
      willAlert = true
      reason = `自动战斗框数量报警：实际 ${abCount} 个 / 目标 ${this.config.targetAutoBattleCount} 个`
    } else if (this.config.enableFourPeopleAlert && this.fpMiss > mf) {
      willAlert = true
      reason = `四小人出现报警：检测到四小人框 ${fpCount} 个，疑似异常`
    }

    if (willAlert && cooldownOk) {
      this.lastAlertTs = now
      this.cb.onAlert()
      playAlarm(this.config.soundType, this.config.playTimes)
      // 推送：总开关开启时回调，具体发到哪个渠道由视图层按选中项决定（单选）
      if (this.config.enablePush) this.cb.onNotify?.(reason)
      this.cb.onStatus(`⚠️ ${reason}，正在播放预警音效`, ORANGE)
      return
    }

    // 正常 / 监测中状态文案
    const base = `自动战斗 ${abCount} · 四小人 ${fpCount}`
    const ok =
      (!this.config.enableAlert || !noBox) &&
      (!this.config.enableCountAlert || !countShort) &&
      (!this.config.enableFourPeopleAlert || !fpDetected)
    if (willAlert && !cooldownOk) {
      this.cb.onStatus(`⚠️ ${reason}，预警冷却中（${Math.ceil((this.config.alertCooldownMs - (now - this.lastAlertTs)) / 1000)}s）`, ORANGE)
    } else if (this.config.enableCountAlert && countShort) {
      this.cb.onStatus(`⚠️ ${base}（目标 ${this.config.targetAutoBattleCount}），数量不足未达报警帧数（${this.countMiss}/${mf}）`, ORANGE)
    } else if (this.config.enableAlert && noBox) {
      this.cb.onStatus(`检测中，无自动战斗框（${this.missCount}/${mf}）`, ORANGE)
    } else if (this.config.enableFourPeopleAlert && fpDetected) {
      this.cb.onStatus(`⚠️ ${base}，四小人框出现（${this.fpMiss}/${mf}），疑似异常将报警`, ORANGE)
    } else {
      this.cb.onStatus(base + (this.config.enableCountAlert ? `（目标 ${this.config.targetAutoBattleCount}）` : ''), ok ? GREEN : ORANGE)
    }
  }

  /** 运行中根据 enableGeneric 动态启停通用监控定时器 */
  private syncGeneric() {
    const want = this.config.enableGeneric && !!this.region
    if (want && this.genericTimer === null) {
      this.genericPrev = null
      this.genericTimer = window.setInterval(() => void this.genericTick(), 1050)
    } else if (!want && this.genericTimer !== null) {
      window.clearInterval(this.genericTimer)
      this.genericTimer = null
      this.genericPrev = null
    }
  }

  private async genericTick() {
    if (!this.region || !this.sc.isActive()) return
    const b64 = this.sc.captureRegion(this.region)
    if (!b64) return
    const cur = await decodeRegion(b64)
    if (!cur) return
    if (!this.genericPrev) {
      this.genericPrev = cur
      return
    }
    const rate = diffRate(cur, this.genericPrev)
    const ratePct = rate * 100
    this.genericPrev = cur
    if (rate >= Math.max(0.1, this.config.genericThreshold) / 100) {
      this.cb.onGenericAlert?.(ratePct)
      playAlarm(this.config.soundType, this.config.playTimes)
    }
  }

  /** 标签页重新可见时立即补一帧 */
  poke() {
    if (this.running && !this.busy) void this.detectTick()
  }

  stop() {
    this.running = false
    if (this.detectTimer !== null) {
      window.clearInterval(this.detectTimer)
      this.detectTimer = null
    }
    if (this.genericTimer !== null) {
      window.clearInterval(this.genericTimer)
      this.genericTimer = null
    }
    this.genericPrev = null
    this.cb.onStop?.()
  }

  isRunning() {
    return this.running
  }
}
