import { defineStore } from 'pinia'
import { ref } from 'vue'
import { recognizeCoord, predictGhost } from '@/services/api'

interface HistoryItem {
  time: string
  map: string
  x: number
  y: number
}

export const useGhostStore = defineStore('ghost', () => {
  // 状态
  const isMonitoring = ref(false)
  const currentMap = ref('')
  const currentX = ref(0)
  const currentY = ref(0)
  const positionAreas = ref<string[]>([])
  const cornerAreas = ref<string[]>([])
  const confidence = ref(0)
  const annotatedImage = ref('')
  const history = ref<HistoryItem[]>([])
  const lastError = ref('')
  const isProcessing = ref(false)

  // 截图区域设置
  const regionX = ref(0)
  const regionY = ref(0)
  const regionWidth = ref(600)
  const regionHeight = ref(180)

  /**
   * 设置截图区域
   */
  function setRegion(region: { x: number; y: number; width: number; height: number }) {
    regionX.value = region.x
    regionY.value = region.y
    regionWidth.value = region.width
    regionHeight.value = region.height
  }

  /**
   * 处理截图并识别
   */
  async function processCapture(imageBase64: string) {
    if (isProcessing.value) return

    isProcessing.value = true
    lastError.value = ''

    try {
      // 1. 模板匹配识别坐标
      const recognizeResult = await recognizeCoord(imageBase64)

      if (!recognizeResult.success || !recognizeResult.map) {
        lastError.value = recognizeResult.error || '未识别到坐标'
        return
      }

      currentMap.value = recognizeResult.map
      currentX.value = recognizeResult.x || 0
      currentY.value = recognizeResult.y || 0

      // 2. 抓鬼预测
      const predictResult = await predictGhost(
        recognizeResult.map,
        recognizeResult.x || 0,
        recognizeResult.y || 0
      )

      if (predictResult.success) {
        positionAreas.value = predictResult.position_areas || []
        cornerAreas.value = predictResult.corner_areas || []
        confidence.value = predictResult.confidence || 0
        annotatedImage.value = predictResult.annotated_image || ''
      }

      // 3. 添加到历史
      addToHistory(recognizeResult.map, recognizeResult.x || 0, recognizeResult.y || 0)

    } catch (e) {
      lastError.value = String(e)
    } finally {
      isProcessing.value = false
    }
  }

  /**
   * 添加到历史记录
   */
  function addToHistory(map: string, x: number, y: number) {
    const now = new Date()
    const timeStr = now.toLocaleTimeString('zh-CN')

    history.value.unshift({
      time: timeStr,
      map,
      x,
      y
    })

    // 最多保留 20 条
    if (history.value.length > 20) {
      history.value.pop()
    }
  }

  /**
   * 开始监控
   */
  function startMonitoring() {
    isMonitoring.value = true
  }

  /**
   * 停止监控
   */
  function stopMonitoring() {
    isMonitoring.value = false
  }

  /**
   * 清空历史
   */
  function clearHistory() {
    history.value = []
  }

  return {
    // 状态
    isMonitoring,
    currentMap,
    currentX,
    currentY,
    positionAreas,
    cornerAreas,
    confidence,
    annotatedImage,
    history,
    lastError,
    isProcessing,
    regionX,
    regionY,
    regionWidth,
    regionHeight,

    // 方法
    setRegion,
    processCapture,
    startMonitoring,
    stopMonitoring,
    clearHistory
  }
})