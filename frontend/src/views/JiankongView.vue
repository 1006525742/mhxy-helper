<script setup lang="ts">
/**
 * 通用监控页面（复刻 mhxyai.com/v2/jiankong1）
 * 屏幕共享 → 预览 + 拖拽框选（可移动/四角缩放）→ 按频率抓帧比对像素 → 变化超阈值播放预警音
 * 视觉对齐原站「暖金古韵」主题（浅色米金）。
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { ScreenCapture } from '@/services/screenCapture'
import { MonitorEngine, type MonitorRegion } from '@/services/jiankongLogic'
import RegionPicker from '@/components/jiankong/RegionPicker.vue'
import { useJiankongStore } from '@/stores/jiankongStore'

const store = useJiankongStore()
const sc = new ScreenCapture()
const regionPickerRef = ref<InstanceType<typeof RegionPicker> | null>(null)
const previewSrc = ref('')

let engine: MonitorEngine | null = null
let previewTimer: number | null = null

/* ---------- 预览循环（节流 ~8fps，避免每帧 toDataURL 卡顿） ---------- */
function startPreviewLoop() {
  previewTimer = window.setInterval(() => {
    if (!sc.isActive()) return
    const f = sc.getPreviewFrame()
    if (f) previewSrc.value = f
  }, 120)
}
function stopPreviewLoop() {
  if (previewTimer !== null) {
    clearInterval(previewTimer)
    previewTimer = null
  }
}

/* ---------- 屏幕共享 ---------- */
async function startShare() {
  const ok = await sc.start()
  if (ok) {
    store.setSharing(true)
    startPreviewLoop()
    store.setStatus('游戏窗口共享成功，已显示选区框（可拖动/调整大小），请点击「开始监控」启动画面检测', '#2c8a3a')
  } else {
    store.setStatus('屏幕共享失败（需 HTTPS / localhost 且浏览器支持 getDisplayMedia）', '#c0392b')
  }
}
function stopShare() {
  stopMonitor()
  stopPreviewLoop()
  sc.stop()
  store.setSharing(false)
  previewSrc.value = ''
  store.setStatus('共享已停止', '#6b5744')
}

/* ---------- 把相对比例换算成视频实际分辨率坐标 ---------- */
function buildRegion(): MonitorRegion | null {
  const size = sc.getVideoSize()
  const r = regionPickerRef.value?.getRegionRatio()
  if (!size || !r) return null
  if (r.w < 0.02 || r.h < 0.02) return null
  return {
    x: Math.floor(r.x * size.width),
    y: Math.floor(r.y * size.height),
    width: Math.floor(r.w * size.width),
    height: Math.floor(r.h * size.height)
  }
}

/* ---------- 监控控制 ---------- */
function startMonitor() {
  if (!sc.isActive()) {
    store.setStatus('请先开始屏幕共享', '#c0392b')
    return
  }
  const region = buildRegion()
  if (!region) {
    store.setStatus('请先通过红色框框选监控区域', '#c0392b')
    return
  }
  engine = new MonitorEngine(sc, store.config, {
    onRate: (ratePct) => store.setLastRate(ratePct),
    onAlert: (ratePct) => {
      store.incAlert()
      store.setStatus(`检测到画面变化（变化率 ${ratePct.toFixed(2)}%），正在播放预警音效`, '#d9842b')
    },
    onIdleAlert: () => {
      store.incAlert()
      store.setStatus('检测到画面长时间静止，正在播放预警音效', '#d9842b')
    },
    onError: (msg) => store.setStatus(msg, '#c0392b'),
    onStop: () => store.setMonitoring(false)
  })
  engine.start(region)
  store.setMonitoring(true)
  const offline = store.config.offlineDetect ? '（已开启离线检测）' : ''
  store.setStatus(`已启动画面变化监控，选区有变化时会播放预警音效${offline}`, '#2c8a3a')
}

