<script setup lang="ts">
import type { CalcResult } from '@/calculators/services/calcEngine'
import { fmtWan, fmtRMB, fmtInt } from '@/calculators/engine/format'

defineProps<{ result: CalcResult }>()
</script>

<template>
  <div class="cost-table card">
    <template v-if="!result.valid">
      <div class="ct-error">⚠️ {{ result.errorMessage }}</div>
    </template>

    <template v-else>
      <!-- 合成类：材料费 + 合成费 拆解 -->
      <template v-if="result.type === 'synthesis'">
        <h3>消耗明细</h3>
        <div class="ct-rows">
          <div class="ct-row">
            <span>材料费（梦幻币）</span>
            <b>{{ fmtWan(result.materialsWan ?? 0) }}</b>
          </div>
          <div class="ct-row">
            <span>合成费（梦幻币）</span>
            <b>{{ fmtWan(result.feeWan ?? 0) }}</b>
          </div>
        </div>
      </template>

      <!-- 等级消耗类：逐槽明细 -->
      <template v-else>
        <h3>逐项目明细</h3>
        <table class="ct-table">
          <thead>
            <tr>
              <th>项目</th>
              <th v-if="result.totalExp != null">经验</th>
              <th>梦幻币</th>
              <th>人民币</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in result.perSlot" :key="s.key">
              <td>{{ s.label }}</td>
              <td v-if="result.totalExp != null">{{ fmtInt(s.exp ?? 0) }}</td>
              <td>{{ fmtWan(s.moneyWan) }}</td>
              <td class="rmb">{{ fmtRMB(s.rmb) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="result.fruitCount != null" class="ct-note">
          约需修炼果 <b>{{ fmtInt(result.fruitCount) }}</b> 个（1果=150经验）
        </div>
      </template>

      <!-- 合计 -->
      <div class="ct-total">
        <div class="ct-total-item">
          <span>合计梦幻币</span>
          <b class="wan">{{ fmtWan(result.totalWan) }}</b>
        </div>
        <div class="ct-total-item">
          <span>合计人民币</span>
          <b class="rmb">{{ fmtRMB(result.totalRMB) }}</b>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cost-table {
  background: var(--bg-panel);
}
.ct-error {
  color: var(--color-warning);
  font-size: 13px;
  padding: 8px 0;
}
.ct-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ct-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--color-text-muted);
}
.ct-row b {
  color: var(--color-text);
}
.ct-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ct-table th,
.ct-table td {
  text-align: left;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border-color);
}
.ct-table th {
  color: var(--color-secondary);
  font-weight: 600;
}
.ct-table .rmb {
  color: var(--color-warning);
}
.ct-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.ct-note b {
  color: var(--color-warning);
}
.ct-total {
  display: flex;
  gap: 24px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 2px solid var(--border-color);
}
.ct-total-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.ct-total-item .wan {
  font-size: 20px;
  color: var(--color-primary);
}
.ct-total-item .rmb {
  font-size: 20px;
  color: var(--color-warning);
}
</style>
