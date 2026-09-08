<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useGhostStore } from '@/stores/ghostStore'
import ScreenShare from '@/components/common/ScreenShare.vue'
import RegionSelector from '@/components/common/RegionSelector.vue'
import CoordResult from '@/components/ghost/CoordResult.vue'
import PredictionMap from '@/components/ghost/PredictionMap.vue'
import HistoryList from '@/components/ghost/HistoryList.vue'

const store = useGhostStore()
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)

let monitorLoopId: number | null = null

/**
 * 处理区域变更
 */
function onRegionChange(region: { x: number; y: number; width: number; height: number }) {
  store.setRegion(region)
}

/**
 * 开始监控
 */
function startMonitor() {
  store.startMonitoring()
  startMonitorLoop()
}

/**
 * 停止监控
 */
function stopMonitor() {
  store.stopMonitoring()
  stopMonitorLoop()
}

/**
 * 监控循环
 */
async function startMonitorLoop() {
  const loop = async () => {
    if (!store.isMonitoring || !screenShareRef.value) {
      return
    }

    // 截取区域
    const image = screenShareRef.value.captureRegion(
      store.regionX,
      store.regionY,
      store.regionWidth,
      store.regionHeight
    )

    if (image) {
      await store.processCapture(image)
    }

    // 2fps
    monitorLoopId = window.setTimeout(loop, 500)
  }

  loop()
}

/**
 * 停止监控循环
 */
function stopMonitorLoop() {
  if (monitorLoopId) {
    window.clearTimeout(monitorLoopId)
    monitorLoopId = null
  }
}

/**
 * 手动截图一次
 */
async function captureOnce() {
  if (!screenShareRef.value) return

  const image = screenShareRef.value.captureRegion(
    store.regionX,
    store.regionY,
    store.regionWidth,
    store.regionHeight
  )

  if (image) {
    await store.processCapture(image)
  }
}

onUnmounted(() => {
  stopMonitorLoop()
})
</script>

<template>
  <div class="ghost-page">
    <!-- 左侧面板 -->
    <div class="left-panel">
      <!-- 屏幕共享 -->
      <ScreenShare ref="screenShareRef" label="抓鬼监控" />

      <!-- 截图区域设置 -->
      <RegionSelector @change="onRegionChange" />

      <!-- 控制按钮 -->
      <div class="controls card">
        <button
          class="btn btn-primary"
          @click="startMonitor"
          :disabled="!screenShareRef?.isSharing || store.isMonitoring"
        >
          🔍 开始监控
        </button>
        <button
          class="btn btn-danger"
          @click="stopMonitor"
          :disabled="!store.isMonitoring"
        >
          ⏹ 停止监控
        </button>
        <button
          class="btn btn-warning"
          @click="captureOnce"
          :disabled="!screenShareRef?.isSharing"
        >
          📸 单次截图
        </button>
      </div>

      <!-- 使用说明 -->
      <div class="card help">
        <h3>📋 使用说明</h3>
        <p>1. 点击「开始屏幕共享」选择游戏窗口</p>
        <p>2. 设置截图区域（游戏中小鬼名字显示位置）</p>
        <p>3. 点击「开始监控」自动识别坐标</p>
        <p>4. 识别成功后自动预测小鬼位置</p>
      </div>
    </div>

    <!-- 右侧结果面板 -->
    <div class="right-panel">
      <!-- 识别结果 -->
      <CoordResult
        :map-name="store.currentMap"
        :x="store.currentX"
        :y="store.currentY"
        :position-areas="store.positionAreas"
        :corner-areas="store.cornerAreas"
        :confidence="store.confidence"
      />

      <!-- 预测地图 -->
      <PredictionMap :annotated-image="store.annotatedImage" />

      <!-- 历史记录 -->
      <HistoryList :history="store.history" />
    </div>
  </div>
</template>

<style scoped>
.ghost-page {
  flex: 1;
  display: flex;
  padding: 15px;
  gap: 15px;
}

.left-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 15px;
  min-width: 400px;
}

.right-panel {
  width: 400px;
  background: var(--bg-panel);
  border-left: 2px solid var(--border-color);
  padding: 15px;
  overflow-y: auto;
}

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.help p {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 4px;
}
</style>