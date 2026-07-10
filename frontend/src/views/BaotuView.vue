<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useBaotuStore } from '@/stores/baotuStore'
import { initYOLO, runYOLO, isModelLoaded } from '@/services/onnxYolo'
import ScreenShare from '@/components/common/ScreenShare.vue'
import InventoryGrid from '@/components/baotu/InventoryGrid.vue'
import CoordList from '@/components/baotu/CoordList.vue'

const store = useBaotuStore()
const screenShareRef = ref<InstanceType<typeof ScreenShare> | null>(null)

// YOLO 模型路径（需要用户提供）
const MODEL_PATH = '/models/baotu_detect.onnx'

let monitorLoopId: number | null = null

/**
 * 加载 YOLO 模型
 */
async function loadModel() {
  store.setModelLoading(true)
  const success = await initYOLO({ modelPath: MODEL_PATH })
  store.setModelLoaded(success)
  store.setModelLoading(false)
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
    if (!store.isMonitoring || !screenShareRef.value || !isModelLoaded()) {
      return
    }

    // 截取全屏
    const image = screenShareRef.value.captureFull()
    if (!image) {
      monitorLoopId = window.setTimeout(loop, 100)
      return
    }

    // 解析 base64
    const base64Data = image.split(',')[1]
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // 创建 ImageData
    const blob = new Blob([bytes], { type: 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // YOLO 检测
    const detections = await runYOLO(imageData)
    store.setDetections(detections)

    // 10fps
    monitorLoopId = window.setTimeout(loop, 100)
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
  if (!screenShareRef.value || !isModelLoaded()) return

  const image = screenShareRef.value.captureFull()
  if (!image) return

  // 同上解析和检测
  const base64Data = image.split(',')[1]
  const binaryString = atob(base64Data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  const blob = new Blob([bytes], { type: 'image/jpeg' })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const detections = await runYOLO(imageData)
  store.setDetections(detections)
}

onMounted(() => {
  // 可选：自动加载模型
  // loadModel()
})

onUnmounted(() => {
  stopMonitorLoop()
})
</script>

<template>
  <div class="baotu-page">
    <!-- 左侧面板 -->
    <div class="left-panel">
      <!-- 屏幕共享 -->
      <ScreenShare ref="screenShareRef" />

      <!-- 模型加载 -->
      <div class="model-section card">
        <h3>🤖 YOLO 模型</h3>
        <p v-if="!store.modelLoaded && !store.modelLoading">
          需加载模型才能检测宝图
        </p>
        <p v-if="store.modelLoading">加载中...</p>
        <p v-if="store.modelLoaded" class="success">模型已就绪 ✓</p>
        <button
          class="btn btn-primary"
          @click="loadModel"
          :disabled="store.modelLoading || store.modelLoaded"
        >
          加载 ONNX 模型
        </button>
      </div>

      <!-- 控制按钮 -->
      <div class="controls card">
        <button
          class="btn btn-success"
          @click="startMonitor"
          :disabled="!screenShareRef?.isSharing || !store.modelLoaded || store.isMonitoring"
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
          :disabled="!screenShareRef?.isSharing || !store.modelLoaded"
        >
          📸 单次截图
        </button>
      </div>

      <!-- 使用说明 -->
      <div class="card help">
        <h3>📋 使用说明</h3>
        <p>1. 点击「开始屏幕共享」选择游戏窗口</p>
        <p>2. 点击「加载 ONNX 模型」初始化 YOLO</p>
        <p>3. 点击「开始监控」自动检测宝图</p>
        <p>4. 鼠标悬停宝图触发坐标弹窗</p>
      </div>
    </div>

    <!-- 右侧结果面板 -->
    <div class="right-panel">
      <!-- 检测结果 -->
      <div class="card">
        <h3>🎯 检测结果</h3>
        <div class="detection-list">
          <div v-if="store.detections.length > 0">
            <div
              class="detection-item"
              v-for="(det, idx) in store.detections"
              :key="idx"
            >
              <span class="cls">{{ det.className }}</span>
              <span class="conf">{{ Math.round(det.conf * 100) }}%</span>
            </div>
          </div>
          <p v-else class="empty">等待检测...</p>
        </div>
      </div>

      <!-- 背包格子 -->
      <div class="card">
        <h3>🎒 背包格子 (4行×5列)</h3>
        <InventoryGrid :slots="store.inventory" />
      </div>

      <!-- 坐标列表 -->
      <CoordList :coords="store.coords" @clear="store.clearCoords" />
    </div>
  </div>
</template>

<style scoped>
.baotu-page {
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
  width: 350px;
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

.model-section .success {
  color: var(--color-success);
}

.detection-list {
  font-size: 11px;
  max-height: 120px;
  overflow-y: auto;
}

.detection-item {
  background: var(--bg-input);
  padding: 6px;
  margin-bottom: 4px;
  border-radius: 4px;
  border-left: 3px solid var(--border-color);
  display: flex;
  justify-content: space-between;
}

.detection-item .cls {
  color: var(--color-secondary);
  font-weight: bold;
}

.detection-item .conf {
  color: var(--color-success);
}

.empty {
  color: var(--color-text-muted);
  text-align: center;
  padding: 20px;
}

.help p {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 4px;
}
</style>