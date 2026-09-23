<template>
  <div class="ps-page">
    <div class="ps-head">
      <h1 class="ps-title">跑商助手</h1>
      <p class="ps-sub">商品每 10 分钟刷新一次，自动记录各地价格与涨跌</p>
    </div>

    <!-- 倒计时 -->
    <div class="ps-timers">
      <div class="timer-item">
        <span class="timer-k">距离一刷</span>
        <span class="timer-v">{{ firstLeft }}</span>
      </div>
      <div class="timer-item">
        <span class="timer-k">距离二刷</span>
        <span class="timer-v accent">{{ secondLeft }}</span>
      </div>
      <div class="timer-item">
        <span class="timer-k">跑商用时</span>
        <span class="timer-v">{{ durationText }}</span>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="ps-panel">
      <div class="ps-toolbar">
        <button class="btn" @click="toggleTimer">{{ clockRunning ? '停止计时' : '开始计时' }}</button>
        <button class="btn" @click="clearRows">清空表格</button>
        <button class="btn" :class="{ 'btn-on': showBoxes }" @click="showBoxes = !showBoxes">
          {{ showBoxes ? '隐藏检测框' : '显示检测框' }}
        </button>

        <div class="tb-group">
          <span class="tb-label">二刷设置</span>
          <input v-model.number="ershuaMin" class="num-input" type="number" min="0" max="9" @change="saveErshuaCfg" />
          <span class="tb-unit">分</span>
          <input v-model.number="ershuaSec" class="num-input" type="number" min="0" max="59" @change="saveErshuaCfg" />
          <span class="tb-unit">秒</span>
        </div>

        <div class="tb-group seg">
          <button class="seg-btn" :class="{ on: order === 'asc' }" @click="setOrder('asc')">正序排</button>
          <button class="seg-btn" :class="{ on: order === 'desc' }" @click="setOrder('desc')">倒序排</button>
        </div>
      </div>

      <div class="ps-status">
        <span class="st-item">
          <i class="dot" :class="modelReady ? 'ok' : 'wait'"></i>
          模型 {{ modelReady ? '已就绪' : modelStatus }}
        </span>
        <span class="st-item" v-if="!modelReady && modelProgress > 0 && modelProgress < 1">
          <span class="prog">
            <span class="prog-bar" :style="{ width: Math.round(modelProgress * 100) + '%' }"></span>
          </span>
          {{ Math.round(modelProgress * 100) }}%
        </span>
        <span class="st-item">检测 {{ detectStateText }}</span>
        <span class="st-item" v-if="lastHit">最近 {{ lastHit }}</span>
        <span class="st-item warn" v-if="!sharing">点击页面左侧竖条「开始跑商监控」选择游戏窗口</span>
      </div>
    </div>

    <div class="ps-body">
      <!-- 价格表 -->
      <div class="ps-main">
        <table class="ps-table">
          <thead>
            <tr>
              <th class="c-time">时间</th>
              <th class="c-loc">地点</th>
              <th>商品1</th>
              <th>商品2</th>
              <th>商品3</th>
              <th>商品4</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="rows.length === 0">
              <td colspan="6" class="empty">暂无记录。开启屏幕共享后打开游戏商人界面，会自动识别并记录各地价格。</td>
            </tr>
            <tr v-for="(row, i) in rows" :key="row.time + row.location + i">
              <td class="c-time">
                <span class="del" title="删除此行" @click="removeRow(i)">×</span>
                <span>{{ row.time }}</span>
              </td>
              <td class="c-loc">{{ row.location }}</td>
              <td v-for="(g, gi) in row.goods" :key="gi">
                <template v-if="g.name">
                  <div class="g-name">
                    <GoodsIcon :name="g.name" :size="30" />
                    <span class="g-text">{{ g.name }}</span>
                  </div>
                  <div class="g-price">
                    {{ g.price }}
                    <span class="g-rate" :class="rateClass(g.rate)">
                      {{ g.rate >= 0 ? '+' : '' }}{{ g.rate }}%
                    </span>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 路线参考 -->
        <div class="ps-routes">
          <span class="r-title">路线耗时</span>
          <span v-for="r in routeList" :key="r.label" class="r-item">{{ r.label }}</span>
        </div>
      </div>

      <!-- 侧栏：商品图标（按地图/商人所在地分组） -->
      <aside class="ps-side">
        <div class="side-block">
          <div class="side-title">
            商品图标
            <span class="icon-count" :class="{ ok: iconMissing.length === 0 }">
              {{ iconReady }}/{{ iconTotal }}
            </span>
            <button class="btn btn-mini" @click="checkIcons">重新检测</button>
          </div>

          <div v-for="grp in iconGroups" :key="grp.addr" class="icon-group">
            <div class="ig-head">
              <span class="ig-addr">{{ grp.addr }}</span>
              <span class="ig-meta" :class="{ ok: grp.missing === 0 }">
                {{ grp.items.length - grp.missing }}/{{ grp.items.length }}
              </span>
            </div>
            <div class="icon-grid">
              <div
                v-for="g in grp.items"
                :key="g"
                class="icon-cell"
                :class="{ miss: iconMissing.includes(g) }"
                :title="iconMissing.includes(g) ? '缺图：' + g + '.png' : g + '（' + grp.addr + '）'"
              >
                <GoodsIcon :name="g" :size="40" />
                <span class="icon-name">{{ g }}</span>
              </div>
            </div>
          </div>

          <p class="side-hint">
            缺失的显示为 emoji 占位。把图片按「商品名.png」放进
            <code>frontend/public/static/icons/paoshang/</code> 即自动生效。
          </p>
        </div>
      </aside>
    </div>

    <!-- 屏幕共享：侧边竖条 + 浮窗预览（与抓鬼助手同一套组件） -->
    <ScreenShare
      ref="screenShareRef"
      label="跑商监控"
      @started="onShareStarted"
      @stopped="onShareStopped"
      @error="onShareError"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { detectPaoshang, loadPaoshangModel } from '@/services/paoshangYolo'
