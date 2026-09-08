<script setup lang="ts">
import { useFentuStore } from '@/stores/fentuStore'
import { SCENE_MAPS, MAX_WAREHOUSE_SLOTS, getMapDefaultColor } from '@/services/fentuLogic'

const store = useFentuStore()

/** 下拉选项：空 + 16 场景 */
const options = ['', ...SCENE_MAPS]
const maxSlots = MAX_WAREHOUSE_SLOTS

/** 恢复默认：二次确认避免误触 */
function onReset() {
  if (window.confirm('确定恢复默认设置？\n将清掉所有仓库配置，回到 16 个仓库 + 默认地图（傲来国、花果山…）。')) {
    store.resetSceneSlots()
  }
}
</script>

<template>
  <div class="scene-panel card">
    <div class="scene-head">
      <h3>📌 仓库宝图存放设置</h3>
      <button
        class="scene-reset"
        type="button"
        title="恢复默认：清掉所有仓库配置，回到 16 个仓库 + 默认地图"
        @click="onReset"
      >恢复默认设置</button>
    </div>
    <div class="scene-grid">
      <div
        v-for="(map, idx) in store.sceneSlots"
        :key="idx"
        class="scene-row"
      >
        <span
          class="scene-badge"
          :style="{ background: getMapDefaultColor(map) }"
        >{{ idx + 1 }}</span>
        <select
          class="scene-select"
          :value="map"
          @change="store.setSceneSlot(idx, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in options" :key="opt" :value="opt">
            {{ opt || '未设置' }}
          </option>
        </select>
        <button
          v-if="idx >= 16"
          class="scene-remove"
          type="button"
          title="删除该仓库"
          @click="store.removeSlot(idx)"
        >×</button>
      </div>
    </div>
    <button
      class="scene-add"
      type="button"
      :disabled="store.sceneSlots.length >= maxSlots"
      @click="store.addSlot"
    >＋ 添加仓库（{{ store.sceneSlots.length }}/{{ maxSlots }}）</button>
  </div>
</template>

<style scoped>
.scene-panel {
  min-width: 0;
}
.scene-panel h3 {
  margin: 0;
  font-size: 17px;
  color: var(--color-text);
}
.scene-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.scene-reset {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.scene-reset:hover {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.scene-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 8px;
}

.scene-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.scene-badge {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.scene-select {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  background: var(--bg-input);
  color: var(--color-text);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 5px 6px;
  font-size: 13px;
}

.scene-remove {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.scene-remove:hover {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.scene-add {
  margin-top: 10px;
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  border: 1px dashed var(--border-color);
  background: var(--bg-input);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.scene-add:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.scene-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
