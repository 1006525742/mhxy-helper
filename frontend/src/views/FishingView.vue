<script setup lang="ts">
import { ref, computed } from 'vue'
import rulesData from '@/data/fishingRules.json'

interface FishRule {
  fish: string
  action: (string | string[])[]
  events: string[]
  rare: boolean
}
interface RulesFile {
  _meta?: { actionOrder?: string[] }
  places: Record<string, FishRule[]>
}

const data = rulesData as unknown as RulesFile
const places = Object.keys(data.places)
const activePlace = ref(places[0] ?? '')
const keyword = ref('')

const actionOrder = data._meta?.actionOrder ?? ['力度', '角度', '速度']

// 每种「第 1 句」分配一个颜色，便于一排内混排时区分触发条件
const GROUP_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fbbf24', '#4ade80']

const fishList = computed<FishRule[]>(() => {
  const list = data.places[activePlace.value] ?? []
  const kw = keyword.value.trim()
  if (!kw) return list
  return list.filter((f) => f.fish.includes(kw))
})

function actText(a: string | string[]): string {
  return Array.isArray(a) ? a.join('/') : a
}
// 收杆动作简写：取每一档首字拼接，如 中力+直竿+快速 → 中直快
function abbrOf(a: string | string[]): string {
  return Array.isArray(a) ? a.map((x) => x[0]).join('/') : a[0]
}
function actionAbbr(action: (string | string[])[]): string {
  return action.map(abbrOf).join('')
}
function actionFull(action: (string | string[])[]): string {
  return action.map((a, i) => `${actionOrder[i] ?? ''}:${actText(a)}`).join('  ')
}

interface DecChip { slotLabel: string; abbr: string; full: string }

// 在同一「第 1 句」组内，按「事件前缀」逐步缩小候选，推导每条鱼每一档动作在哪一句锁定：
// 读到第 i 句时，取组内事件前缀（第 1~i 句）完全相同的候选鱼；
// 若这些候选鱼该档取值一致（尤其只剩自己一条时）→ 该档即在第 i 句判定完成。
function buildGroupCards(group: FishRule[], firstLine: string, color: string): Card[] {
  const prefixOf = (f: FishRule, i: number) => f.events.slice(0, i + 1).join('\u0000')

  // 整组恒定的档位 → 本组固定
  const fixedFlags = [false, false, false]
  const fixedChips: DecChip[] = []
  for (let j = 0; j < 3; j++) {
    const vals = group.map((f) => actText(f.action[j]))
    if (new Set(vals).size === 1) {
      fixedFlags[j] = true
      fixedChips.push({
        slotLabel: actionOrder[j] ?? '',
        abbr: abbrOf(group[0].action[j]),
        full: actText(group[0].action[j])
      })
    }
  }

  return group.map((f) => {
    const decByEvent: Record<number, DecChip[]> = {}
    for (let j = 0; j < 3; j++) {
      if (fixedFlags[j]) continue
      // 第 1 句全组相同，从第 2 句（index 1）开始逐句收敛
      for (let i = 1; i < 5; i++) {
        const prefix = prefixOf(f, i)
        const cands = group.filter((g) => prefixOf(g, i) === prefix)
        if (cands.every((g) => actText(g.action[j]) === actText(f.action[j]))) {
          if (!decByEvent[i]) decByEvent[i] = []
          decByEvent[i].push({
            slotLabel: actionOrder[j] ?? '',
            abbr: abbrOf(f.action[j]),
            full: actText(f.action[j])
          })
          break
        }
      }
    }
    return { ...f, firstLine, color, decByEvent, fixedChips }
  })
}

interface Card {
  fish: string
  action: (string | string[])[]
  events: string[]
  rare: boolean
  firstLine: string
  color: string
  decByEvent: Record<number, DecChip[]>
  fixedChips: DecChip[]
}

