<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getCalc } from '@/calculators/data/calcs'
import { usePriceStore } from '@/stores/priceStore'
import { compute, inputMaxLevel, type CalcInput, type CalcResult } from '@/calculators/services/calcEngine'
import { resolveCalc, hasOverride } from '@/calculators/services/calcOverride'
import type { LevelModel, SynthesisDef, LevelCostDef, AnimalSetDef, FixedDamageDef, FixedDamageWeaponDef, SpeedChaosDef, VitalityDef } from '@/calculators/engine/types'
import PriceBar from '@/calculators/components/PriceBar.vue'
import LevelInput from '@/calculators/components/LevelInput.vue'
import CostTable from '@/calculators/components/CostTable.vue'
import SynthesisLadder from '@/calculators/components/SynthesisLadder.vue'
import SkillLevels from '@/calculators/components/SkillLevels.vue'
import AnimalSetView from '@/calculators/components/AnimalSetView.vue'
import FixedDamageView from '@/calculators/components/FixedDamageView.vue'
import FdWeaponView from '@/calculators/components/FdWeaponView.vue'
import SpeedChaosView from '@/calculators/components/SpeedChaosView.vue'
import VitalityView from '@/calculators/components/VitalityView.vue'
import HelpDrawer from '@/components/common/HelpDrawer.vue'

const route = useRoute()
const store = usePriceStore()

const calc = computed(() => {
  const base = getCalc(route.params.id as string)
  return base ? resolveCalc(base) : undefined
})
const overrideActive = computed(() => (calc.value ? hasOverride(calc.value.id) : false))

const model = ref<LevelModel>({ from: 0, to: 0, count: 1 })
const matPrice = ref(0)
const fruitPrice = ref(80)
// 多技能分别计算（师门技能）：每 slot 独立区间
const skillLevels = ref<Record<string, { from: number; to: number }>>({})

const isMultiEntry = computed(
  () => calc.value?.type === 'levelcost' && !!(calc.value as LevelCostDef).multiEntry,
)
const isAnimalSet = computed(() => calc.value?.type === 'animalset')
const isFixedDamage = computed(() => calc.value?.type === 'fixeddamage')
const isFdWeapon = computed(() => calc.value?.type === 'fdweapon')
const isSpeedChaos = computed(() => calc.value?.type === 'speedchaos')
const isVitality = computed(() => calc.value?.type === 'vitality')

const minLv = computed(() => {
  const c = calc.value
  if (!c) return 0
  if (c.type === 'synthesis') return 1
  if (c.type === 'levelcost') return c.minLevel
  return 0
})
const maxLv = computed(() => (calc.value ? inputMaxLevel(calc.value) : 0))

// 切换计算器时按类型重置默认值
watch(
  calc,
  (c) => {
    if (!c) return
    const mn = c.type === 'synthesis' ? 1 : c.type === 'levelcost' ? c.minLevel : 0
    const defTo = c.type === 'synthesis' ? inputMaxLevel(c) : Math.min(mn + 1, inputMaxLevel(c))
    model.value = { from: mn, to: defTo, count: 1 }
    if (c.type === 'synthesis') {
      matPrice.value = c.defaultMatPriceWan
    } else if (c.type === 'levelcost') {
      const fp = c.extraInputs?.find((e) => e.key === 'fruitPrice')
      if (fp) fruitPrice.value = fp.default
    }
    // 多技能：按 slots 初始化各技能区间（默认 0 → 表上限，便于直接看到单项成本）
    if (c.type === 'levelcost' && (c as LevelCostDef).multiEntry) {
      const init: Record<string, { from: number; to: number }> = {}
      const top = inputMaxLevel(c)
      for (const s of (c as LevelCostDef).slots) init[s.key] = { from: mn, to: s.maxLevel ?? top }
      skillLevels.value = init
    }
  },
  { immediate: true },
)

function onSkillUpdate(key: string, part: 'from' | 'to', val: number) {
  skillLevels.value = {
    ...skillLevels.value,
    [key]: { ...skillLevels.value[key], [part]: val },
  }
}

const result = computed<CalcResult>(() => {
  const c = calc.value
  if (!c) {
    return { type: 'levelcost', valid: false, errorMessage: '未找到该计算器', totalWan: 0, totalRMB: 0, perSlot: [] }
  }
  const input: CalcInput = {
    fromLevel: model.value.from,
    toLevel: model.value.to,
    count: model.value.count,
    matPriceWan: c.type === 'synthesis' ? matPrice.value : undefined,
    fruitPrice: c.type === 'levelcost' ? fruitPrice.value : undefined,
    slotLevels: isMultiEntry.value ? skillLevels.value : undefined,
  }
  return compute(c, input, store.goldPrice, store.discount)
})

const fruitDef = computed(() => calc.value?.type === 'levelcost' ? calc.value.extraInputs?.find((e) => e.key === 'fruitPrice') : undefined)

