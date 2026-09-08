/**
 * 自动战斗框监控状态管理（复刻 mhxyai.com/v2/jiankong4）
 * 配置 + 运行状态，供 Jiankong4View 使用。
 *
 * 配置持久化：整个 config 自动存取 localStorage（key: jk4:config）。
 *
 * 推送渠道为「单选一个」：企业微信 / PushPlus / QQ邮箱 三选一，但各自凭据独立保存，
 * 切换渠道不会丢失其它渠道已填的配置。读取时与默认值合并，并自动迁移旧结构，老配置不会丢。
 */
import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import type { AlertSoundType } from '@/services/jiankongLogic'

const STORAGE_KEY = 'jk4:config'

/** 默认配置（首次使用 / localStorage 无数据时生效） */
function createDefaultConfig() {
  return {
    /** 自动战斗框消失（一个都没有）时报警（核心功能，默认开） */
    enableAlert: true,
    /** 四小人框出现即报警（负面信号，默认开） */
    enableFourPeopleAlert: true,
    /** 自动战斗框数量少于目标时报警（正向监测：多于目标不报，默认开） */
    enableCountAlert: true,
    /** 目标自动战斗框数量（实际少于此值才报警，默认 4） */
    targetAutoBattleCount: 4,
    /** 连播次数 */
    playTimes: 3,
    /** 预警音类型：默认「音色④」(/mp3/4.mp3，即原站月光挂机提醒音) */
    soundType: 'tone4' as AlertSoundType,
    /** 开启通用监控（红框像素差异） */
    enableGeneric: false,
    /** 限定监控区域：开启后仅检测红框内（聚焦游戏窗口、更快更准），默认整屏 */
    limitRegion: false,
    /** 通用监控变化阈值（%） */
    genericThreshold: 5,

    /* ---------- 推送渠道：单选一个（三渠道凭据独立保存，切换不丢） ---------- */
    /** 总开关 */
    enablePush: false,
    /** 当前选中的推送渠道 */
    pushChannel: 'wecom' as 'wecom' | 'pushplus' | 'qqmail',
    /** 企业微信群机器人 webhook 地址 */
    wecom: { webhook: '' },
    /** PushPlus（微信公众号，个人微信收） */
    pushplus: { token: '' },
    /** QQ 邮箱（填 QQ 号发到 QQ号@qq.com） */
    qqmail: { qq: '', mailApi: 'http://127.0.0.1:8011/api/notify/qqmail' },

    /** 主检测间隔（ms） */
    detectIntervalMs: 1000,
    /** 连续多少帧异常（消失 / 数量不符）才判定为真实异常并报警 */
    missFrames: 6,
    /** 两次报警最小间隔（ms） */
    alertCooldownMs: 30000,
    /** 自动战斗框置信度阈值（0~1） */
    autoBattleConf: 0.7,
    /** 四小人置信度阈值（0~1） */
    fourPeopleConf: 0.85,
    /** 监控界面是否叠加显示 YOLO 检测框 */
    showBoxes: true
  }
}

type Jk4ConfigShape = ReturnType<typeof createDefaultConfig>

/**
 * 嵌套合并渠道对象：以默认值兜底，但「只覆盖非空值」——
 * 旧数据若把某字段存成了空字符串（如早期版本的 mailApi 留空），不能让它把默认值覆盖成空。
 */
function mergeChannel<T extends Record<string, any>>(def: T, saved: Record<string, any> | undefined): T {
  const out: T = { ...def }
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(def)) {
      const v = saved[k]
      if (v !== undefined && v !== null && v !== '') (out as Record<string, any>)[k] = v
    }
  }
  return out
}

/**
 * 从 localStorage 恢复配置：
 * 1) 与默认值浅合并（旧数据缺字段时补默认，新增字段自动生效）
 * 2) 三个渠道对象做嵌套合并，避免旧数据只存了部分字段
 * 3) 迁移旧结构（三独立开关 / 平铺字段）到「单选渠道 + 总开关」结构，老凭据不丢
 */