// 按「第 1 句事件」分组（同组不拆散），再贪心装箱：一排最多 5 张，能凑满就并排
const MAX_PER_ROW = 5
const rows = computed<Card[][]>(() => {
  const map = new Map<string, FishRule[]>()
  for (const f of fishList.value) {
    const key = f.events[0] ?? ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  const groups: Card[][] = []
  let gi = 0
  for (const [firstLine, group] of map.entries()) {
    const color = GROUP_COLORS[gi % GROUP_COLORS.length]
    groups.push(buildGroupCards(group, firstLine, color))
    gi++
  }
  // 贪心装箱：组内卡片必须同一排；装不下就换排
  const out: Card[][] = []
  let cur: Card[] = []
  for (const g of groups) {
    if (g.length > MAX_PER_ROW) {
      for (let i = 0; i < g.length; i += MAX_PER_ROW) {
        if (cur.length) { out.push(cur); cur = [] }
        out.push(g.slice(i, i + MAX_PER_ROW))
      }
      continue
    }
    if (cur.length && cur.length + g.length > MAX_PER_ROW) {
      out.push(cur)
      cur = []
    }
    cur.push(...g)
  }
  if (cur.length) out.push(cur)
  return out
})
const totalCount = computed(() => rows.value.reduce((n, r) => n + r.length, 0))
</script>

<template>
  <div class="fishing-view">
    <header class="fv-head">
      <h2>🐟 金牌钓手</h2>
      <p class="fv-sub">钓鱼助手 · 收杆动作参考（傲来国 / 长寿村）</p>
    </header>

    <nav class="place-tabs">
      <button
        v-for="p in places"
        :key="p"
        :class="['place-tab', { active: activePlace === p }]"
        @click="activePlace = p"
      >{{ p }}</button>
    </nav>

    <div class="fv-toolbar">
      <input
        v-model="keyword"
        class="filter"
        type="search"
        placeholder="筛选鱼种，如：海马 / 随机"
      />
      <span class="legend">
        简写顺序：力度 / 角度 / 速度（如 中直快）。
        <b class="hl">高亮句=判定句</b>，其后色标即该句能判出的动作档位
      </span>
      <span class="count">共 {{ totalCount }} 种</span>
    </div>

    <div v-if="rows.length" class="fish-rows">
      <div v-for="(row, ri) in rows" :key="ri" class="fish-row">
        <article
          v-for="c in row"
          :key="c.fish"
          class="fish-card"
          :class="{ rare: c.rare }"
          :style="{ '--gcolor': c.color }"
        >
          <header class="fc-head">
            <span class="fc-name">{{ c.fish }}</span>
            <span v-if="c.rare" class="rare-badge">稀有</span>
          </header>

          <div class="fc-first">
            <span class="first-tag">第一句</span>
            <span class="first-line">{{ c.firstLine }}</span>
          </div>

          <div v-if="c.fixedChips.length" class="fixed-row">
            <span class="fixed-label">本组固定</span>
            <span
              v-for="(d, i) in c.fixedChips"
              :key="i"
              class="dec-chip"
              :title="`${d.slotLabel}：${d.full}（本组固定）`"
            >{{ d.abbr }}</span>
          </div>

          <div class="fc-action" :title="actionFull(c.action)">
            {{ actionAbbr(c.action) }}
          </div>

          <ol class="fc-events">
            <li
              v-for="(e, k) in c.events.slice(1)"
              :key="k"
              :class="{ decisive: !!c.decByEvent[k + 1] }"
            >
              <b>{{ k + 2 }}</b>
              <div class="ev-body">
                <span class="ev-text">{{ e }}</span>
                <span v-if="c.decByEvent[k + 1]" class="dec-chips">
                  <span
                    v-for="(d, di) in c.decByEvent[k + 1]"
                    :key="di"
                    class="dec-chip"
                    :title="`${d.slotLabel}：${d.full}（读到本句即可确定）`"
                  >{{ d.abbr }}</span>
                </span>
              </div>
            </li>
          </ol>
        </article>
      </div>
    </div>
    <p v-else class="empty">没有匹配「{{ keyword }}」的鱼种</p>

    <footer class="fv-foot">
      数据来源：游戏内实测 + 公开攻略整理（展示内容参考 fbbizyy 钓鱼助手）
    </footer>
  </div>
</template>

<style scoped>
.fishing-view { padding: 16px 20px; color: var(--color-text); width: 100%; box-sizing: border-box; }
.fv-head { margin-bottom: 14px; }
.fv-head h2 { font-size: 20px; color: var(--color-primary); margin: 0; }
.fv-sub { margin: 4px 0 0; font-size: 13px; color: var(--color-text-muted); }

.place-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.place-tab {
  background: var(--bg-card); border: 1px solid var(--border-color);
  color: var(--color-text-muted); padding: 6px 16px; border-radius: 8px; cursor: pointer;
  font-size: 14px;
}
.place-tab.active { color: #fff; background: var(--color-primary); border-color: var(--color-primary); }

.fv-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.filter {
  flex: 1; max-width: 320px; padding: 7px 12px; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--bg-input); color: var(--color-text);
}
.legend { font-size: 12px; color: var(--color-text-muted); line-height: 1.5; }
.legend .hl { color: var(--color-primary); }
.count { font-size: 12px; color: var(--color-text-muted); margin-left: auto; }

/* 每排由 JS 按「组不拆散、最多 5 张」装箱生成，整排居中 */
.fish-rows { display: flex; flex-direction: column; gap: 12px; }
.fish-row {
  display: flex; justify-content: center; gap: 12px;
}
.fish-card {
  flex: 0 1 calc((100% - 48px) / 5);
  min-width: 168px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-left: 3px solid var(--gcolor, var(--color-primary));
  border-radius: 10px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.fish-card.rare { border-color: #ffce4f; border-left-color: #ffce4f; box-shadow: 0 0 0 1px rgba(255,206,79,.35) inset; }

.fc-head { display: flex; align-items: center; gap: 8px; }
.fc-name { font-size: 16px; font-weight: 600; color: var(--color-primary); }
.rare-badge { font-size: 12px; background: #ffce4f; color: #000; padding: 2px 7px; border-radius: 4px; }

.fc-first { display: flex; align-items: center; gap: 6px; }
.first-tag {
  font-size: 10px; color: #0a0e18; background: var(--gcolor, var(--color-primary));
  padding: 1px 5px; border-radius: 3px; flex: 0 0 auto;
}
.first-line { font-size: 13px; color: var(--color-text); font-weight: 600; line-height: 1.35; }

.fixed-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.fixed-label { font-size: 10px; color: var(--color-text-muted); }

.fc-action {
  font-size: 20px; font-weight: 700; letter-spacing: 2px;
  color: var(--gcolor, var(--color-primary)); cursor: help; text-align: center;
}

.fc-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.fc-events li {
  display: flex; gap: 7px; font-size: 13px; line-height: 1.5; color: var(--color-text);
  border-radius: 5px; padding: 1px 2px; margin: 0 -2px;
}
/* 判定句：高亮底色，一眼看出靠这句做判断 */
.fc-events li.decisive {
  background: color-mix(in srgb, var(--gcolor, var(--color-primary)) 14%, transparent);
  box-shadow: inset 2px 0 0 var(--gcolor, var(--color-primary));
}
.fc-events li b {
  flex: 0 0 17px; height: 17px; width: 17px; border-radius: 50%;
  background: var(--gcolor, var(--color-primary)); color: #0a0e18; font-size: 10px;
  display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;
}
/* 判定标记紧跟在句子右侧，不换行到下方 */
.ev-body { display: flex; align-items: flex-start; gap: 6px; min-width: 0; flex: 1 1 auto; }
.ev-text { flex: 1 1 auto; min-width: 0; word-break: break-all; }
.dec-chips { display: flex; flex: 0 0 auto; gap: 3px; }
.dec-chip {
  flex: 0 0 auto; min-width: 17px; height: 17px; padding: 0 4px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; border-radius: 4px; cursor: help;
  background: var(--gcolor, var(--color-primary)); color: #0a0e18;
}

.empty { color: var(--color-text-muted); font-size: 14px; padding: 20px 0; text-align: center; }
.fv-foot { margin-top: 18px; font-size: 12px; color: var(--color-text-muted); }
</style>
