// 页面级输入持久化公共工具（localStorage）
// 与 priceStore(mhxy_price_v1)、calcOverride、VitalityView、CalcView 同为 localStorage 方案，
// 无账号、无后端。各详情页只需：loadPersist 读 → 初始化 ref → watchPersist 自动写。
import { watch, type WatchSource } from 'vue'

const LS_VERSION = 1

// 读取存档；版本不符（结构变更）→ 返回 null，页面回落默认值
export function loadPersist<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const d = JSON.parse(raw) as { version?: number } & Partial<T>
    return d && d.version === LS_VERSION ? d : null
  } catch {
    return null
  }
}

// 删除存档（用户不再需要「恢复默认」按钮，保留此工具以备将来用）
export function removePersist(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * 监听若干响应式来源，改动后防抖写入 localStorage。
 * deep:true —— 支持数组/对象内部字段变化（如武器列表）。
 * @param key 固定键名，或返回键名的函数（CalcView 的键随计算器 id 变化）；返回空串则跳过写入
 * @param collect 返回要持久化的字段（不必含 version，内部自动加）
 */
export function watchPersist<T extends object>(
  key: string | (() => string),
  sources: WatchSource[],
  collect: () => T,
  delay = 250,
): void {
  const resolveKey = typeof key === 'string' ? () => key : key
  let timer: ReturnType<typeof setTimeout> | null = null
  watch(
    sources,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const k = resolveKey()
        if (!k) return
        try {
          localStorage.setItem(k, JSON.stringify({ version: LS_VERSION, ...collect() }))
        } catch {
          /* 隐私模式 / 配额满：静默降级，不影响计算 */
        }
      }, delay)
    },
    { deep: true },
  )
}
