<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useFishingStore } from '@/stores/fishingStore'

const store = useFishingStore()

const imgRef = ref<HTMLImageElement | null>(null)
const naturalW = ref(0)
const naturalH = ref(0)

const dragMode = ref<'none' | 'new' | 'move' | 'resize'>('none')
const dragStart = ref({ x: 0, y: 0 })
const dragOrig = ref({ x: 0, y: 0, width: 0, height: 0 })

function toNatural(clientX: number, clientY: number) {
  const rect = imgRef.value!.getBoundingClientRect()
  const s = naturalW.value / rect.width
  return {
    x: (clientX - rect.left) * s,
    y: (clientY - rect.top) * s
  }
}

function onImgLoad() {
  if (imgRef.value) {
    naturalW.value = imgRef.value.naturalWidth
    naturalH.value = imgRef.value.naturalHeight
  }
}

function displayRoi() {
  const r = store.roi
  if (!r || !imgRef.value || !naturalW.value) return null
  const s = imgRef.value.clientWidth / naturalW.value
  return { x: r.x * s, y: r.y * s, width: r.width * s, height: r.height * s }
}

function pointerDownDraw(e: PointerEvent) {
  if (!store.isSharing) return
  const p = toNatural(e.clientX, e.clientY)
  dragMode.value = 'new'
  dragStart.value = p
  store.setRoi({ x: p.x, y: p.y, width: 0, height: 0 })
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function pointerDownMove(e: PointerEvent) {
  if (!store.roi) return
  e.stopPropagation()
  dragMode.value = 'move'
  dragStart.value = toNatural(e.clientX, e.clientY)
  dragOrig.value = { ...store.roi }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function pointerDownResize(e: PointerEvent) {
  if (!store.roi) return
  e.stopPropagation()
  dragMode.value = 'resize'
  dragStart.value = toNatural(e.clientX, e.clientY)
  dragOrig.value = { ...store.roi }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function pointerMove(e: PointerEvent) {
  if (dragMode.value === 'none' || !store.roi) return
  const p = toNatural(e.clientX, e.clientY)
  const o = dragOrig.value
  if (dragMode.value === 'new') {
    store.setRoi({
      x: Math.min(dragStart.value.x, p.x),
      y: Math.min(dragStart.value.y, p.y),
      width: Math.abs(p.x - dragStart.value.x),
      height: Math.abs(p.y - dragStart.value.y)
    })
  } else if (dragMode.value === 'move') {
    store.setRoi({
      x: Math.max(0, o.x + (p.x - dragStart.value.x)),
      y: Math.max(0, o.y + (p.y - dragStart.value.y)),
      width: o.width,
      height: o.height
    })
  } else if (dragMode.value === 'resize') {
    store.setRoi({
      x: o.x,
      y: o.y,
      width: Math.max(20, p.x - o.x),
      height: Math.max(20, p.y - o.y)
    })
  }
}
function pointerUp(e: PointerEvent) {
  dragMode.value = 'none'
  try {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* noop */
  }
}

const slotOrder = ['力度', '角度', '速度'] as const

onUnmounted(() => store.stopShare())
</script>

<template>
  <div class="fishing-view">
    <header class="fv-head">
      <h2>🐟 金牌钓手</h2>
      <div class="fv-places">
        <button
          v-for="p in store.places"
          :key="p"
          :class="['place-tab', { active: store.place === p }]"
          @click="store.setPlace(p)"
        >
          {{ p }}
        </button>
      </div>
    </header>

    <div class="fv-body">
      <!-- 左：预览 + ROI -->
      <section class="fv-preview">
        <div class="pv-toolbar">
          <button v-if="!store.isSharing" class="btn primary" @click="store.startShare()">🖥 开启屏幕共享</button>
          <button v-else class="btn danger" @click="store.stopShare()">■ 停止共享</button>
          <button
            v-if="store.isSharing"
            :class="['btn', store.isMonitoring ? 'danger' : 'primary']"
            :disabled="!store.ocrReady"
            @click="store.isMonitoring ? store.stopMonitor() : store.startMonitor()"
          >
            {{ store.isMonitoring ? '⏸ 暂停监控' : '▶ 开始监控' }}
          </button>
          <label class="audio-toggle">
            <input type="checkbox" :checked="store.audioEnabled" @change="store.toggleAudio()" /> 提示音
          </label>
        </div>

        <div class="pv-stage">
          <p v-if="!store.isSharing" class="pv-hint">
            点击「开启屏幕共享」后，在预览画面上 <b>拖拽框选钓鱼聊天区域</b>（显示事件提示的那一块），然后开始监控。
          </p>
          <div v-else class="pv-imgwrap">
            <img
              v-if="store.previewFrame"
              ref="imgRef"
              :src="store.previewFrame"
              class="pv-img"
              @load="onImgLoad"
              @pointerdown="pointerDownDraw"
              @pointermove="pointerMove"
              @pointerup="pointerUp"
            />
            <div
              v-if="displayRoi()"
              class="pv-roi"
              :style="{ left: displayRoi()!.x + 'px', top: displayRoi()!.y + 'px', width: displayRoi()!.width + 'px', height: displayRoi()!.height + 'px' }"
              @pointerdown="pointerDownMove"
              @pointermove="pointerMove"
              @pointerup="pointerUp"
            >
              <span class="pv-roi-label">钓鱼区域</span>
              <span class="pv-roi-handle" @pointerdown="pointerDownResize" @pointermove="pointerMove" @pointerup="pointerUp"></span>
            </div>
          </div>
        </div>

        <div class="pv-status">
          状态：{{ store.status }}
          <span v-if="store.ocrLoading" class="tag">模型加载中…</span>
          <span v-if="store.ocrError" class="tag err">{{ store.ocrError }}</span>
        </div>

        <div class="pv-interval">
          <label>识别间隔 {{ store.interval }}ms</label>
          <input type="range" min="200" max="2000" step="100" :value="store.interval" @input="store.setIntervalMs(+($event.target as HTMLInputElement).value)" />
        </div>
      </section>

      <!-- 右：识别结果 -->
      <section class="fv-result">
        <div class="res-card">
          <h3>当前最佳</h3>
          <div v-if="store.result?.best" class="res-best" :class="{ rare: store.result.best.rare }">
            {{ store.result.best.fish }}
            <span v-if="store.result.best.rare" class="rare-badge">稀有</span>
          </div>
          <div v-else class="res-best muted">—</div>
          <div v-if="store.result?.determined" class="res-determined">✓ 已唯一确定</div>
        </div>

        <div class="res-card">
          <h3>槽位锁定（提前给）</h3>
          <div class="slots">
            <div v-for="s in slotOrder" :key="s" class="slot">
              <span class="slot-name">{{ s }}</span>
              <span class="slot-val" :class="{ locked: store.result?.lockedSlots[s] }">
                {{ store.result?.lockedSlots[s] || '待定' }}
              </span>
            </div>
          </div>
        </div>

        <div class="res-card">
          <h3>候选鱼种</h3>
          <ul class="cands">
            <li v-for="c in store.result?.candidates || []" :key="c.fish">
              <span :class="{ rare: c.rare }">{{ c.fish }}{{ c.rare ? ' ⭐' : '' }}</span>
              <span class="cand-action">{{ c.action.join(' / ') }}</span>
              <span class="cand-score">匹配 {{ c.score }}</span>
            </li>
          </ul>
        </div>

        <div class="res-card">
          <h3>事件流（去重累积）</h3>
          <ol class="events">
            <li v-for="(e, i) in store.observed" :key="i">{{ e }}</li>
          </ol>
          <button class="btn ghost" @click="store.resetRound()">↺ 重置本轮</button>
        </div>

        <div class="res-card">
          <h3>收获记录（{{ store.history.length }}）</h3>
          <ul class="history">
            <li v-for="(h, i) in store.history" :key="i">
              <span :class="{ rare: h.rare }">{{ h.fish }}</span>
              <span class="hist-action">{{ h.action.join(' / ') }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.fishing-view { padding: 16px 20px; color: var(--color-text); max-width: 1200px; margin: 0 auto; }
.fv-head { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
.fv-head h2 { font-size: 18px; color: var(--color-primary); }
.fv-places { display: flex; gap: 8px; }
.place-tab { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--color-text-muted); padding: 5px 12px; border-radius: 6px; cursor: pointer; }
.place-tab.active { color: #fff; background: var(--color-primary); border-color: var(--color-primary); }
.fv-body { display: grid; grid-template-columns: 1fr 360px; gap: 16px; }
@media (max-width: 900px) { .fv-body { grid-template-columns: 1fr; } }

.fv-preview { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; }
.pv-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--color-text); cursor: pointer; }
.btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.btn.danger { background: #e0533d; color: #fff; border-color: #e0533d; }
.btn.ghost { background: transparent; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.audio-toggle { font-size: 13px; color: var(--color-text-muted); display: flex; align-items: center; gap: 4px; }

.pv-stage { position: relative; min-height: 220px; background: #000; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.pv-hint { color: var(--color-text-muted); font-size: 13px; padding: 24px; line-height: 1.7; text-align: center; }
.pv-imgwrap { position: relative; width: 100%; }
.pv-img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; touch-action: none; }
.pv-roi { position: absolute; border: 2px solid #f5c518; box-shadow: 0 0 0 9999px rgba(0,0,0,0.35); cursor: move; }
.pv-roi-label { position: absolute; top: -18px; left: 0; font-size: 11px; color: #f5c518; background: rgba(0,0,0,0.6); padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
.pv-roi-handle { position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px; background: #f5c518; border-radius: 3px; cursor: nwse-resize; }

.pv-status { font-size: 12px; color: var(--color-text-muted); margin-top: 10px; }
.tag { margin-left: 8px; padding: 1px 6px; border-radius: 4px; background: rgba(245,197,24,0.15); color: #f5c518; }
.tag.err { background: rgba(224,83,61,0.15); color: #ff7a66; }
.pv-interval { margin-top: 10px; font-size: 12px; color: var(--color-text-muted); }
.pv-interval input { width: 100%; margin-top: 4px; }

.fv-result { display: flex; flex-direction: column; gap: 12px; }
.res-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; }
.res-card h3 { font-size: 13px; color: var(--color-secondary); margin-bottom: 8px; }
.res-best { font-size: 18px; font-weight: 600; color: var(--color-primary); }
.res-best.muted { color: var(--color-text-muted); font-weight: 400; }
.res-best.rare { color: #ffce4f; }
.rare-badge { font-size: 11px; background: #ffce4f; color: #000; padding: 1px 5px; border-radius: 4px; margin-left: 6px; }
.res-determined { font-size: 12px; color: #34c759; margin-top: 4px; }
.slots { display: flex; flex-direction: column; gap: 6px; }
.slot { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.slot-name { width: 44px; color: var(--color-text-muted); }
.slot-val { padding: 2px 10px; border-radius: 6px; background: var(--bg-input); color: var(--color-text-muted); }
.slot-val.locked { background: rgba(52,199,89,0.18); color: #34c759; font-weight: 600; }
.cands, .history, .events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
.cands li, .history li { display: flex; justify-content: space-between; gap: 6px; }
.cand-action, .hist-action { color: var(--color-text-muted); font-size: 12px; }
.cand-score { color: var(--color-text-muted); font-size: 11px; }
.events { list-style: decimal; padding-left: 18px; max-height: 160px; overflow: auto; }
.events li { font-size: 12px; color: var(--color-text); }
.rare { color: #ffce4f; }
</style>
