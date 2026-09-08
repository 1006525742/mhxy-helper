// 慈心检测/求解编排：识别棋盘 → 调 backend_cixin 求解 → 写 store。
// 屏幕捕获统一交给公共组件 ScreenShare（与挖图/分图助手一致），
// 由 CixinView 借助其 captureFull() 驱动后台检测循环，不在页面内联展示画面。

import { loadImageData, detectBoard, detectBoardManual } from '@/services/cixinDetect'
import type { DetectedBoard } from '@/services/cixinDetect'
import { solveOthello } from '@/services/cixinApi'
import { useCixinStore } from '@/stores/cixinStore'

export interface StrengthPreset {
  timeMs: number
  maxDepth: number
}

/** 棋力档位（与 mhxyai 一致） */
export const STRENGTH_PRESETS: Record<'strong' | 'ultra', StrengthPreset> = {
  strong: { timeMs: 1200, maxDepth: 10 },
  ultra: { timeMs: 1500, maxDepth: 12 }
}

// 屏幕检测循环已上移：由 CixinView 借助公共 ScreenShare 组件的 captureFull() 驱动，
// 不再在此维护独立的 ScreenCapture 实例。runSolve 导出供 CixinView 后台循环调用。

/** 上传图片测试：识别单张截图并直接求解（不走屏幕共享，复用同一套 CV 流水线） */
export async function analyzeUploadedImage(dataUrl: string): Promise<void> {
  const store = useCixinStore()
  store.resetResult()
  let img: ImageData
  try {
    img = await loadImageData(dataUrl)
  } catch (e) {
    store.setError(e instanceof Error ? e.message : '图像解码失败')
    return
  }
  const det = detectBoard(img)
  store.setDetection(det)
  if (!det || !det.isPlausible) {
    store.setError('未在图片中识别到有效棋盘（需 8×8、黑白双方均存在且 ≥4 子）')
    return
  }
  if (det.whiteMoves.length === 0) {
    store.setError('白方当前无合法落子')
    return
  }
  await runSolve(det)
}

/** 共享：识别到有效局面后，按当前棋力档位调后端求解白棋最优落点（导出供 CixinView 后台循环调用） */
export async function runSolve(det: DetectedBoard): Promise<void> {
  const store = useCixinStore()
  const preset = STRENGTH_PRESETS[store.strength] || STRENGTH_PRESETS.strong
  store.setComputing(true)
  try {
    const res = await solveOthello({
      board: det.board.slice(),
      aiPlayer: -1,
      timeMs: preset.timeMs,
      maxDepth: preset.maxDepth,
      // 宝箱数据 + 策略（boxFirst 时后端按 BOX_BONUS 加成持有宝箱的局）
      boxes: det.boxes && det.boxes.length > 0 ? det.boxes.slice() : undefined,
      strategy: store.strategy
    })
    if (res.action === null || !res.legal_moves.includes(res.action)) {
      throw new Error('AI 返回了无法落子的方格')
    }
    store.setResult(res)
  } catch (e) {
    store.setError(e instanceof Error ? e.message : 'AI 搜索失败')
  } finally {
    store.setComputing(false)
  }
}

/**
 * 手动框选测试：用户拖出的矩形（自然图像坐标）直接喂给 detectBoardManual，
 * 跳过自动网格检测。识别到有效局面即求解；即便 isPlausible 不成立也展示识别结果，
 * 方便用户据此调整框选范围。
 */
export async function analyzeManualRect(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const store = useCixinStore()
  store.resetResult()
  let img: ImageData
  try {
    img = await loadImageData(dataUrl)
  } catch (e) {
    store.setError(e instanceof Error ? e.message : '图像解码失败')
    return
  }
  const det = detectBoardManual(img, rect)
  store.setDetection(det)
  if (!det) {
    store.setError('框选区域过小或越界，无法识别为棋盘')
    return
  }
  if (!det.isPlausible) {
    // 仍展示识别到的格子，提示用户确认/重框，但不阻断查看
    store.setError('识别置信度偏低：请确认框选的是含黑白棋子的 8×8 棋盘，或重新框选更精确的区域（已展示当前识别结果）')
    return
  }
  if (det.whiteMoves.length === 0) {
    store.setError('白方当前无合法落子（已展示识别结果）')
    return
  }
  await runSolve(det)
}