import { recognizePrice } from '@/services/paoshangOcr'
import GoodsIcon from '@/components/paoshang/GoodsIcon.vue'
import ScreenShare from '@/components/common/ScreenShare.vue'
import {
  GOODS,
  LOCATIONS,
  PAOSHANG_MODEL,
  ROUTES,
  type GoodsCell,
  type PriceRow,
  type SortOrder,
  calcRate,
  emptyCell,
  fixGoodsName,
  goodsIconSrc,
  formatClock,
  formatCountdown,
  formatDuration,
  formatRouteSeconds,
  loadErshua,
  loadOrder,
  loadRows,
  nextFirstRefresh,
  nextSecondRefresh,
  priceInRange,
  priceMatchesBase,
  rateColor,
  saveErshua,
  saveOrder,
  saveRows
} from '@/services/paoshangLogic'

// ---------- 倒计时 ----------
const firstLeft = ref('00分00秒')
const secondLeft = ref('00分00秒')
const ershuaMin = ref(0)
const ershuaSec = ref(10)
let tickTimer: number | null = null

function tick(): void {
  firstLeft.value = formatCountdown(nextFirstRefresh())
  secondLeft.value = formatCountdown(nextSecondRefresh(ershuaMin.value, ershuaSec.value))
  // 超过 4 秒没有新识别，则下一次识别另起一行
  if (!allowNewRow.value && Date.now() - lastHitAt.value > 4000) {
    allowNewRow.value = true
  }
}

function saveErshuaCfg(): void {
  ershuaMin.value = Math.max(0, Math.min(9, ershuaMin.value || 0))
  ershuaSec.value = Math.max(0, Math.min(59, ershuaSec.value || 0))
  saveErshua(ershuaMin.value, ershuaSec.value)
  tick()
}