function stopMonitor() {
  if (engine) {
    engine.stop()
    engine = null
  }
  store.setMonitoring(false)
  store.setStatus('已停止画面变化监控，选区变化将不再触发预警', '#6b5744')
}

/* 运行中修改频率：重启引擎以应用新间隔 */
watch(
  () => store.config.intervalSec,
  () => {
    if (engine?.isRunning()) {
      const region = buildRegion()
      if (region) {
        engine.stop()
        engine.start(region)
      }
    }
  }
)

/* 标签页重新可见时立即补一帧，缓解后台节流漏检 */
function onVisible() {
  if (!document.hidden && store.isMonitoring) engine?.poke()
}
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
  stopMonitor()
  stopPreviewLoop()
  sc.stop()
})
</script>

<template>
  <div class="jiankong1-page">
    <header class="jk-header">
      <h1>🔔 通用监控</h1>
      <p class="jk-desc">这是个通用功能，用来检测框选的游戏界面区域是否变化，播放语音提示</p>
      <p class="jk-warn">⚠️ 不能最小化运行！可用来监视刷妖、宝宝乐园、摆摊卖空等等</p>
    </header>

    <div class="jk-main">
      <!-- 左：画面 + 选框 -->
      <div class="jk-left">
        <div class="game-video-container">
          <RegionPicker :preview-src="previewSrc" ref="regionPickerRef" />
        </div>
        <p class="jk-hint">拖动红色框选择监视区域；框内可整体移动，四角手柄可调整大小。</p>
      </div>

      <!-- 右：控制面板 -->
      <aside class="jk-right param-setting">
        <h3>🎛 监控设置</h3>

        <div class="param-item">
          <label>变化阈值 (%)</label>
          <input type="number" v-model.number="store.config.threshold" min="0" max="100" step="1" />
        </div>
        <div class="param-item">
          <label>播放次数</label>
          <input type="number" v-model.number="store.config.playTimes" min="1" max="10" step="1" />
        </div>
        <div class="param-item">
          <label>监控频率 (秒)</label>
          <input type="number" v-model.number="store.config.intervalSec" min="1" max="10" step="1" />
        </div>
        <div class="param-item">
          <label>预警音效</label>
          <select v-model="store.config.soundType">
            <option value="beep">🔔 蜂鸣提醒</option>
            <option value="tts">🔊 语音提醒</option>
            <option value="both">🔔+🔊 蜂鸣+语音</option>
          </select>
        </div>
        <div class="param-item param-col" v-if="store.config.soundType !== 'beep'">
          <label>预警语音内容</label>
          <input type="text" v-model="store.config.ttsText" placeholder="例如：摊位卖空了、怪来了" maxlength="30" />
        </div>
        <p class="ctrl-hint" v-if="store.config.soundType !== 'beep'">语音提醒依赖浏览器中文语音合成，首次可能需联网加载语音包</p>

        <div class="param-item">
          <label>开启离线检测</label>
          <input type="checkbox" v-model="store.config.offlineDetect" class="switch" />
        </div>

        <div class="btn-group">
          <button v-if="!store.isSharing" class="btn btn-primary" @click="startShare">▶ 开始屏幕共享</button>
          <template v-else>
            <button v-if="!store.isMonitoring" class="btn btn-success" @click="startMonitor">▶ 开始监控</button>
            <button v-else class="btn btn-danger" @click="stopMonitor">⏸ 停止监控</button>
            <button class="btn btn-ghost" @click="stopShare">⏹ 停止共享</button>
          </template>
        </div>

        <div class="status-box">
          <div class="status-tip" :style="{ color: store.statusColor }">{{ store.statusText }}</div>
        </div>

        <div class="rate" v-if="store.isMonitoring">
          当前变化率：<b>{{ store.lastRate.toFixed(2) }}%</b> · 累计报警 <b>{{ store.alertCount }}</b> 次
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.jiankong1-page {
  /* 暖金古韵主题（对齐原站 mhxyai.com 主题变量） */
  --site-primary: #b8860b;
  --site-primary-hover: #96700a;
  --site-bg: #f0ebe1;
  --site-surface: #fffdf7;
  --site-surface-alt: #f5ede0;
  --site-text: #2c1810;
  --site-text-secondary: #5c4033;
  --site-text-muted: #6b5744;
  --site-border: rgba(180, 150, 100, 0.4);
  --site-border-light: rgba(180, 150, 100, 0.28);
  --site-panel-bg: linear-gradient(165deg, #fdf8ef 0%, #f5ede0 42%, #ede6d8 100%);
  --site-panel-shadow: rgba(100, 70, 20, 0.14);

  max-width: 1400px;
  margin: 0 auto;
  padding: 22px;
  color: var(--site-text);
  background: var(--site-bg);
  min-height: 100vh;
  font-family: 'Microsoft Yahei', Inter, system-ui, -apple-system, 'PingFang SC', sans-serif;
  box-sizing: border-box;
}
.jiankong1-page * {
  box-sizing: border-box;
}

.jk-header {
  margin-bottom: 18px;
}
.jk-header h1 {
  font-size: 22px;
  color: var(--site-primary);
  font-weight: 700;
  margin: 0 0 8px;
}
.jk-desc {
  font-size: 14px;
  color: var(--site-text-secondary);
  margin: 0 0 6px;
  line-height: 1.6;
}
.jk-warn {
  font-size: 13px;
  color: #c0392b;
  margin: 0;
  font-weight: 600;
}

.jk-main {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.jk-left {
  flex: 1;
  min-width: 0;
}
.game-video-container {
  border-radius: 12px;
  overflow: hidden;
}
.jk-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--site-text-muted);
  line-height: 1.6;
}

