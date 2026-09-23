<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { VitalityDef } from '@/calculators/engine/types'
import { computeVitality } from '@/calculators/services/calcEngine'

const props = defineProps<{ def: VitalityDef }>()

// ===== 本地持久化：所有输入自动存本机浏览器，下次打开自动回填 =====
// 与 priceStore(mhxy_price_v1)、calcOverride 同为 localStorage 方案，无需后端、无账号。
const LS_KEY = 'mhxy_vitality_v1'
const LS_VERSION = 1

interface VitalityPersist {
  version: number
  level: number
  fitness: number
  regimen: number
  capPhysical: number
  capVitality: number
  recoverPhysical: number
  recoverVitality: number
  pCur: number
  pTgt: number
  vCur: number
  vTgt: number
  pointCardPrice: number
  liangcaoPrice: number
  baishouQuality: number
  baishouPrice: number
  haimaPrice: number
  jushenPrice: number
  talismanLevel: number
  talismanPrice: number
  pointCardPerHour: number
  liangcaoPerHour: number
  lingxiPrice: number
  lingxiPerRefine: number
  lingxiRefineCost: number
}

function loadSaved(): Partial<VitalityPersist> | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<VitalityPersist>
    // 版本不匹配（结构变更）→ 丢弃旧存档，回落到默认值
    return d && d.version === LS_VERSION ? d : null
  } catch {
    return null
  }
}
const sv = loadSaved()

// 角色基础：等级 + 健身术(体力) + 养生术(活力)
const level = ref(sv?.level ?? props.def.level)
const fitness = ref(sv?.fitness ?? props.def.fitness)
const regimen = ref(sv?.regimen ?? props.def.regimen)

// 自动恢复（由角色基础推导，可手动覆盖）
const capPhysical = ref(0)
const capVitality = ref(0)
const recoverPhysical = ref(0)
const recoverVitality = ref(0)

function autoCalc() {
  const lv = Math.max(0, Math.floor(level.value || 0))
  const fit = Math.max(0, Math.floor(fitness.value || 0))
  const reg = Math.max(0, Math.floor(regimen.value || 0))
  capPhysical.value = lv * 5 + 50 + fit * 4
  capVitality.value = lv * 5 + 50 + reg * 4
  recoverPhysical.value = Math.floor(capPhysical.value * 0.01) + Math.floor(lv * 0.02) + 2
  recoverVitality.value = Math.floor(capVitality.value * 0.01) + Math.floor(lv * 0.02) + 2
}
autoCalc() // 先算一遍兜底（存档缺字段时也有有效值）
// 有存档 → 覆盖用户手动改过的上限/恢复值；再注册 watch，避免回填被自动值冲掉
if (sv) {
  if (typeof sv.capPhysical === 'number') capPhysical.value = sv.capPhysical
  if (typeof sv.capVitality === 'number') capVitality.value = sv.capVitality
  if (typeof sv.recoverPhysical === 'number') recoverPhysical.value = sv.recoverPhysical
  if (typeof sv.recoverVitality === 'number') recoverVitality.value = sv.recoverVitality
}
watch([level, fitness, regimen], autoCalc)

// 恢复时间：当前/目标/上限
const pCur = ref(sv?.pCur ?? 0)
const pTgt = ref(sv?.pTgt ?? capPhysical.value)
const vCur = ref(sv?.vCur ?? 0)
const vTgt = ref(sv?.vTgt ?? capVitality.value)
// 等级/技能变化时，默认目标跟随上限（满）
watch([capPhysical, capVitality], () => {
  pTgt.value = capPhysical.value
  vTgt.value = capVitality.value
})

// 各方案每小时费率（可编辑）
const rates = reactive<Record<string, { silver: number; reserve: number }>>(
  Object.fromEntries(props.def.plans.map((p) => [p.key, { silver: p.silverPerHour, reserve: p.reservePerHour }])),
)

// 收益块输入
const pointCardPrice = ref(sv?.pointCardPrice ?? 1.56) // 每点点卡价格（万）
const liangcaoPrice = ref(sv?.liangcaoPrice ?? 0.5) // 粮草摆摊价格（万/个）
const baishouQuality = ref(sv?.baishouQuality ?? props.def.profitDefaults.baishouQuality)
const baishouPrice = ref(sv?.baishouPrice ?? props.def.profitDefaults.baishouPrice)
const haimaPrice = ref(sv?.haimaPrice ?? props.def.profitDefaults.haimaPrice)