// ---------- 跑商用时 ----------
const durationText = ref('00:00:00')
const clockRunning = ref(false)
let elapsed = 0
let clockTimer: number | null = null

function toggleTimer(): void {
  if (clockRunning.value) {
    if (clockTimer) clearInterval(clockTimer)
    clockTimer = null
    clockRunning.value = false
  } else {
    elapsed = 0
    durationText.value = formatDuration(0)
    clockRunning.value = true
    clockTimer = window.setInterval(() => {
      elapsed += 1
      durationText.value = formatDuration(elapsed)
    }, 1000)
  }
}

// ---------- 表格 ----------
const rows = ref<PriceRow[]>(loadRows())
const order = ref<SortOrder>(loadOrder())

function setOrder(v: SortOrder): void {
  order.value = v
  saveOrder(v)
}

function persist(): void {
  saveRows(rows.value)
}

function removeRow(i: number): void {
  rows.value.splice(i, 1)
  persist()
}

function clearRows(): void {
  rows.value = []
  persist()
}

// ---------- 当前识别中的一屏 ----------
interface CurrentScreen {
  time: Date | null
  addr: string
  gd1: GoodsCell
  gd2: GoodsCell
  gd3: GoodsCell
  gd4: GoodsCell
}

function emptyScreen(): CurrentScreen {
  return {
    time: null,
    addr: '',
    gd1: emptyCell(),
    gd2: emptyCell(),
    gd3: emptyCell(),
    gd4: emptyCell()
  }
}

const current = ref<CurrentScreen>(emptyScreen())
const allowNewRow = ref(true)
const lastHitAt = ref(0)

function commitRow(): void {
  const c = current.value
  if (!c.addr || !c.time) return
  const row: PriceRow = {
    time: formatClock(c.time),
    location: c.addr,
    goods: [c.gd1, c.gd2, c.gd3, c.gd4].map(g => ({ ...g }))
  }
  if (rows.value.length === 0 || allowNewRow.value) {
    if (order.value === 'desc') rows.value.unshift(row)
    else rows.value.push(row)
    allowNewRow.value = false
  } else {
    const idx = order.value === 'desc' ? 0 : rows.value.length - 1
    rows.value[idx] = row
  }
  persist()
}

// ---------- 商品图标自检 ----------
const iconMissing = ref<string[]>([])
const iconTotal = computed(() => Object.keys(GOODS).length)
const iconReady = computed(() => iconTotal.value - iconMissing.value.length)

function probeIcon(name: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
    img.src = goodsIconSrc(name) + '?t=' + Date.now()
  })
}

async function checkIcons(): Promise<void> {
  const names = Object.keys(GOODS)
  const results = await Promise.all(names.map(probeIcon))
  iconMissing.value = names.filter((_, i) => !results[i])
}

/** 按商人所在地（地图）分组，每组 4 个商品 */
const iconGroups = computed(() =>
  LOCATIONS.map(addr => {
    const items = Object.keys(GOODS).filter(n => GOODS[n].addr === addr)
    return { addr, items, missing: items.filter(n => iconMissing.value.includes(n)).length }
  }).filter(g => g.items.length > 0)
)

// ---------- 屏幕共享 + 检测 ----------
// 复用抓鬼/分图同一套 ScreenShare 组件：左侧竖条入口 + 浮窗预览，画面不占主区
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)
const showBoxes = ref(true)
const sharing = ref(false)
const modelReady = ref(false)
const modelStatus = ref('加载中')
const modelProgress = ref(0)
const modelFromCache = ref(false)
const lastHit = ref('')
const detectRunning = ref(false)

let frameCanvas: HTMLCanvasElement | null = null
let detectTimer: number | null = null
let detectInterval = 700
const detectLock = { busy: false }
const lastDetectAt = new Map<string, number>()
/** 最近一帧的检测结果，画到浮窗 overlay 上 */
let lastDets: { className: string; x1: number; y1: number; x2: number; y2: number; conf: number }[] = []
let lastGoodsClass = ''
let sameGoodsCount = 0

