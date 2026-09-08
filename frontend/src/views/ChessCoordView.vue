<script setup lang="ts">
import { reactive, ref } from 'vue'
import MapPointCanvas, { type MapDef, type GameCoord } from '@/components/chess/MapPointCanvas.vue'
import coordData from '@/data/chess/chessCoord.json'

interface Section {
  id: string
  label: string
  maps: MapDef[]
  coords: Record<string, GameCoord[]>
}

const sections = coordData.sections as unknown as Section[]

// 哪些 section 展开（默认只展开日常旗子）
const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(sections.map((s) => [s.id, s.id === 'daily']))
)

// 每个 section 当前选中的地图
const currentMap = reactive<Record<string, string>>(
  Object.fromEntries(sections.map((s) => [s.id, s.maps[0]?.id ?? '']))
)

// 复制 toast
const toast = ref<string | null>(null)
let toastTimer: number | null = null

const copy = async (p: GameCoord) => {
  const text = `x: ${p.x}, y: ${p.y}`
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // fallback：旧浏览器或非 https
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  toast.value = `已复制 ${p.name} (${p.x}, ${p.y})`
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 1800)
}

const toggleSection = (id: string) => {
  expanded[id] = !expanded[id]
}
</script>

<template>
  <div class="chess-page">
    <header class="page-header">
      <h1>🚩 定旗狂魔</h1>
      <p class="subtitle">日常旗子 / 师徒 / 跑环 / 神器等 11 类常用坐标 · 361 个点</p>
    </header>

    <div v-for="sec in sections" :key="sec.id" class="section">
      <button class="section-header" @click="toggleSection(sec.id)">
        <span class="section-title">{{ sec.label }}</span>
        <span class="section-meta">{{ sec.maps.length }} 张地图 · {{ Object.values(sec.coords).reduce((n, arr) => n + arr.length, 0) }} 个点</span>
        <span class="chevron" :class="{ expanded: expanded[sec.id] }">▸</span>
      </button>

      <div v-show="expanded[sec.id]" class="section-body">
        <div class="map-tabs">
          <button
            v-for="m in sec.maps"
            :key="m.id"
            class="map-tab"
            :class="{ active: currentMap[sec.id] === m.id }"
            @click="currentMap[sec.id] = m.id"
          >
            {{ m.name }}
          </button>
        </div>

        <div class="content-layout">
          <div class="coords-list">
            <div class="list-header">坐标列表</div>
            <div v-if="(sec.coords[currentMap[sec.id]] || []).length === 0" class="empty">
              该地图暂无坐标
            </div>
            <div
              v-for="(p, i) in sec.coords[currentMap[sec.id]] || []"
              :key="`${currentMap[sec.id]}_${i}`"
              class="coord-item"
            >
              <span class="location-name">{{ p.name }}</span>
              <div class="coord-right">
                <span class="coord-text">x: {{ p.x }}, y: {{ p.y }}</span>
                <button class="copy-btn" :title="`复制 ${p.name} 坐标`" @click="copy(p)">
                  复制
                </button>
              </div>
            </div>
          </div>

          <div class="map-display">
            <MapPointCanvas
              v-if="sec.maps.find((m) => m.id === currentMap[sec.id])"
              :map="sec.maps.find((m) => m.id === currentMap[sec.id])!"
              :points="sec.coords[currentMap[sec.id]] || []"
            />
          </div>
        </div>
      </div>
    </div>

    <Transition name="toast">
      <div v-if="toast" class="copy-toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.chess-page {
  /* 固定宽度：不随展开的 section 内容变化，保证展开/折叠时文字位置恒定。
     父级 .main 为 flex column，auto margin 会居中——固定 width 后居中位置才是稳定的 */
  width: 1024px;
  max-width: 100%;
  margin: 0 auto;
  padding: 20px 16px 80px;
  color: var(--color-text);
  font-family: var(--font-mono);
}

.page-header {
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}
.page-header h1 {
  font-size: 24px;
  font-weight: 500;
  color: var(--color-primary);
  margin: 0 0 8px;
}
.subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
}

.section {
  margin-bottom: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.section-header {
  width: 100%;
  display: grid;
  grid-template-columns: 96px 1fr 20px;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  background: transparent;
  border: 0;
  color: var(--color-text);
  font-family: inherit;
  font-size: 16px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.section-header:hover {
  background: rgba(0, 229, 255, 0.04);
}
.section-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--color-primary);
}
.section-meta {
  font-size: 13px;
  color: var(--color-text-muted);
}
.chevron {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1;
  transition: transform 0.2s;
}
.chevron.expanded {
  transform: rotate(90deg);
}

.section-body {
  padding: 14px 16px 18px;
}

.map-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.map-tab {
  padding: 6px 16px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.map-tab:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.map-tab.active {
  background: var(--color-primary);
  color: var(--bg-dark);
  border-color: var(--color-primary);
}

.content-layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 18px;
  align-items: start;
}
@media (max-width: 1024px) {
  .content-layout {
    grid-template-columns: 1fr;
  }
}

.coords-list {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px;
  max-height: 500px;
  overflow-y: auto;
}
.list-header {
  font-size: 13px;
  color: var(--color-text-muted);
  padding: 4px 8px 10px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}
.coord-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 14px;
  transition: background 0.1s;
}
.coord-item:hover {
  background: rgba(0, 229, 255, 0.06);
}
.location-name {
  color: var(--color-text);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.coord-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.coord-text {
  color: var(--color-text-muted);
  font-size: 13px;
  font-family: var(--font-mono);
  white-space: nowrap;
}
.copy-btn {
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--color-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.copy-btn:hover {
  background: var(--color-primary);
  color: var(--bg-dark);
}
.empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 24px 0;
  font-size: 13px;
}

.map-display {
  text-align: left;
}

.copy-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 229, 255, 0.95);
  color: var(--bg-dark);
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-family: var(--font-mono);
  box-shadow: 0 4px 16px rgba(0, 229, 255, 0.4);
  z-index: 9999;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
