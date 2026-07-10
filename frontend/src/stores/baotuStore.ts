import { defineStore } from 'pinia'
import { ref } from 'vue'

interface Coord {
  map: string
  x: number
  y: number
}

interface InventorySlot {
  slot: number
  item?: string
  coord?: string
  confidence?: number
}

export const useBaotuStore = defineStore('baotu', () => {
  // 状态
  const isMonitoring = ref(false)
  const detections = ref<any[]>([])
  const coords = ref<Coord[]>([])
  const inventory = ref<InventorySlot[]>([])
  const modelLoaded = ref(false)
  const modelLoading = ref(false)
  const lastError = ref('')
  const isProcessing = ref(false)

  /**
   * 设置检测结果
   */
  function setDetections(results: any[]) {
    detections.value = results

    // 解析宝图坐标
    results.forEach((det, idx) => {
      if (det.className === 'coord_popup') {
        // 添加到库存
        const slotNum = idx + 1
        inventory.value.push({
          slot: slotNum,
          item: '宝图',
          coord: '识别中...',
          confidence: det.conf
        })
      }
    })
  }

  /**
   * 添加坐标
   */
  function addCoord(map: string, x: number, y: number) {
    coords.value.push({ map, x, y })
  }

  /**
   * 清空坐标
   */
  function clearCoords() {
    coords.value = []
    inventory.value = []
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
   * 设置模型加载状态
   */
  function setModelLoaded(loaded: boolean) {
    modelLoaded.value = loaded
    modelLoading.value = false
  }

  /**
   * 设置模型加载中
   */
  function setModelLoading(loading: boolean) {
    modelLoading.value = loading
  }

  return {
    // 状态
    isMonitoring,
    detections,
    coords,
    inventory,
    modelLoaded,
    modelLoading,
    lastError,
    isProcessing,

    // 方法
    setDetections,
    addCoord,
    clearCoords,
    startMonitoring,
    stopMonitoring,
    setModelLoaded,
    setModelLoading
  }
})