<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  board: number[] // 长度 64，1=黑 / -1=白 / 0=空
  action: number | null
  boxes: number[] // 检测到的宝箱格 index（最多 3 个）
  legalMoves?: number[] // 当前合法落点（可下）格 index —— 高亮显示
  taskCells?: number[] // 速刷模式优先格（长寿村/朱紫国/傲来国）
  strategy?: string
}>()

const baseUrl = import.meta.env.BASE_URL || '/'

// 转为 Set 加速查找
const boxSet = computed(() => new Set(props.boxes ?? []))
const taskSet = computed(() => new Set(props.taskCells ?? []))
const legalSet = computed(() => new Set(props.legalMoves ?? []))
const showTask = computed(() => props.strategy === 'taskFirst')

const cells = computed(() =>
  Array.from({ length: 64 }, (_, i) => ({
    i,
    value: props.board[i] ?? 0,
    isAction: props.action === i,
    isBox: boxSet.value.has(i),
    isLegal: legalSet.value.has(i) && props.action !== i, // 合法落点（不含已选中的推荐点）
    isTask: showTask.value && taskSet.value.has(i)
  }))
)

const COLS = 8
</script>

<template>
  <div class="mini-board" role="img" aria-label="识别到的棋盘布局">
    <div
      class="grid"
      :style="{
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${COLS}, 1fr)`
      }"
    >
      <div
        v-for="cell in cells"
        :key="cell.i"
        class="cell"
        :class="{ black: cell.value === 1, white: cell.value === -1, action: cell.isAction, box: cell.isBox && cell.value === 0, task: cell.isTask, legal: cell.isLegal }"
      >
        <span v-if="cell.value !== 0" class="disc" :class="{ black: cell.value === 1, white: cell.value === -1 }" />
        <img
          v-else-if="cell.isBox"
          class="treasure"
          :src="`${baseUrl}cixin-maps/treasure.png`"
          alt="宝箱"
          draggable="false"
        />
        <!-- 合法落点柔光标记（能下的点高亮；已落子/不能下的不亮） -->
        <span v-if="cell.isLegal && !cell.isBox" class="legal-dot" />
        <span v-if="cell.isAction" class="dot" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-board {
  background: #5a3d22;
  padding: 8px;
  border-radius: 8px;
  width: 100%;
  max-width: 400px;
  box-shadow: inset 0 0 0 2px #3a2614, 0 2px 6px rgba(0, 0, 0, 0.4);
}
.grid {
  display: grid;
  gap: 3px;
  aspect-ratio: 1 / 1;
  background: #3a2614;
  padding: 3px;
  border-radius: 4px;
}
.cell {
  background: #c8a06a;
  border-radius: 4px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.cell.black {
  background: #b88c52;
}
.cell.white {
  background: #d8b27a;
}
/* 合法落点高亮：整格轻微提亮 + 柔绿光环（呼应游戏「能下的点亮」） */
.cell.legal {
  background: #d9b97f;
  box-shadow: inset 0 0 0 1px rgba(120, 230, 170, 0.45);
}
/* 合法落点柔光点（中心呼吸发光） */
.legal-dot {
  position: absolute;
  width: 28%;
  height: 28%;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #eafff4, #4fe0a0 70%);
  box-shadow: 0 0 8px 2px rgba(79, 224, 160, 0.6);
  pointer-events: none;
  animation: cixin-legal-glow 1.5s ease-in-out infinite;
  z-index: 1;
}
@keyframes cixin-legal-glow {
  0%, 100% {
    box-shadow: 0 0 6px 1px rgba(79, 224, 160, 0.45);
  }
  50% {
    box-shadow: 0 0 12px 3px rgba(79, 224, 160, 0.85);
  }
}
/* 推荐落点高亮：整格淡金底色，衬托白子黄圈 */
.cell.action {
  background: rgba(255, 206, 58, 0.18);
}
/* 宝箱格：柔和金色微底色，凸显宝箱图标 */
.cell.box {
  background: #d6a55a;
  box-shadow: inset 0 0 0 1px rgba(255, 215, 110, 0.6);
}
/* 速刷优先格（taskFirst）：金色描边 + 角落「速」标记 */
.cell.task {
  box-shadow: inset 0 0 0 2px rgba(255, 200, 100, 0.9);
}
.cell.task::before {
  content: '速';
  position: absolute;
  top: 1px;
  left: 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  color: #ffe0a0;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  z-index: 2;
}
.disc {
  width: 76%;
  height: 76%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  box-shadow: inset 0 -2px 3px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.3);
  flex: 0 0 auto;
}
.disc.black {
  background: radial-gradient(circle at 35% 30%, #555, #0a0a0a);
}
.disc.white {
  background: radial-gradient(circle at 35% 30%, #ffffff, #d4d4d4);
}
.treasure {
  width: 82%;
  height: 82%;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4));
  animation: cixin-treasure-glow 1.4s ease-in-out infinite;
}
/* 推荐落点标记：白色棋子（白子）+ 醒目黄圈 + 呼吸发光 */
.dot {
  position: absolute;
  width: 74%;
  height: 74%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #d4d4d4);
  border: 4px solid #ffce3a;
  box-shadow: 0 0 0 2px rgba(255, 206, 58, 0.35), inset 0 -2px 3px rgba(0, 0, 0, 0.25),
    0 0 12px 3px rgba(255, 206, 58, 0.85);
  pointer-events: none;
  z-index: 2;
  animation: cixin-pulse 1.1s ease-in-out infinite;
}
@keyframes cixin-pulse {
  0%, 100% {
    box-shadow: 0 0 0 2px rgba(255, 206, 58, 0.35), inset 0 -2px 3px rgba(0, 0, 0, 0.25),
      0 0 12px 3px rgba(255, 206, 58, 0.7);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(255, 206, 58, 0.6), inset 0 -2px 3px rgba(0, 0, 0, 0.25),
      0 0 18px 5px rgba(255, 206, 58, 1);
  }
}
@keyframes cixin-treasure-glow {
  0%, 100% {
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 2px rgba(255, 215, 110, 0.55));
    transform: scale(1);
  }
  50% {
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 5px rgba(255, 215, 110, 0.95));
    transform: scale(1.04);
  }
}
</style>