const detectStateText = computed(() => {
  if (!sharing.value) return '未开始'
  if (!modelReady.value) return '等待模型'
  return detectRunning.value ? '识别中' : '待命'
})

/** 竖条点击开始共享成功后：启动检测循环 */
function onShareStarted(): void {
  sharing.value = true
  frameCanvas = frameCanvas || document.createElement('canvas')
  scheduleDetect()
}

/** 共享停止（竖条 ✕ 或系统结束共享）：停掉检测循环 */
function onShareStopped(): void {
  stopDetect()
  sharing.value = false
  lastDets = []
}

function onShareError(msg: string): void {
  modelStatus.value = msg
}

function stopDetect(): void {
  if (detectTimer) {
    clearTimeout(detectTimer)
    detectTimer = null
  }
  detectRunning.value = false
}

function scheduleDetect(): void {
  if (detectTimer) clearTimeout(detectTimer)
  detectTimer = window.setTimeout(async () => {
    await detectOnce()
    if (sharing.value) scheduleDetect()
  }, detectInterval)
}

async function detectOnce(): Promise<void> {
  if (detectLock.busy || !modelReady.value) return
  const video = screenShareRef.value?.getVideoElement()
  if (!video || !video.videoWidth || !frameCanvas) return

  detectLock.busy = true
  detectRunning.value = true
  try {
    const w = video.videoWidth
    const h = video.videoHeight
    frameCanvas.width = w
    frameCanvas.height = h
    const ctx = frameCanvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)

    const dets = await detectPaoshang(imageData)
    lastDets = dets.map(d => ({
      className: d.className,
      x1: d.x1,
      y1: d.y1,
      x2: d.x2,
      y2: d.y2,
      conf: d.conf
    }))
    // 把框画到浮窗预览上，方便核对「模型认没认出来 / 框偏没偏」
    if (showBoxes.value) {
      screenShareRef.value?.drawOverlay({ detections: lastDets, anchor: null, grid: [] })
    }

    // 单价框：价格数字所在位置
    const priceBox = dets.find(d => d.className === '单价' && d.conf > 0.5)
    // 商品名框：以 2 结尾的类别
    const goodsDet = dets
      .filter(d => d.className?.endsWith('2') && d.conf > 0.5)
      .sort((a, b) => b.conf - a.conf)[0]

    if (!priceBox || !goodsDet || !goodsDet.className) {
      // 3 秒没命中就把检测频率降下来，省 CPU
      if (Date.now() - lastHitAt.value > 3000) detectInterval = 700
      return
    }

    detectInterval = 250
    await handleDetected(goodsDet.className.slice(0, -1), priceBox)
  } catch (e) {
    console.error('[paoshang] 检测异常', e)
  } finally {
    detectLock.busy = false
    detectRunning.value = false
  }
}

async function handleDetected(
  rawName: string,
  box: { x1: number; y1: number; x2: number; y2: number }
): Promise<void> {
  // 同一商品 300ms 内不重复识别
  const now = Date.now()
  if (now - (lastDetectAt.get(rawName) || 0) < 300) return

  // 同一个商品连续识别超过 3 次，说明画面没变，停手避免刷屏
  if (lastGoodsClass === rawName) {
    sameGoodsCount += 1
    if (sameGoodsCount > 3) return
  } else {
    lastGoodsClass = rawName
    sameGoodsCount = 0
  }
  lastDetectAt.set(rawName, now)

  if (!frameCanvas) return
  const price = await recognizePrice(frameCanvas, box)
  if (!priceInRange(price)) return

  // 长寿商人处「纸钱/布帽」是 OCR 常见误识，按地点纠正
  const name = fixGoodsName(current.value.addr, rawName)
  const info = GOODS[name]
  if (!info) return
  if (!priceMatchesBase(name, price)) return

  current.value[info.slot] = { name, price, rate: calcRate(name, price) }
  current.value.addr = info.addr
  current.value.time = new Date()
  lastHitAt.value = Date.now()
  lastHit.value = `${name} ${price}（${calcRate(name, price) >= 0 ? '+' : ''}${calcRate(name, price)}%）`

  commitRow()
}

