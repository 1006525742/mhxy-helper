/**
 * 钓鱼助手匹配器（纯逻辑，无 Vue / DOM 依赖，可直接在 Node 跑测试）
 *
 * 设计要点（相对 mhxyai 原版的改进）：
 *  1. 事件流「累积去重」：每轮把 OCR 新行追加进 observed，重复行按归一化相似度去重，
 *     不再像原版「每轮对选区全文全量重算」——聊天刷屏也不会丢事件。
 *  2. 归一化表清理了原版的 3 处瑕疵：
 *     - `波荡漾→波荡漾` / `沉了下去→沉了下去` 是自我替换的空操作（已删）
 *     - `上下起浮↔上起下浮` 来回替换三次会造成净翻转。注意「鱼漂上起下浮」与
 *       「鱼漂上下起浮」是不同鱼种的分辨事件，绝不能互相归一，故彻底删除该组替换。
 *  3. 槽位级提前锁定：在「与已观察事件序列一致(子序列匹配)」的全部规则中，
 *     若某槽位(力度/角度/速度)取值唯一即提前锁定——这是体验好的根本原因。
 *  4. 终局判定用 DP 对齐(LCS + 模糊行匹配)替代原版贪心，允许一次跳过并扣分，更稳。
 */

export type SlotKey = '力度' | '角度' | '速度'

export interface FishingRule {
  fish: string
  /** 顺序与 SlotKey 一致：0=力度 1=角度 2=速度。元素可为多值(如 ['直竿','斜竿']) */
  action: (string | string[])[]
  events: string[]
  rare?: boolean
}

export interface FishingPlaceData {
  [place: string]: FishingRule[]
}

export interface FishingRulesFile {
  _meta?: Record<string, unknown>
  places: FishingPlaceData
}

export interface SlotLock {
  slot: SlotKey
  value: string
  /** 一致规则数（越多代表该锁定越有把握） */
  candidates: number
}

export interface CandidateInfo {
  fish: string
  /** 已展平：多值槽位用 "/" 连接，如 "直竿/斜竿" */
  action: string[]
  score: number
  rare: boolean
}

export interface MatchResult {
  place: string
  observed: string[]
  /** 已锁定的槽位（提前给出力度/角度/速度，不等鱼种唯一） */
  lockedSlots: Partial<Record<SlotKey, string>>
  candidates: CandidateInfo[]
  best: CandidateInfo | null
  /** 鱼种是否已唯一确定（所有已观察事件只被一条规则完整解释） */
  determined: boolean
}

const THRESHOLD = 0.72 // 模糊行匹配阈值（沿用原版）
const DEDUP_THRESHOLD = 0.85 // 事件去重阈值

// ---------------------------------------------------------------------------
// 归一化（清理标点空格 + 安全纠错）
// ---------------------------------------------------------------------------
export function normalize(s: string): string {
  return String(s || '')
    .replace(/[，,。.!！?？、\s]/g, '')
    .replace(/好像/g, '好象')
    .replace(/魚/g, '鱼')
    .replace(/竿/g, '杆')
    .replace(/钓/g, '钩')
    .replace(/勾/g, '钩')
    .replace(/徽/g, '微')
}

