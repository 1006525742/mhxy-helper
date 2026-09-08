import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { DetectedBoard } from '@/services/cixinDetect'
import type { OthelloMoveResponse } from '@/services/cixinApi'

export type CixinStrength = 'strong' | 'ultra'
export type CixinStrategy = 'winFirst' | 'boxFirst' | 'taskFirst'

const STRATEGY_KEY = 'cixin:strategy'

function loadStrategy(): CixinStrategy {
  try {
    const v = localStorage.getItem(STRATEGY_KEY)
    if (v === 'winFirst' || v === 'boxFirst' || v === 'taskFirst') return v
  } catch {
    // localStorage 不可用
  }
  return 'winFirst'
}

export const useCixinStore = defineStore('cixin', () => {
  /** 是否正在屏幕共享 */
  const isSharing = ref(false)
  /** AI 计算中 */
  const isComputing = ref(false)
  /** 最近一次识别到的棋盘 */
  const detection = ref<DetectedBoard | null>(null)
  /** AI 求解结果 */
  const result = ref<OthelloMoveResponse | null>(null)
  /** 棋力档位 */
  const strength = ref<CixinStrength>('strong')
  /** 求解策略：winFirst(默认) / boxFirst(抢宝箱) / taskFirst(速刷) */
  const strategy = ref<CixinStrategy>(loadStrategy())
  /** 错误信息 */
  const error = ref('')

  // 切换策略时持久化到 localStorage
  watch(strategy, (v) => {
    try {
      localStorage.setItem(STRATEGY_KEY, v)
    } catch {
      // 忽略
    }
  })

  const statusText = computed(() => {
    if (isComputing.value) return 'AI 正在计算白棋最优落点…'
    if (error.value) return error.value
    if (result.value) {
      const r = result.value
      if (r.legal_moves.length === 0) return '当前没有白棋合法落点（可能已结束本局）'
      return `建议落在 ${r.notation} · ${r.coordinate_label}`
    }
    if (detection.value?.isPlausible) return '已识别棋盘，等待稳定后搜索…'
    if (isSharing.value) return '共享游戏窗口后，会自动识别棋盘并给出落点与地图。'
    return '选择屏幕共享后将自动识别棋盘。'
  })

  function setSharing(v: boolean) {
    isSharing.value = v
  }
  function setDetection(d: DetectedBoard | null) {
    detection.value = d
    if (d?.isPlausible) error.value = ''
  }
  function setComputing(v: boolean) {
    isComputing.value = v
  }
  function setResult(r: OthelloMoveResponse | null) {
    result.value = r
  }
  function setStrategy(v: CixinStrategy) {
    strategy.value = v
  }
  function setError(msg: string) {
    error.value = msg
  }
  function resetResult() {
    result.value = null
    error.value = ''
  }

  return {
    isSharing,
    isComputing,
    detection,
    result,
    strength,
    strategy,
    error,
    statusText,
    setSharing,
    setDetection,
    setComputing,
    setResult,
    setStrategy,
    setError,
    resetResult
  }
})