// ---------- 路线 ----------
const routeList = computed(() => [
  { label: `${ROUTES[0].from}-${ROUTES[0].to} ${formatRouteSeconds(ROUTES[0].seconds)}` },
  { label: `${ROUTES[1].from}-${ROUTES[1].to} ${formatRouteSeconds(ROUTES[1].seconds)}` },
  { label: `${ROUTES[2].from}-${ROUTES[2].to} ${formatRouteSeconds(ROUTES[2].seconds)}` },
  { label: `${ROUTES[3].from}-${ROUTES[3].to} ${formatRouteSeconds(ROUTES[3].seconds)}` },
  { label: `${ROUTES[4].from}-${ROUTES[4].to} ${formatRouteSeconds(ROUTES[4].seconds)}` },
  { label: `${ROUTES[5].from}-${ROUTES[5].to} ${formatRouteSeconds(ROUTES[5].seconds)}` }
])

function rateClass(rate: number): string {
  return rateColor(rate)
}

// ---------- 生命周期 ----------
onMounted(async () => {
  const cfg = loadErshua()
  ershuaMin.value = cfg.min
  ershuaSec.value = cfg.sec
  tick()
  tickTimer = window.setInterval(tick, 1000)
  checkIcons()

  // 模型 12MB，走 TF.js + IndexedDB 缓存（与抓鬼/监控模块一致）。
  // 不再用 requestIdleCallback：页面有每秒 tick，idle 可能长时间不触发，导致一直卡在「加载中」。
  const load = async () => {
    modelStatus.value = '加载中…'
    try {
      const ok = await loadPaoshangModel(
        {
          inputSize: PAOSHANG_MODEL.inputSize,
          confidenceThreshold: PAOSHANG_MODEL.confidence
        },
        fraction => {
          modelProgress.value = fraction
          modelStatus.value = `下载模型 ${Math.round(fraction * 100)}%`
        },
        source => {
          modelFromCache.value = source === 'cache'
          if (source === 'cache') modelStatus.value = '读取浏览器缓存…'
          else modelStatus.value = '下载模型…'
        }
      )
      modelReady.value = ok
      modelProgress.value = 1
      modelStatus.value = ok ? (modelFromCache.value ? '已就绪（缓存秒开）' : '已就绪') : '加载失败'
    } catch (e) {
      console.error('[paoshang] 模型加载异常', e)
      modelReady.value = false
      modelStatus.value = '加载失败（见控制台）'
    }
  }
  setTimeout(load, 100)
})

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  if (clockTimer) clearInterval(clockTimer)
  stopDetect()
})
</script>

<style scoped>
.ps-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.ps-head {
  margin-bottom: 14px;
}

.ps-title {
  font-size: 20px;
  font-family: var(--font-pixel);
  color: var(--color-accent);
  letter-spacing: 1px;
}

.ps-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
}