// 使用说明抽屉：仅当对应计算器在 HELP_DATA 注册了文案时才显示
const hasHelp = computed(() => calc.value?.type === 'synthesis' && !!(window as any).HELP_DATA?.[calc.value.id])
</script>

<template>
  <div class="calc-view" v-if="calc">
    <header class="cv-header">
      <h1>{{ calc.name }}</h1>
      <small v-if="overrideActive" class="cv-ov-chip">📝 本地录入已生效</small>
    </header>

    <PriceBar v-if="!isAnimalSet && !isFixedDamage && !isFdWeapon && !isSpeedChaos && !isVitality" :show-discount="calc.type !== 'synthesis'" />

    <!-- 召唤兽修炼：修炼果单价（影响全部行，置于表格之前） -->
    <div class="cv-extra card" v-if="calc.type === 'levelcost' && fruitDef">
      <label class="cv-extra-field">
        <span>{{ fruitDef.label }}（{{ fruitDef.unit }}）</span>
        <input type="number" v-model.number="fruitPrice" min="0" step="1" />
      </label>
    </div>

    <!-- 动物套选择（选择器类，独立于合成/养成）：输入等级 → 按加成排序推荐 -->
    <AnimalSetView v-if="isAnimalSet" :def="(calc as AnimalSetDef)" :key="calc.id" />

    <!-- 固伤加成换算（独立于合成/养成）：选门派 + 输入各项加伤项 → 主秒/副秒 -->
    <FixedDamageView v-if="isFixedDamage" :def="(calc as FixedDamageDef)" :key="calc.id" />

    <!-- 固伤武器副秒计算及性价比对比（独立于合成/养成）：选门派 + 录入多把武器 → 排名 -->
    <FdWeaponView v-if="isFdWeapon" :def="(calc as FixedDamageWeaponDef)" :key="calc.id" />

    <!-- 乱敏（速度波动）概率分析（独立于合成/养成）：须弥面板速度 + 天阵开关 → 波动范围 + 梯队要求 -->
    <SpeedChaosView v-if="isSpeedChaos" :def="(calc as SpeedChaosDef)" :key="calc.id" />

    <!-- 体活计算（体力活力收益）：恢复时间 + 使用方案收益对比 -->
    <VitalityView v-if="isVitality" :def="(calc as VitalityDef)" :key="calc.id" />

    <!-- 多技能分别计算（师门技能）：每技能独立设级 + 同屏成本汇总 -->
    <SkillLevels
      v-if="isMultiEntry"
      :slots="(calc as LevelCostDef).slots"
      :levels="skillLevels"
      :min="minLv"
      :max="maxLv"
      :title="calc.name"
      :result="result"
      :show-fruit="!!(calc as LevelCostDef).showFruit"
      @update="onSkillUpdate"
    />

    <!-- 养成类（非多技能）：起始/目标等级 + 数量 -->
    <LevelInput v-else-if="calc.type === 'levelcost'" v-model="model" :min="minLv" :max="maxLv" />

    <!-- 合成类：1级材料价格 -->
    <div class="cv-extra card" v-if="calc.type === 'synthesis'">
      <label class="cv-extra-field">
        <span>1级{{ calc.unit }}价格（万梦幻币）</span>
        <input type="number" v-model.number="matPrice" min="0" step="1" />
      </label>
    </div>

    <!-- 养成类（非多技能）：逐槽汇总表 -->
    <CostTable v-if="calc.type === 'levelcost' && !isMultiEntry" :result="result" />

    <!-- 合成类：全阶梯表（1→N 全部展开） -->
    <!-- 注意：必须显式判定 synthesis，不能用 v-else —— 多技能养成类（师门/帮派/人物修炼/
         召唤兽修炼）不渲染 CostTable，若用 v-else 会把 LevelCostDef 当合成表渲染并崩溃 -->
    <SynthesisLadder
      v-else-if="calc.type === 'synthesis'"
      :def="(calc as SynthesisDef)"
      :mat-price-wan="matPrice"
      :gold-price="store.goldPrice"
      :discount="store.discount"
    />

    <!-- 合成类：抽屉式「使用说明」（对齐抓鬼助手 HelpDrawer；gem/starlight 已在 help-data.js 注册） -->
    <HelpDrawer v-if="hasHelp" :module-key="calc.id" />
  </div>

  <div class="calc-view" v-else>
    <div class="cv-notfound">未找到该计算器（{{ route.params.id }}）</div>
  </div>
</template>

<style scoped>
.calc-view {
  max-width: 1440px;
  margin: 0 auto;
  padding: 16px 20px;
}
.cv-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.cv-header h1 {
  font-size: 22px;
  color: var(--color-primary);
}
.cv-ov-chip {
  font-size: 11px;
  color: var(--color-success);
  align-self: center;
}
.cv-extra {
  background: var(--bg-panel);
}
.cv-extra-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.cv-extra-field input {
  width: 200px;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
}
.cv-notfound {
  color: var(--color-warning);
  font-size: 15px;
  padding: 20px 0;
}
</style>