// 变现单价（按本区物价校正，用玩家可观测单位）
const jushenPrice = ref(sv?.jushenPrice ?? props.def.profit.jushenPrice)
const talismanLevel = ref(sv?.talismanLevel ?? props.def.profit.talismanLevel)
const talismanPrice = ref(sv?.talismanPrice ?? props.def.profit.talismanPrice)
const pointCardPerHour = ref(sv?.pointCardPerHour ?? props.def.profit.pointCardPerHour)
const liangcaoPerHour = ref(sv?.liangcaoPerHour ?? props.def.profit.liangcaoPerHour)

// 灵犀之屑（800体力+42万/次，保底1个、期望1.36个）
const lingxiPrice = ref(sv?.lingxiPrice ?? props.def.profit.lingxiPrice)
const lingxiPerRefine = ref(sv?.lingxiPerRefine ?? props.def.profit.lingxiPerRefine)
const lingxiRefineCost = ref(sv?.lingxiRefineCost ?? props.def.profit.lingxiRefineCost)

const res = computed(() =>
  computeVitality(props.def, {
    physicalCurrent: pCur.value,
    physicalTarget: pTgt.value,
    vitalityCurrent: vCur.value,
    vitalityTarget: vTgt.value,
    level: level.value,
    fitness: fitness.value,
    regimen: regimen.value,
    capPhysicalOverride: capPhysical.value,
    capVitalityOverride: capVitality.value,
    recoverPhysicalOverride: recoverPhysical.value,
    recoverVitalityOverride: recoverVitality.value,
    planRates: rates,
    pointCardPrice: pointCardPrice.value,
    liangcaoPrice: liangcaoPrice.value,
    baishouQuality: baishouQuality.value,
    baishouPrice: baishouPrice.value,
    haimaPrice: haimaPrice.value,
    profitOverride: {
      pointCardPerHour: pointCardPerHour.value,
      jushenPrice: jushenPrice.value,
      talismanLevel: talismanLevel.value,
      talismanPrice: talismanPrice.value,
      liangcaoPerHour: liangcaoPerHour.value,
      lingxiPrice: lingxiPrice.value,
      lingxiPerRefine: lingxiPerRefine.value,
      lingxiRefineCost: lingxiRefineCost.value,
    },
  }),
)

// ===== 自动保存：任一输入变化即写入 localStorage =====
watch(
  [
    level, fitness, regimen,
    capPhysical, capVitality, recoverPhysical, recoverVitality,
    pCur, pTgt, vCur, vTgt,
    pointCardPrice, liangcaoPrice, baishouQuality, baishouPrice, haimaPrice,
    jushenPrice, talismanLevel, talismanPrice, pointCardPerHour, liangcaoPerHour,
    lingxiPrice, lingxiPerRefine, lingxiRefineCost,
  ],
  () => {
    try {
      const data: VitalityPersist = {
        version: LS_VERSION,
        level: level.value,
        fitness: fitness.value,
        regimen: regimen.value,
        capPhysical: capPhysical.value,
        capVitality: capVitality.value,
        recoverPhysical: recoverPhysical.value,
        recoverVitality: recoverVitality.value,
        pCur: pCur.value,
        pTgt: pTgt.value,
        vCur: vCur.value,
        vTgt: vTgt.value,
        pointCardPrice: pointCardPrice.value,
        liangcaoPrice: liangcaoPrice.value,
        baishouQuality: baishouQuality.value,
        baishouPrice: baishouPrice.value,
        haimaPrice: haimaPrice.value,
        jushenPrice: jushenPrice.value,
        talismanLevel: talismanLevel.value,
        talismanPrice: talismanPrice.value,
        pointCardPerHour: pointCardPerHour.value,
        liangcaoPerHour: liangcaoPerHour.value,
        lingxiPrice: lingxiPrice.value,
        lingxiPerRefine: lingxiPerRefine.value,
        lingxiRefineCost: lingxiRefineCost.value,
      }
      localStorage.setItem(LS_KEY, JSON.stringify(data))
    } catch {
      // 隐私模式 / 配额不足等：静默降级为不持久化，不影响计算
    }
  },
  { immediate: true },
)

const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
</script>