function loadConfig(): Jk4ConfigShape {
  const def = createDefaultConfig()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return def
    const saved = JSON.parse(raw) as Record<string, unknown>
    if (!saved || typeof saved !== 'object') return def

    const cfg = { ...def, ...saved } as Jk4ConfigShape & Record<string, unknown>
    const s = saved as Record<string, any>
    // 嵌套合并渠道对象，旧数据缺字段/空字段不丢默认值
    cfg.wecom = mergeChannel(def.wecom, s.wecom)
    cfg.pushplus = mergeChannel(def.pushplus, s.pushplus)
    cfg.qqmail = mergeChannel(def.qqmail, s.qqmail)

    // 由旧「三独立开关」结构推导单选（旧数据每个渠道带 enabled）
    const wecomOn = !!(s.wecom && s.wecom.enabled)
    const ppOn = !!(s.pushplus && s.pushplus.enabled)
    const qqOn = !!(s.qqmail && s.qqmail.enabled)
    if (wecomOn || ppOn || qqOn) {
      cfg.enablePush = true
      cfg.pushChannel = wecomOn ? 'wecom' : ppOn ? 'pushplus' : 'qqmail'
    } else if ('wecomWebhook' in s || 'pushplusToken' in s || 'qqNumber' in s) {
      // 更老的平铺结构：enablePush + pushChannel + 平铺凭据
      cfg.enablePush = !!s.enablePush
      cfg.pushChannel = (s.pushChannel as 'wecom' | 'pushplus' | 'qqmail') || def.pushChannel
      if (s.wecomWebhook) cfg.wecom.webhook = s.wecomWebhook
      if (s.pushplusToken) cfg.pushplus.token = s.pushplusToken
      if (s.qqNumber) cfg.qqmail.qq = s.qqNumber
      if (s.mailApi) cfg.qqmail.mailApi = s.mailApi
    }
    // 清理旧结构残留的 enabled 字段
    delete (cfg.wecom as any).enabled
    delete (cfg.pushplus as any).enabled
    delete (cfg.qqmail as any).enabled
    return cfg
  } catch {
    return def
  }
}

export const useJk4Store = defineStore('jk4', () => {
  const config = reactive(loadConfig())

  /* ---------- 配置变更自动持久化（防抖 300ms） ---------- */
  let saveTimer: number | null = null
  watch(
    config,
    () => {
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
        } catch {
          /* 隐私模式 / 配额满时忽略，不影响监控运行 */
        }
      }, 300)
    },
    { deep: true }
  )

  /** 恢复全部参数为默认值（保留三个渠道的凭据与开关，避免用户重填） */
  function resetConfig() {
    const def = createDefaultConfig()
    const keep = {
      wecom: { ...config.wecom },
      pushplus: { ...config.pushplus },
      qqmail: { ...config.qqmail }
    }
    Object.assign(config, def, keep)
  }

  /** 是否开启了消息推送（单选渠道，总开关即代表） */
  function anyPushEnabled() {
    return config.enablePush
  }

  const isSharing = ref(false)
  const isMonitoring = ref(false)

  // 模型加载状态
  const modelStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const modelProgress = ref(0)
  const modelSource = ref<'cache' | 'download' | null>(null)
  const modelError = ref('')

  // 运行态
  const statusText = ref('请先开始屏幕共享，再点击「开始监控」')
  const statusColor = ref('#6b5744')
  const alertCount = ref(0)
  const pushSentCount = ref(0)
  /** 实时检测计数（供界面显示） */
  const autoBattleCount = ref(0)
  const fourPeopleCount = ref(0)

  function setSharing(v: boolean) {
    isSharing.value = v
  }
  function setMonitoring(v: boolean) {
    isMonitoring.value = v
  }
  function setStatus(text: string, color: string) {
    statusText.value = text
    statusColor.value = color
  }
  function incAlert() {
    alertCount.value++
  }
  function setCounts(ab: number, fp: number) {
    autoBattleCount.value = ab
    fourPeopleCount.value = fp
  }
  function setModelStatus(s: 'idle' | 'loading' | 'ready' | 'error', progress = 0, source: 'cache' | 'download' | null = null, error = '') {
    modelStatus.value = s
    modelProgress.value = progress
    if (source !== null) modelSource.value = source
    modelError.value = error
  }
  function incPush() {
    pushSentCount.value++
  }

  return {
    config,
    isSharing,
    isMonitoring,
    modelStatus,
    modelProgress,
    modelSource,
    modelError,
    statusText,
    statusColor,
    alertCount,
    pushSentCount,
    autoBattleCount,
    fourPeopleCount,
    setSharing,
    setMonitoring,
    setStatus,
    incAlert,
    setCounts,
    setModelStatus,
    incPush,
    resetConfig,
    anyPushEnabled
  }
})
