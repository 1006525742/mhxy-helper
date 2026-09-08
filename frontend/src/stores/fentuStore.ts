import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  type DetectMode,
  type GridCell,
  SCENE_MAPS,
  createEmptyGrid,
  loadAllSceneSlots,
  writeSceneSlot,
  getSceneColor,
  MAX_WAREHOUSE_SLOTS,
  writeSlotCount,
  clearAllSceneSlots
} from '@/services/fentuLogic'

export const useFentuStore = defineStore('fentu', () => {
  /** 识别位置模式 */
  const mode = ref<DetectMode>('horizontal')
  /** 20 格网格数据 */
  const grid = ref<GridCell[]>(createEmptyGrid())
  /** 16 场景槽位缓存值 */
  const sceneSlots = ref<string[]>(loadAllSceneSlots())
  /** 模型是否已加载 */
  const modelLoaded = ref(false)
  /** 模型加载中 */
  const modelLoading = ref(false)
  /** 模型加载进度 0~1（TF.js onProgress） */
  const modelProgress = ref(0)
  /** 检测循环运行中 */
  const isDetecting = ref(false)
  /** 已检测帧数 */
  const frameCount = ref(0)
  /** 最近一帧的原始检测框（用于 overlay 画框） */
  const lastDetections = ref<Array<{ className: string; cx: number; cy: number; conf: number }>>([])
  /** 错误信息 */
  const lastError = ref('')
  /** 最近一次 OCR 识别到的游戏内坐标（即使没有对应藏宝图1 格也会保存并显示） */
  const latestCoord = ref<{ x: number; y: number; map?: string; at: number } | null>(null)

  const isWarehouse = computed(() => mode.value !== 'horizontal')

  /**
   * 切换识别位置模式
   */
  function setMode(m: DetectMode) {
    mode.value = m
  }

  /**
   * 设置网格数据
   */
  function setGrid(cells: GridCell[]) {
    grid.value = cells
  }

  /**
   * 写入某个场景槽位的值并持久化
   */
  function setSceneSlot(idx: number, value: string) {
    if (idx < 0 || idx >= sceneSlots.value.length) return
    sceneSlots.value[idx] = value.trim()
    writeSceneSlot(idx, value)
  }

  /**
   * 新增一个仓库槽位（最多 MAX_WAREHOUSE_SLOTS 个）
   * 重新写入所有槽位键 + 数量，保证 localStorage 索引与数组始终一致
   */
  function addSlot() {
    if (sceneSlots.value.length >= MAX_WAREHOUSE_SLOTS) return
    const next = [...sceneSlots.value, '']
    sceneSlots.value = next
    next.forEach((v, i) => writeSceneSlot(i, v))
    writeSlotCount(next.length)
  }

  /**
   * 删除一个仓库槽位（仅允许删除第 17 个及以后新增的；会重写所有键保持索引一致）
   */
  function removeSlot(idx: number) {
    if (idx < SCENE_MAPS.length || idx >= sceneSlots.value.length) return
    if (sceneSlots.value.length <= SCENE_MAPS.length) return
    const next = sceneSlots.value.filter((_, i) => i !== idx)
    sceneSlots.value = next
    next.forEach((v, i) => writeSceneSlot(i, v))
    writeSlotCount(next.length)
  }

  /**
   * 恢复默认仓库设置：清空所有槽位缓存，回到 16 个仓库 + 默认地图映射
   */
  function resetSceneSlots() {
    clearAllSceneSlots()
    sceneSlots.value = SCENE_MAPS.slice(0, 16).map((name) => name)
  }

  /**
   * 清空网格
   */
  function clearGrid() {
    grid.value = createEmptyGrid()
    lastDetections.value = []
  }

  function setModelLoaded(loaded: boolean) {
    modelLoaded.value = loaded
    modelLoading.value = false
    if (loaded) modelProgress.value = 1
  }

  function setModelLoading(loading: boolean) {
    modelLoading.value = loading
    if (loading) modelProgress.value = 0
  }

  function setModelProgress(p: number) {
    modelProgress.value = Math.max(0, Math.min(1, p))
  }

  function setDetecting(running: boolean) {
    isDetecting.value = running
  }

  function setDetections(dets: typeof lastDetections.value) {
    lastDetections.value = dets
    frameCount.value++
  }

  /**
   * 用 OCR 识别出的游戏内坐标覆盖某格的 (x,y)
   * @param mapName OCR 识别到的真实地图名（如「女儿村」），用于显示并取仓库默认颜色
   */
  function setCellCoord(index: number, x: number, y: number, mapName?: string) {
    if (index < 0 || index >= grid.value.length) return
    const cell = grid.value[index]
    // 优先用 OCR 识别到的真实地图名；否则保留落格时的占位（藏宝图1）
    const finalName = (mapName && mapName.trim()) ? mapName.trim() : (cell.mapname || '藏宝图')
    // 根据地图名匹配「仓库宝图存放设置」里的槽位 → 取其默认颜色（用于区分地图）
    const sIdx = sceneSlots.value.findIndex((s) => s === finalName)
    const color = sIdx >= 0 ? getSceneColor(sIdx) : (cell.slotColor || '#B8860B')
    grid.value[index] = {
      ...cell,
      x,
      y,
      mapname: finalName,
      sceneSlot: sIdx,
      slotColor: color,
      // 已通过 OCR 识别出真实坐标 → 标记为已识别，跨帧持久保留（不会被网格合并覆盖）
      isRecognized: true
    }
  }

  function setError(msg: string) {
    lastError.value = msg
  }

  /**
   * 记录最近一次 OCR 识别到的坐标（用于「最近识别坐标」展示，不依赖藏宝图1 格）
   * @param mapName OCR 识别到的真实地图名，用于显示并取仓库默认颜色
   */
  function setLatestCoord(x: number, y: number, mapName?: string) {
    latestCoord.value = { x, y, map: mapName || undefined, at: Date.now() }
  }

  /**
   * 根据场景槽位序号取得颜色
   */
  function sceneColor(idx: number): string {
    return getSceneColor(idx)
  }

  return {
    // 状态
    mode,
    grid,
    sceneSlots,
    modelLoaded,
    modelLoading,
    modelProgress,
    isDetecting,
    frameCount,
    lastDetections,
    lastError,
    latestCoord,
    isWarehouse,
    // 方法
    setMode,
    setGrid,
    setSceneSlot,
    addSlot,
    removeSlot,
    resetSceneSlots,
    clearGrid,
    setModelLoaded,
    setModelLoading,
    setModelProgress,
    setDetecting,
    setDetections,
    setError,
    setCellCoord,
    setLatestCoord,
    sceneColor
  }
})