/* 倒计时 */
.ps-timers {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.timer-item {
  flex: 1;
  min-width: 150px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 10px 12px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.timer-k {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
}

.timer-v {
  font-family: var(--font-pixel);
  font-size: 14px;
  color: var(--color-primary);
}

.timer-v.accent {
  color: var(--color-accent);
}

/* 工具栏 */
.ps-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 14px;
}

.ps-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.tb-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tb-label {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
  margin-right: 2px;
}

.tb-unit {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
}

.num-input {
  width: 56px;
  padding: 5px 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 13px;
}

.num-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.seg {
  border: 1px solid var(--border-color);
  border-radius: 3px;
  overflow: hidden;
}

.seg-btn {
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 12px;
  font-family: var(--font-cn);
  cursor: pointer;
}

.seg-btn.on {
  background: var(--color-primary);
  color: #06121a;
}

.ps-status {
  margin-top: 10px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
}

.st-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.st-item.warn {
  color: var(--color-warning);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.dot.ok {
  background: var(--color-success);
}

.dot.wait {
  background: var(--color-warning);
}

/* 主体 */
.ps-body {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 14px;
  align-items: start;
}

.ps-main {
  min-width: 0;
}

.ps-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  font-size: 13px;
}

.ps-table th {
  padding: 9px 8px;
  text-align: left;
  font-family: var(--font-cn);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.ps-table td {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}

.ps-table tbody tr:hover {
  background: rgba(34, 211, 238, 0.03);
}

.c-time {
  width: 108px;
  white-space: nowrap;
}

.c-loc {
  width: 56px;
}

.del {
  color: var(--color-danger);
  cursor: pointer;
  margin-right: 5px;
  font-size: 14px;
}

.empty {
  color: var(--color-text-muted);
  font-family: var(--font-cn);
  text-align: center;
  padding: 26px 12px;
}

.g-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-cn);
  font-size: 13px;
}

.g-text {
  white-space: nowrap;
}

.slot-icon {
  align-self: center;
}

.g-price {
  font-family: var(--font-mono);
  font-size: 13px;
  margin-top: 2px;
}

.g-rate {
  margin-left: 4px;
  font-size: 12px;
}

.g-rate.up {
  color: var(--color-danger);
}

.g-rate.down {
  color: var(--color-success);
}

.g-rate.flat {
  color: var(--color-text-muted);
}

/* 路线 */
.ps-routes {
  margin-top: 12px;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
}

.r-title {
  color: var(--color-primary);
}

/* 侧栏 */
.ps-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.side-block {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px;
}

.side-title {
  font-size: 12px;
  color: var(--color-primary);
  font-family: var(--font-cn);
  margin-bottom: 8px;
}

/* 按地图分组的商品图标 */
.icon-group + .icon-group {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
}

.ig-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.ig-addr {
  font-size: 12px;
  color: var(--color-text);
  font-family: var(--font-cn);
  letter-spacing: 1px;
}

.ig-addr::before {
  content: '📍';
  font-size: 10px;
  margin-right: 2px;
}

.ig-meta {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-warning);
}

.ig-meta.ok {
  color: var(--color-success);
}

.form-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.sel,
.price-input {
  padding: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--color-text);
  font-size: 12px;
  font-family: var(--font-cn);
  min-width: 0;
}

.sel {
  flex: 1;
}

.sel option {
  background: #0a0e18;
  color: var(--color-text);
}

.price-input {
  width: 82px;
  font-family: var(--font-mono);
}

.sel:focus,
.price-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.full {
  width: 100%;
  justify-content: center;
  margin-top: 4px;
}

.side-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
  line-height: 1.5;
}

.side-hint code {
  background: var(--bg-input);
  padding: 1px 4px;
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 10px;
}

.icon-count {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-warning);
}

.prog {
  display: inline-block;
  width: 70px;
  height: 4px;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 2px;
  overflow: hidden;
}

.prog-bar {
  display: block;
  height: 100%;
  background: var(--color-primary);
}

.icon-count.ok {
  color: var(--color-success);
}

/* 「显示检测框」开关激活态 */
.btn-on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(255, 255, 255, 0.05);
}

.btn-mini {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: var(--font-cn);
}

.btn-mini:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px 4px;
  margin-top: 8px;
}

.icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 5px 2px;
  border: 1px solid transparent;
  border-radius: 3px;
}

.icon-cell.miss {
  border-color: rgba(255, 180, 80, 0.35);
  background: rgba(255, 180, 80, 0.08);
}

.icon-name {
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: var(--font-cn);
  white-space: nowrap;
}

.icon-cell.miss .icon-name {
  color: rgba(255, 180, 80, 0.9);
}

@media (max-width: 900px) {
  .ps-body {
    grid-template-columns: 1fr;
  }
}
</style>
