<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  change: [region: { x: number; y: number; width: number; height: number }]
}>()

const x = ref(0)
const y = ref(0)
const width = ref(600)
const height = ref(180)

function emitChange() {
  emit('change', {
    x: x.value,
    y: y.value,
    width: width.value,
    height: height.value
  })
}

// 暴露当前区域值
defineExpose({
  getRegion: () => ({ x: x.value, y: y.value, width: width.value, height: height.value })
})
</script>

<template>
  <div class="region-selector">
    <h3>📐 截图区域设置</h3>
    <p class="desc">设置游戏中小鬼坐标显示区域（相对于游戏窗口左上角）</p>

    <div class="inputs">
      <div class="input-group">
        <label>X 偏移</label>
        <input type="number" v-model.number="x" @change="emitChange" min="0" />
      </div>
      <div class="input-group">
        <label>Y 偏移</label>
        <input type="number" v-model.number="y" @change="emitChange" min="0" />
      </div>
      <div class="input-group">
        <label>宽度</label>
        <input type="number" v-model.number="width" @change="emitChange" min="100" />
      </div>
      <div class="input-group">
        <label>高度</label>
        <input type="number" v-model.number="height" @change="emitChange" min="50" />
      </div>
    </div>

    <p class="tip">💡 建议：游戏中小鬼名字显示区域，如 60, 50, 500, 120</p>
  </div>
</template>

<style scoped>
.region-selector {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 15px;
  border: 1px solid var(--border-color);
}

.region-selector h3 {
  color: var(--color-secondary);
  font-size: 14px;
  margin-bottom: 10px;
}

.desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 10px;
}

.inputs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-group label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.input-group input {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--color-text);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
}

.tip {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}
</style>