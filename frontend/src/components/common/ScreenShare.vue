<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { ScreenCapture } from '@/services/screenCapture'

const emit = defineEmits<{
  started: []
  stopped: []
  error: [msg: string]
}>()

const screenCapture = new ScreenCapture()
const isSharing = ref(false)
const previewImage = ref('')
const previewText = ref('点击下方按钮选择游戏窗口')

let previewLoopId: number | null = null

/**
 * 开始屏幕共享
 */
async function startShare() {
  const success = await screenCapture.start()
  if (success) {
    isSharing.value = true
    emit('started')
    startPreviewLoop()
  } else {
    previewText.value = '屏幕共享失败'
    emit('error', '屏幕共享失败')
  }
}

/**
 * 停止屏幕共享
 */
function stopShare() {
  stopPreviewLoop()
  screenCapture.stop()
  isSharing.value = false
  previewImage.value = ''
  previewText.value = '点击下方按钮选择游戏窗口'
  emit('stopped')
}

/**
 * 开始预览循环
 */
function startPreviewLoop() {
  const loop = () => {
    if (!screenCapture.isActive()) return

    const frame = screenCapture.getPreviewFrame()
    if (frame) {
      previewImage.value = frame
      previewText.value = ''
    }

    previewLoopId = requestAnimationFrame(loop)
  }
  loop()
}

/**
 * 停止预览循环
 */
function stopPreviewLoop() {
  if (previewLoopId) {
    cancelAnimationFrame(previewLoopId)
    previewLoopId = null
  }
}

/**
 * 截取指定区域
 */
function captureRegion(x: number, y: number, width: number, height: number): string | null {
  return screenCapture.captureRegion({ x, y, width, height })
}

/**
 * 截取全屏
 */
function captureFull(): string | null {
  return screenCapture.captureFull()
}

/**
 * 获取视频尺寸
 */
function getVideoSize() {
  return screenCapture.getVideoSize()
}

// 暴露方法给父组件
defineExpose({
  captureRegion,
  captureFull,
  getVideoSize,
  isSharing
})

onUnmounted(() => {
  stopShare()
})
</script>

<template>
  <div class="screen-share">
    <div class="share-preview" :class="{ active: isSharing }">
      <span v-if="previewText" class="placeholder-text">{{ previewText }}</span>
      <img v-if="previewImage" :src="previewImage" class="preview-image" />
    </div>

    <div class="controls">
      <button
        class="btn btn-success"
        @click="startShare"
        v-if="!isSharing"
      >
        ▶ 开始屏幕共享
      </button>
      <button
        class="btn btn-danger"
        @click="stopShare"
        v-if="isSharing"
      >
        ⏸ 停止共享
      </button>
    </div>
  </div>
</template>

<style scoped>
.screen-share {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 15px;
  border: 1px solid var(--border-color);
}

.share-preview {
  background: #000;
  border-radius: 4px;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-preview.active {
  min-height: 300px;
}

.placeholder-text {
  color: #555;
  font-size: 14px;
}

.preview-image {
  max-width: 100%;
  max-height: 400px;
  border-radius: 4px;
}

.controls {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
</style>