<template>
  <div class="vt-wrap">
    <!-- 基础配置：角色基础 → 自动恢复 -->
    <div class="vt-config card">
      <div class="vt-row">
        <label class="vt-field">
          <span>人物等级</span>
          <input type="number" v-model.number="level" :min="0" step="1" />
        </label>
        <label class="vt-field">
          <span>健身术（体力）</span>
          <input type="number" v-model.number="fitness" :min="0" step="1" />
        </label>
        <label class="vt-field">
          <span>养生术（活力）</span>
          <input type="number" v-model.number="regimen" :min="0" step="1" />
        </label>
      </div>
      <div class="vt-auto">
        <span>体力上限 <b class="vt-num">{{ capPhysical }}</b></span>
        <span>体力每5分钟 <b class="vt-num">{{ recoverPhysical }}</b></span>
        <span>活力上限 <b class="vt-num">{{ capVitality }}</b></span>
        <span>活力每5分钟 <b class="vt-num">{{ recoverVitality }}</b></span>
      </div>
      <div class="vt-hint-row">
        <p class="vt-hint">
          上限 = 等级×5+50 + 技能×4；每5分钟恢复 = floor(上限×1%) + floor(等级×2%) + 2（官方公式）。
          下方上限/恢复可直接改以覆盖自动值。
        </p>
        <div class="vt-save">
          <span class="vt-saved">已自动保存到本机</span>
        </div>
      </div>
    </div>

    <!-- 恢复时间 -->
    <div class="vt-recov-grid">
      <div class="vt-recov card">
        <div class="vt-recov-title">体力恢复</div>
        <div class="vt-recov-inputs">
          <label class="vt-mini"><span>当前</span><input type="number" v-model.number="pCur" :min="0" step="1" /></label>
          <label class="vt-mini"><span>目标</span><input type="number" v-model.number="pTgt" :min="0" step="1" /></label>
          <label class="vt-mini"><span>上限</span><input type="number" v-model.number="capPhysical" :min="0" step="1" /></label>
        </div>
        <div class="vt-recov-result">
          <template v-if="res.physical.minutes > 0">
            需在线 <b class="vt-big">{{ res.physical.minutes }}</b> 分钟（约 {{ res.physical.hours }} 小时）
          </template>
          <template v-else><b class="vt-big ok">{{ res.physical.message }}</b></template>
        </div>
        <div class="vt-recov-foot" v-if="res.physical.message && res.physical.minutes > 0">{{ res.physical.message }}</div>
      </div>
      <div class="vt-recov card">
        <div class="vt-recov-title">活力恢复</div>
        <div class="vt-recov-inputs">
          <label class="vt-mini"><span>当前</span><input type="number" v-model.number="vCur" :min="0" step="1" /></label>
          <label class="vt-mini"><span>目标</span><input type="number" v-model.number="vTgt" :min="0" step="1" /></label>
          <label class="vt-mini"><span>上限</span><input type="number" v-model.number="capVitality" :min="0" step="1" /></label>
        </div>
        <div class="vt-recov-result">
          <template v-if="res.vitality.minutes > 0">
            需在线 <b class="vt-big">{{ res.vitality.minutes }}</b> 分钟（约 {{ res.vitality.hours }} 小时）
          </template>
          <template v-else><b class="vt-big ok">{{ res.vitality.message }}</b></template>
        </div>
        <div class="vt-recov-foot" v-if="res.vitality.message && res.vitality.minutes > 0">{{ res.vitality.message }}</div>
      </div>
    </div>

    <!-- 使用方案收益对比 -->
    <div class="vt-plans card">
      <div class="vt-plans-head">
        使用方案收益对比（按每小时银两降序）
        <span class="vt-badge-phys">高亮</span> 为体力最优、
        <span class="vt-badge-vit">高亮</span> 为活力最优（两者同时恢复，可同时进行）
        <span class="vt-plans-sub">
          本表只列【体活变现】方式，全部自动派生（标「自动」）：随上方恢复速率与下方单价联动。
          挂机万界通廊（粮草）不消耗体活，属另一维度，见下方「收益分析·粮草挂机」。
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>方案</th><th>消耗</th>
            <th class="c-num">每小时银两<br />（万）</th>
            <th class="c-num">每小时储备金<br />（万）</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in res.plans"
            :key="p.key"
            :class="{
              'vt-best-phys': p.key === res.bestPhysicalKey,
              'vt-best-vit': p.key === res.bestVitalityKey,
            }"
          >
            <td class="vt-pname">
              {{ p.label }}
              <span v-if="p.key === res.bestPhysicalKey" class="vt-badge-phys">体力最优</span>
              <span v-else-if="p.key === res.bestVitalityKey" class="vt-badge-vit">活力最优</span>
            </td>
            <td class="vt-res">{{ p.resource }}</td>
            <td class="c-num">
              <template v-if="p.derive">
                <span class="vt-auto-val">{{ fmt(p.silverPerHour) }}</span>
                <span class="vt-auto-tag">自动</span>
              </template>
              <input v-else class="vt-rate" type="number" v-model.number="rates[p.key].silver" :min="0" step="0.1" />
            </td>
            <td class="c-num">
              <template v-if="p.derive"><span class="vt-auto-val">{{ fmt(p.reservePerHour) }}</span></template>
              <input v-else class="vt-rate" type="number" v-model.number="rates[p.key].reserve" :min="0" step="0.1" />
            </td>
            <td class="vt-note">{{ p.note }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 收益分析 -->
    <div class="vt-profit">
      <div class="vt-plans-head">收益分析（基于上方自动恢复速率与下方单价）</div>

      <!-- 单价配置 -->
      <div class="vt-rates card">
        <label class="vt-mini"><span>聚神瓶售价<br />（万/个）</span><input class="vt-rate" type="number" v-model.number="jushenPrice" :min="0" step="0.1" /></label>
        <label class="vt-mini"><span>临时符等级</span><input class="vt-rate" type="number" v-model.number="talismanLevel" :min="0" step="1" /></label>
        <label class="vt-mini"><span>临时符售价<br />（万/张）</span><input class="vt-rate" type="number" v-model.number="talismanPrice" :min="0" step="0.01" /></label>
        <label class="vt-mini"><span>灵犀之屑售价<br />（万/个）</span><input class="vt-rate" type="number" v-model.number="lingxiPrice" :min="0" step="0.5" /></label>
        <label class="vt-mini"><span>每次炼制产出<br />（个/次）</span><input class="vt-rate" type="number" v-model.number="lingxiPerRefine" :min="0" step="0.01" /></label>
        <label class="vt-mini"><span>每次炼制银两<br />（万/次）</span><input class="vt-rate" type="number" v-model.number="lingxiRefineCost" :min="0" step="1" /></label>
        <span class="vt-hint">
          聚神瓶按七十二变换算≈1330体力/瓶（含合成10体力）；临时符每符耗活力=等级。
          灵犀之屑 =（售价 × 每次产出 − 每次炼制银两）÷ 800体力/次（官方：800体力+42万/次，保底1个、实测均值1.36个）。
          书店打工为官方固定汇率：40体力 → 3000两现金 或 3750两储备金（二选一）。
          点卡按梦幻标准计费固定 6 点/小时、粮草固定 20 个/小时（3分钟1个），均为常量不占界面。按本区物价校正。
        </span>
      </div>

      <!-- 块1：在线保点卡 -->
      <div class="vt-block card">
        <div class="vt-block-title">人物在线保点卡</div>
        <label class="vt-mini"><span>每点点卡价格（万）× {{ pointCardPerHour }}点/时</span><input class="vt-rate" type="number" v-model.number="pointCardPrice" :min="0" step="0.01" /></label>
        <div class="vt-block-body">
          <div class="vt-line">体力收入（聚神瓶）<b class="vt-num">{{ fmt(res.profit.pointCard.physicalIncome) }}</b> 万</div>
          <div class="vt-line">活力收入（临时符）<b class="vt-num">{{ fmt(res.profit.pointCard.vitalityIncome) }}</b> 万</div>
          <div class="vt-line">每小时在线花费<b class="vt-num">{{ fmt(res.profit.pointCard.cost) }}</b> 万</div>
          <div class="vt-line vt-total">总收入<b class="vt-num">{{ fmt(res.profit.pointCard.totalIncome) }}</b> 万</div>
          <div class="vt-verdict" :class="res.profit.pointCard.profitable ? 'win' : 'lose'">
            {{ res.profit.pointCard.profitable ? '赚了' : '亏了' }} {{ fmt(Math.abs(res.profit.pointCard.net)) }} 万/小时
          </div>
        </div>
      </div>

      <!-- 块2：粮草挂机（万界通廊，挂机期间体活不恢复） -->
      <div class="vt-block card">
        <div class="vt-block-title">粮草挂机是否赚（万界通廊）</div>
        <label class="vt-mini"><span>粮草摆摊价格（万/个）</span><input class="vt-rate" type="number" v-model.number="liangcaoPrice" :min="0" step="0.01" /></label>
        <div class="vt-block-body">
          <div class="vt-line">粮草收入（{{ liangcaoPerHour }}个/时 · 3分钟1个）<b class="vt-num">{{ fmt(res.profit.liangcao.extraIncome) }}</b> 万</div>
          <div class="vt-line">体活收入<b class="vt-num">0.00</b> 万</div>
          <div class="vt-tip">挂机万界通廊期间体力/活力不恢复，故本项不计体活变现收入</div>
          <div class="vt-line">每小时在线花费<b class="vt-num">{{ fmt(res.profit.liangcao.cost) }}</b> 万</div>
          <div class="vt-line vt-total">总收入<b class="vt-num">{{ fmt(res.profit.liangcao.totalIncome) }}</b> 万</div>
          <div class="vt-verdict" :class="res.profit.liangcao.profitable ? 'win' : 'lose'">
            {{ res.profit.liangcao.profitable ? '赚了' : '亏了' }} {{ fmt(Math.abs(res.profit.liangcao.net)) }} 万/小时
          </div>
        </div>
      </div>

      <!-- 块3：吃百岁香 -->
      <div class="vt-block card">
        <div class="vt-block-title">吃百岁香是否赚</div>
        <div class="vt-block-inputs">
          <label class="vt-mini"><span>百岁香品质</span><input class="vt-rate" type="number" v-model.number="baishouQuality" :min="0" step="1" /></label>
          <label class="vt-mini"><span>百岁香价格（万）</span><input class="vt-rate" type="number" v-model.number="baishouPrice" :min="0" step="0.1" /></label>
        </div>
        <div class="vt-block-body">
          <div class="vt-line">恢复体力+活力<b class="vt-num">{{ baishouQuality * 2 + 150 }}</b> 点</div>
          <div class="vt-line">体力收入（聚神瓶）<b class="vt-num">{{ fmt(res.profit.baishou.physicalIncome) }}</b> 万</div>
          <div class="vt-line">活力收入（临时符）<b class="vt-num">{{ fmt(res.profit.baishou.vitalityIncome) }}</b> 万</div>
          <div class="vt-line vt-total">总收入<b class="vt-num">{{ fmt(res.profit.baishou.totalIncome) }}</b> 万</div>
          <div class="vt-verdict" :class="res.profit.baishou.profitable ? 'win' : 'lose'">
            {{ res.profit.baishou.profitable ? '赚了' : '亏了' }} {{ fmt(Math.abs(res.profit.baishou.net)) }} 万
          </div>
        </div>
      </div>

      <!-- 块4：吃海马 -->
      <div class="vt-block card">
        <div class="vt-block-title">吃海马是否赚</div>
        <label class="vt-mini"><span>海马价格（万）</span><input class="vt-rate" type="number" v-model.number="haimaPrice" :min="0" step="0.1" /></label>
        <div class="vt-block-body">
          <div class="vt-line">体力获得（含+50与3小时）<b class="vt-num">{{ 50 + 36 * recoverPhysical }}</b> 点</div>
          <div class="vt-line">活力获得（含+50与3小时）<b class="vt-num">{{ 50 + 36 * recoverVitality }}</b> 点</div>
          <div class="vt-line">体力收入（聚神瓶）<b class="vt-num">{{ fmt(res.profit.haima.physicalIncome) }}</b> 万</div>
          <div class="vt-line">活力收入（临时符）<b class="vt-num">{{ fmt(res.profit.haima.vitalityIncome) }}</b> 万</div>
          <div class="vt-line vt-total">总收入<b class="vt-num">{{ fmt(res.profit.haima.totalIncome) }}</b> 万</div>
          <div class="vt-verdict" :class="res.profit.haima.profitable ? 'win' : 'lose'">
            {{ res.profit.haima.profitable ? '赚了' : '亏了' }} {{ fmt(Math.abs(res.profit.haima.net)) }} 万
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vt-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.vt-wrap table,
.vt-big,
.vt-num {
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, 'Courier New', 'PingFang SC', monospace;
  font-variant-numeric: tabular-nums;
}
.vt-config {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.vt-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.vt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 16px;
  color: var(--color-text-muted);
}
.vt-field input {
  width: 140px;
  padding: 11px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 19px;
  font-weight: 600;
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, 'Courier New', 'PingFang SC', monospace;
  font-variant-numeric: tabular-nums;
}
.vt-auto {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-top: 16px;
  font-size: 15.5px;
  color: var(--color-text-muted);
}
.vt-auto b {
  color: var(--color-primary);
  font-weight: 700;
  margin-left: 4px;
  font-size: 19px;
}
.vt-hint {
  margin-top: 12px;
  font-size: 13.5px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
.vt-hint-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.vt-save {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  flex-shrink: 0;
}
.vt-saved {
  font-size: 12.5px;
  color: var(--color-success);
}
.vt-tip {
  margin-top: 6px;
  font-size: 13px;
  color: #e0a34a;
  line-height: 1.5;
}
.vt-recov-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.vt-recov {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.vt-recov-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 12px;
}
.vt-recov-inputs {
  display: flex;
  gap: 12px;
}
.vt-mini {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 14px;
  color: var(--color-text-muted);
}
.vt-mini input {
  width: 100px;
  padding: 9px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 15.5px;
}
/* 恢复卡片的「当前/目标/上限」：数字放大、等宽对齐，便于快速读数 */
.vt-recov-inputs .vt-mini {
  flex: 1;
  min-width: 0;
  font-size: 16px;
}
.vt-recov-inputs .vt-mini input {
  width: 100%;
  padding: 11px 12px;
  font-size: 19px;
  font-weight: 600;
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, 'Courier New', 'PingFang SC', monospace;
  font-variant-numeric: tabular-nums;
}
.vt-recov-result {
  margin-top: 16px;
  font-size: 17px;
  color: var(--color-text);
}
.vt-big {
  font-size: 30px;
  font-weight: 700;
  color: var(--color-primary);
}
.vt-big.ok {
  font-size: 16px;
  color: var(--color-success);
}
.vt-recov-foot {
  margin-top: 8px;
  font-size: 13.5px;
  color: var(--color-warning);
}
.vt-plans {
  background: var(--bg-panel);
  padding: 0;
  overflow: hidden;
}
.vt-plans-head {
  padding: 14px 16px;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--border-color);
}
.vt-plans-sub {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-muted);
}
.vt-badge-phys,
.vt-badge-vit {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: 4px;
  vertical-align: middle;
}
.vt-badge-phys {
  color: #e0a34a;
  background: rgba(224, 163, 74, 0.18);
}
.vt-badge-vit {
  color: var(--color-success);
  background: rgba(67, 160, 71, 0.18);
}
.vt-plans table {
  width: 100%;
  border-collapse: collapse;
}
.vt-plans th,
.vt-plans td {
  padding: 12px 14px;
  text-align: left;
  font-size: 14.5px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}