// ---------------------------------------------------------------------------
// 编辑距离 / 相似度
// ---------------------------------------------------------------------------
export function levenshtein(a: string, b: string): number {
  const al = a.length
  const bl = b.length
  if (!al) return bl
  if (!bl) return al
  let prev = new Array<number>(bl + 1)
  let cur = new Array<number>(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    cur[0] = i
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[bl]
}

export function similarity(a: string, b: string): number {
  const n = normalize(a)
  const r = normalize(b)
  const max = Math.max(n.length, r.length)
  if (!max) return 1
  return Math.max(0, 1 - levenshtein(n, r) / max)
}

// ---------------------------------------------------------------------------
// 单行模糊匹配（mhxyai 的 X：子串优先 + 滑窗阈值，窗口长度 = |规则行|±2）
// ---------------------------------------------------------------------------
export function lineMatch(obs: string, evt: string): boolean {
  const n = normalize(obs)
  const r = normalize(evt)
  if (!n || !r) return false
  if (n.includes(r) || r.includes(n)) return true
  const lo = Math.max(2, r.length - 2)
  const hi = r.length + 2
  for (let len = lo; len <= hi; len++) {
    if (len > n.length) continue
    for (let start = 0; start + len <= n.length; start++) {
      if (similarity(n.slice(start, start + len), r) >= THRESHOLD) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// 子序列一致性：observed 中每一行都能在 events 中按顺序(允许跳过 events)模糊匹配到
// 用于「槽位锁定」的一致性判定
// ---------------------------------------------------------------------------
function isSubsequence(observed: string[], events: string[]): boolean {
  let p = 0
  for (const o of observed) {
    let matched = false
    while (p < events.length) {
      if (lineMatch(o, events[p])) {
        p += 1
        matched = true
        break
      }
      if (p + 1 < events.length && lineMatch(o, events[p] + events[p + 1])) {
        p += 2
        matched = true
        break
      }
      if (p + 2 < events.length && lineMatch(o, events[p] + events[p + 1] + events[p + 2])) {
        p += 3
        matched = true
        break
      }
      p += 1 // 该规则事件未被此观察行匹配，跳过继续往后找
    }
    if (!matched) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// DP 对齐(LCS)打分：observed 行与 events 行模糊匹配，允许跳过任意一方
// 用于终局鱼种排序（比原版贪心 jt 更稳，可回溯）
// ---------------------------------------------------------------------------
function alignScore(observed: string[], events: string[]): number {
  const m = observed.length
  const n = events.length
  if (m === 0) return 0
  let dp = new Array<number>(n + 1).fill(0)
  let cur = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      let best = dp[j] // 跳过 observed[i-1]（视作杂讯）
      if (lineMatch(observed[i - 1], events[j - 1])) {
        best = Math.max(best, dp[j - 1] + 1)
      }
      best = Math.max(best, cur[j - 1]) // 跳过 events[j-1]
      cur[j] = best
    }
    const t = dp
    dp = cur
    cur = t
  }
  return dp[n]
}

const SLOTS: SlotKey[] = ['力度', '角度', '速度']

function flattenAction(action: (string | string[])[]): string[] {
  return action.map((a) => (Array.isArray(a) ? a.join('/') : a))
}

// ---------------------------------------------------------------------------
// 匹配器主体
// ---------------------------------------------------------------------------
export class FishingMatcher {
  private places: FishingPlaceData = {}
  private observed: Record<string, string[]> = {}

  load(data: FishingRulesFile): void {
    this.places = data.places || {}
    this.observed = {}
  }

  getPlaces(): string[] {
    return Object.keys(this.places)
  }

  reset(place?: string): void {
    if (!place) this.observed = {}
    else delete this.observed[place]
  }

  getObserved(place: string): string[] {
    return [...(this.observed[place] || [])]
  }

  /** 该行是否与已观察序列中的某一行重复（归一化相似度） */
  private isDuplicated(place: string, line: string): boolean {
    const n = normalize(line)
    if (!n) return true
    for (const exist of this.observed[place] || []) {
      if (similarity(exist, line) >= DEDUP_THRESHOLD) return true
    }
    return false
  }

  /**
   * 喂入本轮 OCR 得到的新行（已按行切分），做去重累积后返回分析结果。
   * @param newLines 本轮识别出的文本行（原始即可，归一化在内部处理）
   */
  feed(place: string, newLines: string[]): MatchResult {
    if (!this.observed[place]) this.observed[place] = []
    for (const l of newLines) {
      const t = String(l || '').trim()
      if (!t) continue
      if (!this.isDuplicated(place, t)) this.observed[place].push(t)
    }
    return this.analyze(place)
  }

  analyze(place: string): MatchResult {
    const obs = this.observed[place] || []
    const rules = this.places[place] || []

    // 1) 一致性规则集
    const consistent = rules.filter((r) => isSubsequence(obs, r.events))

    // 2) 槽位级提前锁定
    const lockedSlots: Partial<Record<SlotKey, string>> = {}
    for (const slot of SLOTS) {
      const idx = SLOTS.indexOf(slot)
      const vals = new Set<string>()
      for (const r of consistent) {
        const a = r.action[idx]
        vals.add(Array.isArray(a) ? a.join('/') : a)
      }
      if (vals.size === 1) lockedSlots[slot] = [...vals][0]
    }

    // 3) 终局排序（DP 对齐打分，平局取更短规则）
    const scored = rules
      .map((r) => ({ rule: r, score: alignScore(obs, r.events) }))
      .sort((x, y) => y.score - x.score || x.rule.events.length - y.rule.events.length)

    const candidates: CandidateInfo[] = scored.slice(0, 5).map((s) => ({
      fish: s.rule.fish,
      action: flattenAction(s.rule.action),
      score: s.score,
      rare: !!s.rule.rare
    }))

    const best: CandidateInfo | null =
      scored[0] && scored[0].score > 0
        ? {
            fish: scored[0].rule.fish,
            action: flattenAction(scored[0].rule.action),
            score: scored[0].score,
            rare: !!scored[0].rule.rare
          }
        : null

    // 4) 鱼种唯一确定：仅一条规则与全部已观察事件一致，且其对齐分恰好覆盖所有观察行
    const determined = consistent.length === 1 && best !== null && best.score === obs.length && obs.length > 0

    return { place, observed: [...obs], lockedSlots, candidates, best, determined }
  }
}

// ---------------------------------------------------------------------------
// 回合结束检测（提竿/脱钩/溜走等）
// ---------------------------------------------------------------------------
const END_RE = /很遗憾|脱钩|溜走|收获|鱼儿.*走/
export function isRoundEnd(text: string): boolean {
  const t = normalize(text)
    .replace(/脱勾/g, '脱钩')
    .replace(/很遗撼/g, '很遗憾')
  return END_RE.test(t)
}
