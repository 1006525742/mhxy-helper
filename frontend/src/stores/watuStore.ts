import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  type DetectMode,
  type GridCell,
  createEmptyGrid
} from '@/services/fentuLogic'
import { type PlanResult, type PathStep } from '@/services/watuLogic'

export const useWatuStore = defineStore('watu', () => {
  /** 识别位置模式（复用分图助手的三种模式） */
  const mode = ref<DetectMode>('horizontal')
  /** 20 格网格数据 */
  const grid = ref<GridCell[]>(createEmptyGrid())
  /** 物品栏锁定：锁定后识别不再更新宝图坐标，可手动修改 */
  const gridLocked = ref(false)
  /** 模型是否已加载 */
  const modelLoaded = ref(false)
  /** 模型加载中 */
  const modelLoading = ref(false)
  /** 模型加载进度 0~1 */
  const modelProgress = ref(0)
  /** 检测循环运行中 */
  const isDetecting = ref(false)
  /** 已检测帧数 */
  const frameCount = ref(0)
  /** 最近一帧的原始检测框（用于 overlay 画框） */
  const lastDetections = ref<Array<{ className: string; cx: number; cy: number; conf: number }>>([])
  /** 错误信息 */
  const lastError = ref('')
  /** 最近一次 OCR 识别到的坐标 */
  const latestCoord = ref<{ x: number; y: number; map?: string; at: number } | null>(null)

  /** 路径规划结果 */
  const planResult = ref<PlanResult | null>(null)
  /** 路径规划进行中 */
  const planning = ref(false)
  /** 当前选中的可视化步骤（点击路径列表项后高亮对应地图） */
  const activeStep = ref<PathStep | null>(null)

  /** 蒙版：点击地图名后在物品栏覆盖的挖图顺序 + 坐标 */
  const maskedCells = ref<Array<{ index: number; order: number; x: number; y: number }> | null>(null)

  function setMask(cells: Array<{ index: number; order: number; x: number; y: number }>) {
    maskedCells.value = cells
  }
  function clearMask() {
    maskedCells.value = null
  }

  const isWarehouse = computed(() => mode.value !== 'horizontal')
  /** 已识别的宝图数量 */
  const recognizedCount = computed(() =>
    grid.value.filter((c) => c.isRecognized && c.mapname).length
  )

  function setMode(m: DetectMode) {
    mode.value = m
  }

  function setGrid(cells: GridCell[]) {
    grid.value = cells
  }

  function clearGrid() {
    grid.value = createEmptyGrid()
    gridLocked.value = false
    lastDetections.value = []
    planResult.value = null
    activeStep.value = null
    clearMask()
  }

  /** 清空单个格子（手动修正：把某格恢复成空） */
  function clearCell(index: number) {
    if (index < 0 || index >= grid.value.length) return
    grid.value[index] = createEmptyGrid()[index]
  }

  function setGridLocked(v: boolean) {
    gridLocked.value = v
  }

  function toggleGridLocked() {
    gridLocked.value = !gridLocked.value
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

  function setCellCoord(index: number, x: number, y: number, mapName?: string) {
    if (index < 0 || index >= grid.value.length) return
    const cell = grid.value[index]
    const finalName = (mapName && mapName.trim()) ? mapName.trim() : (cell.mapname || '藏宝图')
    grid.value[index] = {
      ...cell,
      x,
      y,
      mapname: finalName,
      isRecognized: true
    }
  }

  function setError(msg: string) {
    lastError.value = msg
  }

  function setLatestCoord(x: number, y: number, mapName?: string) {
    latestCoord.value = { x, y, map: mapName || undefined, at: Date.now() }
  }

  function setPlanResult(result: PlanResult | null) {
    planResult.value = result
  }

  function setPlanning(v: boolean) {
    planning.value = v
  }

  function setActiveStep(step: PathStep | null) {
    activeStep.value = step
  }

  return {
    // 状态
    mode,
    grid,
    modelLoaded,
    modelLoading,
    modelProgress,
    isDetecting,
    frameCount,
    lastDetections,
    lastError,
    latestCoord,
    planResult,
    planning,
    activeStep,
    maskedCells,
    gridLocked,
    setMask,
    clearMask,
    isWarehouse,
    recognizedCount,
    // 方法
    setMode,
    setGrid,
    clearGrid,
    setGridLocked,
    toggleGridLocked,
    clearCell,
    setModelLoaded,
    setModelLoading,
    setModelProgress,
    setDetecting,
    setDetections,
    setCellCoord,
    setError,
    setLatestCoord,
    setPlanResult,
    setPlanning,
    setActiveStep
  }
})