.jk-right {
  width: 320px;
  flex-shrink: 0;
  background: var(--site-panel-bg);
  border: 1px solid rgba(180, 130, 50, 0.14);
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 8px 24px var(--site-panel-shadow);
}
.jk-right h3 {
  color: var(--site-primary);
  font-size: 16px;
  margin: 0 0 16px;
}

.param-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}
.param-item label {
  font-size: 13px;
  color: var(--site-text-secondary);
  white-space: nowrap;
}
.param-item input[type='number'],
.param-item select {
  flex: 1;
  max-width: 160px;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  color: var(--site-text);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.param-item input[type='number']:focus,
.param-item select:focus {
  outline: none;
  border-color: var(--site-primary);
}
.param-col {
  flex-direction: column;
  align-items: stretch;
}
.param-col label {
  margin-bottom: 6px;
}
.param-col input {
  max-width: none;
  width: 100%;
}
.ctrl-hint {
  font-size: 11px;
  color: var(--site-text-muted);
  margin: -6px 0 14px;
  line-height: 1.4;
}

.switch {
  width: 18px;
  height: 18px;
  accent-color: var(--site-primary);
}

.btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}
.btn-primary {
  background: var(--site-primary);
  color: #fff;
}
.btn-primary:hover {
  background: var(--site-primary-hover);
}
.btn-success {
  background: linear-gradient(135deg, #c49b2a, #b8860b);
  color: #fff;
}
.btn-success:hover {
  filter: brightness(0.95);
}
.btn-danger {
  background: #c0392b;
  color: #fff;
}
.btn-danger:hover {
  background: #a93226;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--site-border);
  color: var(--site-text-secondary);
}
.btn-ghost:hover {
  color: var(--site-text);
  border-color: var(--site-text-muted);
}

.status-box {
  margin-top: 14px;
  background: var(--site-surface);
  border: 1px solid var(--site-border-light);
  border-radius: 8px;
  padding: 10px 12px;
}
.status-tip {
  font-size: 13px;
  line-height: 1.5;
}
.rate {
  margin-top: 10px;
  font-size: 13px;
  color: var(--site-text-muted);
}

@media (max-width: 860px) {
  .jk-main {
    flex-direction: column;
  }
  .jk-right {
    width: 100%;
  }
}
</style>