.vt-plans thead th {
  color: var(--color-text-muted);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.02);
}
.vt-plans tbody tr:last-child td {
  border-bottom: none;
}
.vt-plans tbody tr.vt-best-phys {
  background: rgba(224, 163, 74, 0.14);
  box-shadow: inset 3px 0 0 #e0a34a;
}
.vt-plans tbody tr.vt-best-vit {
  background: rgba(67, 160, 71, 0.14);
  box-shadow: inset 3px 0 0 var(--color-success);
}
.vt-pname {
  font-weight: 600;
  color: var(--color-text);
}
.vt-res {
  color: var(--color-text-muted);
}
.vt-rate {
  width: 100px;
  padding: 7px 9px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  color: var(--color-text);
  font-size: 15px;
  text-align: right;
}
.vt-auto-val {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-primary);
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, 'Courier New', 'PingFang SC', monospace;
  font-variant-numeric: tabular-nums;
}
.vt-auto-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-success);
  background: rgba(67, 160, 71, 0.16);
  border-radius: 4px;
  vertical-align: middle;
}
.vt-note {
  font-size: 13.5px;
  color: var(--color-text-muted);
}
.vt-profit {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.vt-rates {
  background: var(--bg-panel);
  padding: 14px 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
}
.vt-rates .vt-mini input {
  width: 108px;
}
.vt-block {
  background: var(--bg-panel);
  padding: 16px 18px;
}
.vt-block-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-secondary);
  margin-bottom: 10px;
}
.vt-block-inputs {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
}
.vt-block-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vt-line {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  color: var(--color-text);
  padding: 5px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
}
.vt-line b {
  color: var(--color-text);
  font-weight: 600;
}
.vt-line.vt-total {
  border-bottom: none;
  font-weight: 600;
}
.vt-line.vt-total b {
  color: var(--color-primary);
}
.vt-verdict {
  margin-top: 10px;
  font-size: 16px;
  font-weight: 700;
  padding: 9px 12px;
  border-radius: 6px;
  text-align: center;
}
.vt-verdict.win {
  background: rgba(67, 160, 71, 0.16);
  color: var(--color-success);
}
.vt-verdict.lose {
  background: rgba(244, 63, 94, 0.14);
  color: var(--color-danger);
}
@media (max-width: 640px) {
  .vt-recov-grid {
    grid-template-columns: 1fr;
  }
}
</style>
