// 计算器统一计算引擎
// 输入一个计算器定义（合成 / 等级消耗）与用户输入，返回每项消耗、合计梦幻币与人民币。
// 金价与折扣来自 priceStore（goldPrice: 元/3000万梦幻币，discount: 1=无折扣）。

import type { CalcDef, SynthesisDef, LevelCostDef, AnimalSetDef, AnimalAttr, FixedDamageDef, FixedDamageItem, FixedDamageWeaponDef, SpeedChaosDef, VitalityDef } from '../engine/types'
import {
  POINTS_PER_JUSHEN_PING,
  POINTS_PER_LINGXI,
  BOOKSTORE_POINTS_PER_TIME,
  BOOKSTORE_SILVER_WAN,
  BOOKSTORE_RESERVE_WAN,
} from '../engine/types'
import { wanToRMB } from '../engine/money'

export interface CalcInput {
  fromLevel: number
  toLevel: number
  count: number
  matPriceWan?: number // 合成类：1级材料单价（万）
  fruitPrice?: number // 等级消耗类（召唤兽修炼）：修炼果单价（万）
  // 多技能分别计算（如师门技能）：每个 slot 独立等级区间，key 为 slot.key。
  // 存在时覆盖共享 fromLevel/toLevel，且不计份数（每份各算一次，slotMult=1）。
  slotLevels?: Record<string, { from: number; to: number }>
  // 动物套选择类：三件套 / 五件套（影响加成与触发几率的列显示）
  pieces?: 3 | 5
}

// 单路径区间总经验（表/公式驱动），用于 totalExp 与修炼果折算（与旧逻辑一致：基于「单份」而非多槽求和）
function rangeExp(def: LevelCostDef, from: number, to: number): number {
  let exp = 0
  if (def.mode === 'formula' && def.expOf) {
    for (let n = from + 1; n <= to; n++) exp += def.expOf(n)
  } else if (def.mode === 'table' && def.table) {
    for (let i = from; i < to; i++) {
      const row = def.table[i]
      if (row) exp += row[0]
    }
  }
  return exp
}

export interface SlotResult {
  key: string
  label: string
  exp?: number // 本级路径所需总经验（单份）
  moneyWan: number // 该槽合计梦幻币（已乘数量）
  rmb: number // 该槽合计人民币
  fruitCount?: number // 修炼果个数（召唤兽修炼等，经验/150）
}

export interface AnimalSetRow {
  name: string
  attr: AnimalAttr
  bonus: number // 当前所选件数（三件/五件）下的属性加成
  threeBonus: number // 三件套加成
  fiveBonus: number // 五件套加成
  skill: string
  impact: '正' | '负' | '无'
  tier: 1 | 2 | '超1'
  threeRate: number
  fiveRate: number
}

export interface CalcResult {
  type: 'synthesis' | 'levelcost' | 'animalset' | 'fixeddamage' | 'fdweapon' | 'speedchaos' | 'vitality'
  valid: boolean
  errorMessage?: string
  totalWan: number
  totalRMB: number
  // 合成类
  materialsWan?: number
  feeWan?: number
  availableMaxLevel?: number // 合成类数据实际收录到的最高等级
  // 等级消耗类
  totalExp?: number // 单份路径总经验
  fruitCount?: number // 单份路径所需修炼果数
  perSlot: SlotResult[]
  // 动物套选择类
  animalRows?: AnimalSetRow[]
  // 固伤加成换算类
  fixedDamage?: FixedDamageResult
  // 固伤武器副秒性价比对比类
  fdWeapon?: FixedDamageWeaponResult
  // 乱敏（速度波动）概率分析类
  speedChaos?: SpeedChaosResult
}

export interface SpeedTierRow {
  pos: number // 速度梯队：1=最快 1速，5=最慢 5速
  label: string // '5速' / '4速' / ... / '1速'
  requiredPanel: number // 要求面板速度不低于（一定比下一梯队快）
  afterArray: number // 天阵减少后速度（不开天阵时 = 面板速度）
  minBattle: number // 战斗时速度波动下限
  maxBattle: number // 战斗时速度波动上限
}

export interface SpeedChaosResult {
  panel: number // 最高速须弥面板速度
  battleMin: number // 须弥战斗速度下限（乱敏）
  battleMax: number // 须弥战斗速度上限（乱敏）
  tianArray: boolean // 是否开天阵模式
  tiers: SpeedTierRow[] // 5速→1速 各梯队要求
}

export interface FixedDamageRow {
  key: FixedDamageItem
  label: string
  main: number // 该加伤项对主秒的加成
  sub: number // 该加伤项对副秒的加成
}

export interface FixedDamageResult {
  sectId: string
  sectName: string
  mainHit: number // 主秒总加成
  subHit: number // 副秒总加成
  rows: FixedDamageRow[]
}

export interface FixedDamageWeaponRow {
  name: string
  damage: number
  agility: number
  price: number
  mainHit: number // 主秒加成
  subHit: number // 副秒加成
  mainPerYuan: number // 每元主秒
  subPerYuan: number // 每元副秒
  rank: number // 性价比排名（按每元副秒降序）
}

export interface FixedDamageWeaponResult {
  sectName: string
  rows: FixedDamageWeaponRow[]
}

// 体活计算（体力活力）：恢复时间 + 使用方案收益对比
export interface VitalityRecoveryResult {
  resource: '体力' | '活力'
  current: number // 当前值
  target: number // 目标值
  cap: number // 上限（参考，用于提示目标是否超上限）
  recoverPer5min: number // 每5分钟恢复量
  minutes: number // 需在线分钟（向上取整到5的倍数）
  hours: number // 需在线小时（minutes/60）
  valid: boolean
  message?: string // 校验/提示信息
}

export interface VitalityPlanRow {
  key: string
  label: string
  resource: '体力' | '活力' | '无'
  silverPerHour: number // 每小时银两（万）
  reservePerHour: number // 每小时储备金（万）
  note?: string
  derive?: 'jushen' | 'talisman' | 'lingxi' | 'bookstore' | 'liangcao' // 标记自动派生行（单价×恢复，与收益分析联动）
}

// 自动恢复计算结果（由等级+健身/养生推导）
export interface VitalityCapResult {
  capPhysical: number // 体力上限 = 等级×5+50 + 健身术×4
  capVitality: number // 活力上限 = 等级×5+50 + 养生术×4
  recoverPhysical: number // 体力每5分钟恢复 = floor(capPhysical×1%) + floor(等级×2%) + 2
  recoverVitality: number // 活力每5分钟恢复
}

// 单个收益块结果
export interface VitalityProfitItem {
  label: string
  physicalIncome: number // 体力变现收入（万，聚神瓶单价×体力点数）
  vitalityIncome: number // 活力变现收入（万，临时符单价×活力点数）
  extraIncome: number // 额外收入（万，如粮草）
  cost: number // 成本（万，点卡花费/道具价）
  totalIncome: number // 总收入（万）
  net: number // 净收益（万/小时 或 单次）
  profitable: boolean // 净>0
}

export interface VitalityResult {
  cap: VitalityCapResult // 自动算出的上限与每5分钟恢复
  physical: VitalityRecoveryResult // 体力恢复
  vitality: VitalityRecoveryResult // 活力恢复
  plans: VitalityPlanRow[] // 按每小时银两降序（最优在前）
  bestPlanKey: string // 每小时银两最高的方案 key（不分资源）
  // 体力与活力【同时恢复、可同时进行】，故按资源各取一个最优，用于分别高亮
  bestPhysicalKey: string // 体力类方案中每小时银两最高者
  bestVitalityKey: string // 活力类方案中每小时银两最高者
  profit: {
    pointCard: VitalityProfitItem // 人物在线保点卡
    liangcao: VitalityProfitItem // 粮草挂机
    baishou: VitalityProfitItem // 吃百岁香
    haima: VitalityProfitItem // 吃海马
  }
}

function invalid(type: CalcResult['type'], msg: string): CalcResult {
  return { type, valid: false, errorMessage: msg, totalWan: 0, totalRMB: 0, perSlot: [] }
}

// 合成类：rows 中 cumWan 为「升到该级」的累计合成费（万梦幻币）
function cumFeeAt(def: SynthesisDef, level: number): number {
  const r = def.rows.find((x) => x.level === level)
  return r ? r.cumWan : 0
}

function maxRowLevel(def: SynthesisDef): number {
  return def.rows.reduce((m, r) => Math.max(m, r.level), 0)
}

function computeSynthesis(
  def: SynthesisDef,
  input: CalcInput,
  goldPrice: number,
  discount: number
): CalcResult {
  const { fromLevel, toLevel, count, matPriceWan = def.defaultMatPriceWan } = input
  if (def.rows.length === 0) {
    return invalid('synthesis', '该合成表数据待录入，暂不可计算')
  }
  const avail = maxRowLevel(def)
  if (fromLevel < 1 || toLevel > avail) {
    return invalid('synthesis', `数据仅收录到 ${avail} 级，请输入 1~${avail} 之间的等级区间`)
  }
  if (toLevel <= fromLevel) {
    return invalid('synthesis', '目标等级需大于起始等级')
  }
  const mult = count > 0 ? count : 1

  // 升到 L 级需要 2^(L-1) 个 1级材料；已持有 from 级相当于 2^(from-1) 个，需补差额
  // 材料成本 = 升段过程中每一级「本级数量」之和，与「累计梦幻币」口径一致
  // （累计 = Σ 本级数量×单价 + Σ 合成费，本级数量即升到该级所耗 1级材料数，非 2^(to-1)-2^(from-1)）
  let materialsWan = 0
  for (let k = fromLevel + 1; k <= toLevel; k++) materialsWan += countAt(def, k) * matPriceWan
  const feeWan = cumFeeAt(def, toLevel) - cumFeeAt(def, fromLevel)

  const totalWan = (materialsWan + feeWan) * mult
  const totalRMB = wanToRMB(totalWan, goldPrice, discount)

  return {
    type: 'synthesis',
    valid: true,
    totalWan,
    totalRMB,
    materialsWan: materialsWan * mult,
    feeWan: feeWan * mult,
    availableMaxLevel: avail,
    perSlot: [
      {
        key: 'total',
        label: `${def.unit} ×${mult}`,
        moneyWan: totalWan,
        rmb: totalRMB,
      },
    ],
  }
}

function computeLevelCost(
  def: LevelCostDef,
  input: CalcInput,
  goldPrice: number,
  discount: number,
): CalcResult {
  const { fromLevel, toLevel, count } = input
  const hasSlotLevels = !!input.slotLevels && Object.keys(input.slotLevels).length > 0

  // 校验：多技能模式逐槽校验；单区间模式整体校验
  if (hasSlotLevels) {
    for (const slot of def.slots) {
      const lv = input.slotLevels![slot.key]
      if (!lv) continue
      const slotMax = slot.maxLevel ?? def.maxLevel
      if (lv.from < def.minLevel || lv.to > slotMax) {
        return invalid('levelcost', `「${slot.label}」数据仅收录到 ${slotMax} 级，请输入 ${def.minLevel}~${slotMax} 之间的等级区间`)
      }
    }
  } else {
    if (toLevel <= fromLevel) {
      return invalid('levelcost', '目标等级需大于起始等级')
    }
    if (fromLevel < def.minLevel || toLevel > def.maxLevel) {
      return invalid('levelcost', `等级区间需在 ${def.minLevel}~${def.maxLevel} 之间`)
    }
  }

  const mult = count > 0 ? count : 1

  // 召唤兽修炼等：显示「修炼果」个数（经验/150）。单区间模式按单路径经验；多技能模式逐槽累加。
  const showFruit = !!def.showFruit
  // 成本由 修炼果×单价 驱动时的单价（万/个），取用户输入或 extraInputs 默认值
  const fruitPrice =
    input.fruitPrice ?? def.extraInputs?.find((e) => e.key === 'fruitPrice')?.default ?? 80
  // totalExp / 修炼果数基于「单份路径」经验（非多槽求和），与旧逻辑一致
  const sharedExp = !hasSlotLevels ? rangeExp(def, fromLevel, toLevel) : 0
  let totalFruit = 0

  const perSlot: SlotResult[] = []
  let totalWan = 0
  for (const slot of def.slots) {
    // 该槽区间：多技能模式取各自 slotLevels；若该技能未指定区间则计 0（不回退到共享区间）
    let sFrom: number
    let sTo: number
    if (hasSlotLevels) {
      const lv = input.slotLevels?.[slot.key]
      if (!lv) {
        perSlot.push({ key: slot.key, label: slot.label, exp: 0, moneyWan: 0, rmb: 0 })
        continue
      }
      sFrom = lv.from
      sTo = lv.to
    } else {
      sFrom = fromLevel
      sTo = toLevel
    }
    if (sTo <= sFrom) {
      // 区间无效（如 0→0）计入 0 成本，便于合计
      perSlot.push({ key: slot.key, label: slot.label, exp: 0, moneyWan: 0, rmb: 0 })
      continue
    }

    // 单路径累计经验
    let exp = 0
    if (def.mode === 'formula' && def.expOf) {
      for (let n = sFrom + 1; n <= sTo; n++) exp += def.expOf(n)
    } else if (def.mode === 'table' && (slot.table ?? def.table)) {
      const t = (slot.table ?? def.table)!
      for (let i = sFrom; i < sTo; i++) {
        const row = t[i]
        if (row) exp += row[0]
      }
    }
    // 修炼果个数 = 经验 / 150（1修炼果 = 150经验）
    const slotFruit = exp / 150
    if (showFruit) totalFruit += slotFruit

    let perItemWan = 0
    if (def.costFromFruit) {
      // 召唤兽修炼：金币 = 修炼果个数 × 修炼果单价（估价表依赖1「按修炼果80万算金币」口径）
      perItemWan = slotFruit * fruitPrice
    } else if (slot.moneyRate != null) {
      perItemWan = exp * slot.moneyRate
    } else if (def.mode === 'table' && (slot.table ?? def.table)) {
      // 表驱动（师门/帮派/召唤兽修炼）：金钱单位为「两」，÷10000 得万
      const t = (slot.table ?? def.table)!
      let liang = 0
      for (let i = sFrom; i < sTo; i++) {
        const row = t[i]
        if (row) liang += row[1]
      }
      perItemWan = liang / 10000
    }
    // 多技能模式不计份数（每份各算一次）；单区间模式沿用 mult
    const slotMult = hasSlotLevels ? 1 : mult
    const slotWan = perItemWan * slotMult
    totalWan += slotWan
    perSlot.push({
      key: slot.key,
      label: slot.label,
      exp,
      moneyWan: slotWan,
      rmb: wanToRMB(slotWan, goldPrice, discount),
      fruitCount: showFruit ? slotFruit : undefined,
    })
  }

  const totalRMB = wanToRMB(totalWan, goldPrice, discount)
  return {
    type: 'levelcost',
    valid: true,
    totalWan,
    totalRMB,
    // 多技能模式不展示单路径经验/果数列；单区间模式保持旧语义
    totalExp: !hasSlotLevels ? sharedExp : undefined,
    fruitCount: showFruit ? (!hasSlotLevels ? sharedExp / 150 : totalFruit) : undefined,
    perSlot,
  }
}

// 动物套选择类：给定召唤兽等级与件数（三件/五件），按属性加成降序排序所有套装
export function computeAnimalSet(def: AnimalSetDef, level: number, pieces: 3 | 5 = 3): CalcResult {
  const lvl = Number.isFinite(level) && level > 0 ? Math.floor(level) : 0
  const rows: AnimalSetRow[] = def.sets
    .map((s) => {
      const threeBonus = Math.floor(lvl / s.divisor + s.base)
      const fiveBonus = Math.floor(lvl / s.divisor + s.fiveBase)
      return {
        name: s.name,
        attr: s.attr,
        threeBonus,
        fiveBonus,
        bonus: pieces === 3 ? threeBonus : fiveBonus,
        skill: s.skill,
        impact: s.impact,
        tier: s.tier,
        threeRate: s.threeRate,
        fiveRate: s.fiveRate,
      }
    })
    .sort((a, b) => b.bonus - a.bonus || a.name.localeCompare(b.name, 'zh'))
  return {
    type: 'animalset',
    valid: lvl > 0,
    errorMessage: lvl > 0 ? undefined : '请输入召唤兽等级（>0）',
    totalWan: 0,
    totalRMB: 0,
    perSlot: [],
    animalRows: rows,
  }
}

// 固伤加成换算：给定门派与各项加伤项数值，线性换算主秒/副秒固伤加成
export function computeFixedDamage(
  def: FixedDamageDef,
  sectId: string,
  inputs: Record<FixedDamageItem, number>,
): CalcResult {
  const sect = def.sects.find((s) => s.id === sectId) ?? def.sects[0]
  const items: { key: FixedDamageItem; label: string }[] = [
    { key: 'damage', label: '伤害' },
    { key: 'agility', label: '敏捷' },
    { key: 'magicCult', label: '法修' },
    { key: 'swordStone', label: '试剑石' },
    { key: 'meteor', label: '落星飞鸿' },
  ]
  let mainHit = 0
  let subHit = 0
  const rows: FixedDamageRow[] = items.map(({ key, label }) => {
    const [cm, cs] = sect.coeff[key]
    const v = Number.isFinite(inputs[key]) ? inputs[key] : 0
    const main = cm * v
    const sub = cs * v
    mainHit += main
    subHit += sub
    return { key, label, main, sub }
  })
  return {
    type: 'fixeddamage',
    valid: true,
    totalWan: 0,
    totalRMB: 0,
    perSlot: [],
    fixedDamage: { sectId: sect.id, sectName: sect.name, mainHit, subHit, rows },
  }
}

// 固伤武器副秒计算及性价比对比：给定门派与若干把武器（伤害/敏捷/价格），
// 按该门派系数算每把主秒/副秒加成，并按「每元副秒」降序排名（固伤门派最关心副秒）。
export function computeFdWeapon(
  def: FixedDamageWeaponDef,
  sectId: string,
  weapons: { damage: number; agility: number; price: number }[],
): CalcResult {
  const sect = def.sects.find((s) => s.id === sectId) ?? def.sects[0]
  const [dMain, dSub] = sect.coeff.damage
  const [aMain, aSub] = sect.coeff.agility
  const rows: FixedDamageWeaponRow[] = weapons.map((w, i) => {
    const damage = Number.isFinite(w.damage) ? w.damage : 0
    const agility = Number.isFinite(w.agility) ? w.agility : 0
    const price = Number.isFinite(w.price) ? w.price : 0
    const mainHit = damage * dMain + agility * aMain
    const subHit = damage * dSub + agility * aSub
    const mainPerYuan = price > 0 ? mainHit / price : 0
    const subPerYuan = price > 0 ? subHit / price : 0
    return {
      name: `武器${i + 1}`,
      damage,
      agility,
      price,
      mainHit,
      subHit,
      mainPerYuan,
      subPerYuan,
      rank: 0,
    }
  })
  // 性价比排名：按「每元副秒」降序（副秒是固伤门派最关心的指标）
  const ranked = [...rows].sort((a, b) => b.subPerYuan - a.subPerYuan)
  ranked.forEach((r, idx) => {
    r.rank = idx + 1
  })
  return {
    type: 'fdweapon',
    valid: true,
    totalWan: 0,
    totalRMB: 0,
    perSlot: [],
    fdWeapon: { sectName: sect.name, rows: ranked },
  }
}

// 乱敏（速度波动）概率分析：给定最高速须弥面板速度，计算其战斗速度波动范围，
// 并反推人物各速度梯队（5速→1速）在「开天阵/不开天阵」下的要求面板速度下限。
// 乱敏规则：战斗速度 = floor(面板 × [0.95, 1.05])；天阵：人物面板先 ×0.9（floor）再乱敏。
// 梯队要求：第 k 速的战斗下限必须 > 第 k+1 速的战斗上限；5速锚定须弥上限。
export function computeSpeedChaos(
  _def: SpeedChaosDef,
  panel: number,
  tianArray: boolean,
): CalcResult {
  const p = Number.isFinite(panel) ? Math.floor(panel) : 0
  if (p <= 0) {
    return {
      type: 'speedchaos',
      valid: false,
      errorMessage: '请输入最高速须弥的面板速度（>0）',
      totalWan: 0,
      totalRMB: 0,
      perSlot: [],
      speedChaos: { panel: p, battleMin: 0, battleMax: 0, tianArray, tiers: [] },
    }
  }
  const battleMin = Math.floor(p * 0.95)
  const battleMax = Math.floor(p * 1.05)

  // 反推「最小面板」使该梯队战斗下限一定大于 slowerMax（严格大于，确保一定更快）
  const minPanelFor = (slowerMax: number): number => {
    for (let panel = 1; ; panel++) {
      const after = tianArray ? Math.floor(panel * 0.9) : panel
      const minB = Math.floor(after * 0.95)
      if (minB > slowerMax) return panel
    }
  }

  // 梯队从最慢(5速)到最快(1速)依次反推；5速锚定须弥上限
  const tiers: SpeedTierRow[] = []
  let slowerMax = battleMax
  for (let pos = 5; pos >= 1; pos--) {
    const requiredPanel = minPanelFor(slowerMax)
    const after = tianArray ? Math.floor(requiredPanel * 0.9) : requiredPanel
    const minB = Math.floor(after * 0.95)
    const maxB = Math.floor(after * 1.05)
    tiers.push({
      pos,
      label: `${pos}速`,
      requiredPanel,
      afterArray: after,
      minBattle: minB,
      maxBattle: maxB,
    })
    slowerMax = maxB
  }

  return {
    type: 'speedchaos',
    valid: true,
    totalWan: 0,
    totalRMB: 0,
    perSlot: [],
    speedChaos: { panel: p, battleMin, battleMax, tianArray, tiers },
  }
}

// 乱敏判定（人兽/人人/兽兽）：给定低速单元与高速单元的面板速度及类型（人物/宝宝），
// 判断两者战斗时速度范围是否重叠（即低速单元是否可能因乱敏反超高速单元）。
// 规则：人物开天阵时面板先 ×0.9（floor）再乱敏；宝宝永不 ×0.9。两者战斗范围均为 floor(面板×[0.95,1.05])。
// 乱敏差值 = 低速单元战斗上限 − 高速单元战斗下限：>0 表示范围重叠（会乱敏），≤0 表示高速一定更快（不乱敏）。
export type ChaosUnitType = '人物' | '宝宝'

export interface ChaosUnit {
  panel: number
  type: ChaosUnitType
  after: number // 天阵减少后速度（宝宝 = 面板速度）
  min: number // 战斗时速度下限
  max: number // 战斗时速度上限
}

export interface ChaosCheckResult {
  low: ChaosUnit // 低速单元（面板速度较小）
  high: ChaosUnit // 高速单元（面板速度较大）
  isChaos: boolean // true = 范围重叠，会乱敏
  diff: number // 低速上限 − 高速下限；>0 即乱敏
}

export function computeChaosCheck(
  lowPanel: number,
  lowType: ChaosUnitType,
  highPanel: number,
  highType: ChaosUnitType,
  tianArray: boolean,
): ChaosCheckResult {
  const unit = (panel: number, type: ChaosUnitType): ChaosUnit => {
    const p = Number.isFinite(panel) ? Math.max(0, Math.floor(panel)) : 0
    const after = type === '人物' && tianArray ? Math.floor(p * 0.9) : p
    return { panel: p, type, after, min: Math.floor(after * 0.95), max: Math.floor(after * 1.05) }
  }
  const low = unit(lowPanel, lowType)
  const high = unit(highPanel, highType)
  const diff = low.max - high.min
  return { low, high, isChaos: diff > 0, diff }
}

// 体活计算（体力活力收益）：
// ① 恢复时间：给定资源(体力/活力)当前值、目标值、每5分钟恢复量，需在线分钟 = ceil((目标-当前)/每5分钟恢复) × 5。
//    当前≥目标 → 0 分钟（已满足）；目标>上限 → 提示超上限（仍按差值算，但给出警告）。
// ② 使用方案收益对比 + ③ 四块收益分析。
// 自动恢复由 等级/健身术/养生术 推导；手动覆盖（override）可选。
export interface VitalityInput {
  physicalCurrent: number
  physicalTarget: number
  vitalityCurrent: number
  vitalityTarget: number
  // 角色基础（用于自动推导上限与每5分钟恢复）
  level: number
  fitness: number // 健身术（体力）
  regimen: number // 养生术（活力）
  // 手动覆盖（可选）：填了则优先用覆盖值
  capPhysicalOverride?: number
  capVitalityOverride?: number
  recoverPhysicalOverride?: number
  recoverVitalityOverride?: number
  // 各方案每小时费率覆盖（key -> [银两, 储备金]），可选
  planRates?: Record<string, { silver: number; reserve: number }>
  // 收益块输入
  pointCardPrice: number // 每点点卡价格（万）
  liangcaoPrice: number // 粮草摆摊价格（万/个）
  baishouQuality: number // 百岁香品质
  baishouPrice: number // 百岁香价格（万）
  haimaPrice: number // 海马价格（万）
  // 单价覆盖（可选，按本区物价校正；用玩家可观测单位）
  profitOverride?: {
    pointCardPerHour?: number
    jushenPrice?: number // 聚神瓶售价（万/个）
    talismanLevel?: number // 临时符等级
    talismanPrice?: number // 临时符售价（万/张）
    liangcaoPerHour?: number
    lingxiPrice?: number // 灵犀之屑售价（万/个）
    lingxiPerRefine?: number // 每次炼制平均产出个数（保底1，默认1.36）
    lingxiRefineCost?: number // 每次炼制额外消耗梦幻币（万，官方42万；填0=不计）
  }
}

// 梦幻西游体活自动恢复公式（官方，已用样本验证）：
//   上限 = 等级×5+50 + 技能等级×4（健身→体力，养生→活力）
//   每5分钟恢复 = floor(上限×1%) + floor(等级×2%) + 2
function calcCap(level: number, skill: number): number {
  return level * 5 + 50 + skill * 4
}
function calcRecover(cap: number, level: number): number {
  return Math.floor(cap * 0.01) + Math.floor(level * 0.02) + 2
}

export function computeVitality(def: VitalityDef, input: VitalityInput): VitalityResult {
  const capPhysical = input.capPhysicalOverride ?? calcCap(input.level, input.fitness)
  const capVitality = input.capVitalityOverride ?? calcCap(input.level, input.regimen)
  const recoverPhysical = input.recoverPhysicalOverride ?? calcRecover(capPhysical, input.level)
  const recoverVitality = input.recoverVitalityOverride ?? calcRecover(capVitality, input.level)

  const recoveryOf = (
    resource: '体力' | '活力',
    current: number,
    target: number,
    cap: number,
    recoverPer5min: number,
  ): VitalityRecoveryResult => {
    const cur = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0
    const tgt = Number.isFinite(target) ? Math.max(0, Math.floor(target)) : 0
    const msg: string[] = []
    if (tgt > cap) msg.push(`目标(${tgt})超过上限(${cap})，已按差值估算`)
    if (cur >= tgt) {
      return {
        resource,
        current: cur,
        target: tgt,
        cap,
        recoverPer5min,
        minutes: 0,
        hours: 0,
        valid: true,
        message: cur > tgt ? `当前(${cur})已高于目标(${tgt})，无需在线` : '当前已达目标',
      }
    }
    const need = tgt - cur
    // 向上取整到 5 分钟粒度
    const blocks = Math.ceil(need / recoverPer5min)
    const minutes = blocks * 5
    return {
      resource,
      current: cur,
      target: tgt,
      cap,
      recoverPer5min,
      minutes,
      hours: Math.round((minutes / 60) * 100) / 100,
      valid: true,
      message: msg.length ? msg.join('；') : undefined,
    }
  }

  const physical = recoveryOf('体力', input.physicalCurrent, input.physicalTarget, capPhysical, recoverPhysical)
  const vitality = recoveryOf('活力', input.vitalityCurrent, input.vitalityTarget, capVitality, recoverVitality)

  // ===== 变现单价 → 万/点 折算（先算，供「方案对比」与「收益分析」共用，实现两处联动）=====
  const r = { ...def.profit, ...(input.profitOverride ?? {}) }
  //   聚神瓶：售价(万/个) ÷ 每瓶体力(POINTS_PER_JUSHEN_PING)
  //   临时符：售价(万/张) ÷ 符等级（每符耗活力 = 等级）
  //   灵犀之屑：(售价 × 每次平均产出 − 每次炼制费42万) ÷ 800体力/次
  //             —— 必须扣炼制费，否则会严重高估（42万/次 ≈ 每小时十倍于收益本身）
  const jushenPerPoint = r.jushenPrice / POINTS_PER_JUSHEN_PING
  const tempTalismanPerPoint = r.talismanLevel > 0 ? r.talismanPrice / r.talismanLevel : 0
  const lingxiNetPerRefine = r.lingxiPerRefine * r.lingxiPrice - r.lingxiRefineCost // 万/次（可为负=亏）
  const lingxiPerPoint = lingxiNetPerRefine / POINTS_PER_LINGXI
  // 书店打工（官方固定汇率）：40体力 → 3000两现金 或 3750两储备金（二选一），两列各自派生供玩家比较
  const bookstoreSilverPerPoint = BOOKSTORE_SILVER_WAN / BOOKSTORE_POINTS_PER_TIME
  const bookstoreReservePerPoint = BOOKSTORE_RESERVE_WAN / BOOKSTORE_POINTS_PER_TIME
  const physRatePerHour = recoverPhysical * 12 // 体力点/小时
  const vitRatePerHour = recoverVitality * 12 // 活力点/小时
  const pointCardCost = input.pointCardPrice * r.pointCardPerHour // 每小时点卡花费（万）

  const plans: VitalityPlanRow[] = def.plans.map((p) => {
    const ov = input.planRates?.[p.key]
    let silver = ov ? ov.silver : p.silverPerHour
    let reserve = ov ? ov.reserve : p.reservePerHour
    if (p.derive === 'jushen') {
      // 联动：聚神瓶单价(万/点) × 体力每小时恢复点数；单价为 0 时回退默认
      silver = jushenPerPoint * physRatePerHour || p.silverPerHour
    } else if (p.derive === 'talisman') {
      silver = tempTalismanPerPoint * vitRatePerHour || p.silverPerHour
    } else if (p.derive === 'lingxi') {
      // 联动：灵犀之屑净单价(万/点) × 体力每小时恢复点数；净为负时如实显示亏损（不回退默认）
      silver = lingxiPerPoint * physRatePerHour || p.silverPerHour
    } else if (p.derive === 'bookstore') {
      // 联动：书店打工官方固定汇率（现金 0.3万/40体力、储备金 0.375万/40体力）× 体力每小时恢复点数
      silver = bookstoreSilverPerPoint * physRatePerHour || p.silverPerHour
      reserve = bookstoreReservePerPoint * physRatePerHour || p.reservePerHour
    } else if (p.derive === 'liangcao') {
      // 联动：粮草单价(万/个) × 20个/时。不消耗体活，与在线卖体活互斥
      silver = input.liangcaoPrice * r.liangcaoPerHour || p.silverPerHour
    }
    return {
      key: p.key,
      label: p.label,
      resource: p.resource,
      silverPerHour: silver,
      reservePerHour: reserve,
      note: p.note,
      derive: p.derive,
    }
  })
  // 按每小时银两降序（最优在前）；银两相同再比储备金
  plans.sort((a, b) => b.silverPerHour - a.silverPerHour || b.reservePerHour - a.reservePerHour)
  const bestPlanKey = plans[0]?.key ?? ''
  // 体力/活力同时恢复、可同时进行，故各取本资源内银两最高者（plans 已降序，find 第一个即最优）
  const bestPhysicalKey = plans.find((p) => p.resource === '体力')?.key ?? ''
  const bestVitalityKey = plans.find((p) => p.resource === '活力')?.key ?? ''

  // ===== 四块收益分析 =====
  const makeItem = (
    label: string,
    physicalIncome: number,
    vitalityIncome: number,
    extraIncome: number,
    cost: number,
  ): VitalityProfitItem => {
    const totalIncome = physicalIncome + vitalityIncome + extraIncome
    const net = totalIncome - cost
    return { label, physicalIncome, vitalityIncome, extraIncome, cost, totalIncome, net, profitable: net > 0 }
  }

  // ① 人物在线保点卡：体力(聚神瓶)+活力(临时符)收入 − 点卡花费
  const pointCard = makeItem(
    '人物在线保点卡',
    jushenPerPoint * physRatePerHour,
    tempTalismanPerPoint * vitRatePerHour,
    0,
    pointCardCost,
  )
  // ② 粮草挂机：粮草收入 − 点卡花费
  //    关键口径修正：挂机万界通廊期间【体活不恢复】，所以这里【不计】体活变现收入（与「在线保点卡」不同）。
  //    粮草固定 3 分钟 1 个 → 20 个/小时。
  const liangcao = makeItem(
    '粮草挂机',
    0, // 体力收入：挂机万界通廊不恢复体力 → 0
    0, // 活力收入：挂机万界通廊不恢复活力 → 0
    input.liangcaoPrice * r.liangcaoPerHour,
    pointCardCost,
  )
  // ③ 吃百岁香：恢复 = 品质×2+150（体力/活力各），折算收入 − 百岁香价格
  const baishouRecover = input.baishouQuality * 2 + 150
  const baishou = makeItem(
    '吃百岁香',
    jushenPerPoint * baishouRecover,
    tempTalismanPerPoint * baishouRecover,
    0,
    input.baishouPrice,
  )
  // ④ 吃海马：体力获得=50+36×每5min恢复，活力获得=50+36×每5min恢复，折算收入 − 海马价格
  const haimaPhys = 50 + 36 * recoverPhysical
  const haimaVit = 50 + 36 * recoverVitality
  const haima = makeItem(
    '吃海马',
    jushenPerPoint * haimaPhys,
    tempTalismanPerPoint * haimaVit,
    0,
    input.haimaPrice,
  )

  return {
    cap: { capPhysical, capVitality, recoverPhysical, recoverVitality },
    physical,
    vitality,
    plans,
    bestPlanKey,
    bestPhysicalKey,
    bestVitalityKey,
    profit: { pointCard, liangcao, baishou, haima },
  }
}

export function compute(
  def: CalcDef,
  input: CalcInput,
  goldPrice: number,
  discount: number,
): CalcResult {
  if (def.type === 'synthesis') {
    return computeSynthesis(def, input, goldPrice, discount)
  }
  if (def.type === 'animalset') {
    return computeAnimalSet(def, input.fromLevel, input.pieces ?? 3)
  }
  if (def.type === 'fixeddamage') {
    // 固伤加成由 FixedDamageView 自行调用 computeFixedDamage（需门派 + 各项数值），
    // 此处仅占位以便共享 result computed 不报错（结果不被渲染）。
    return invalid('fixeddamage', '')
  }
  if (def.type === 'fdweapon') {
    // 固伤武器性价比由 FdWeaponView 自行调用 computeFdWeapon（需门派 + 武器列表），此处占位。
    return invalid('fdweapon', '')
  }
  if (def.type === 'speedchaos') {
    // 乱敏分析由 SpeedChaosView 自行调用 computeSpeedChaos（需面板速度 + 天阵开关），此处占位。
    return invalid('speedchaos', '')
  }
  if (def.type === 'vitality') {
    // 体活计算由 VitalityView 自行调用 computeVitality（需当前/目标/方案费率），此处占位。
    return invalid('vitality', '')
  }
  return computeLevelCost(def, input, goldPrice, discount)
}

// 供 UI 使用：该计算器当前可输入的最高等级（合成类受数据收录限制）
export function inputMaxLevel(def: CalcDef): number {
  if (def.type === 'synthesis') {
    return maxRowLevel(def) || def.maxLevel
  }
  if (def.type === 'levelcost') {
    return def.maxLevel
  }
  // animalset / fixeddamage / fdweapon / speedchaos 无 maxLevel 概念
  return 0
}

// ============================================================
// 合成类逐行阶梯（还原逐级阶梯排版）
// 每行 = 升到该级时的一级材料数量、体力（若有）、消耗额外梦幻币、本级/累计梦幻币、人民币。
// 列：等级 | 需要1级{材料}数量 | [体力 | 体力成本 |] 消耗额外梦幻币（万）
//                     | 本级梦幻币（万） | 累计梦幻币（万） | 本级人民币（元） | 累计人民币（元）
//   钟灵石无体力 → 不显示「体力/体力成本」两列；其余合成按 staminaPerLevel 显示。
// 体力成本按 1体力 = 0.0075万梦幻币；体力 = staminaPerLevel×(等级-1)。
// 本级梦幻币 = 数量×单价 + 合成费残差(feeWan，与单价无关)；「消耗额外梦幻币」= 本级梦幻币
//   按 count 递归反推：feeWan(L) − mergeBase×feeWan(L−1) − Σ(额外等级数量×feeWan(额外等级))，与单价无关。
// 数量(count) 递归：无额外规则 = mergeBase^(L-1)；有额外规则 = mergeBase×上一级数量 + Σ(额外等级数量×数量)。
// ============================================================
export interface SynthesisRow {
  level: number
  count: number // 升到该级所需 1级材料总数（额外提交等级起递归计入）
  stamina: number
  staminaCostWan: number // 体力成本（万）
  feeWan: number // 本级费用残差（万）= 本级梦幻币 − 数量×单价；用于反推「消耗额外梦幻币」
  gameFeeWan: number // 消耗额外梦幻币（万，游戏固定值，与单价无关）
  cumFeeWan: number // 累计合成费（万）
}

const STAMINA_PER_UNIT = 0.0075 // 万梦幻币 / 体力（1体力 = 0.0075万梦幻币）
function staminaOf(def: SynthesisDef, level: number): number {
  return (def.staminaPerLevel ?? 10) * (level - 1) // 1级=0；宝石 2级=10…、星辉石 2级=30…
}

// 升到 L 级所需的 1级材料总数（递归）。主链恒为 mergeBase×count(L-1)（即 mergeBase^(L-1) 当无额外规则时）；
// 有额外规则等级再叠加「该级额外提交材料折算的 1级数」(各额外等级的 count × 数量)。
// 注意：必须始终链式（不能用 Math.pow），否则一旦某级打断纯幂链（如钟灵石 L4=36 而非 27），后续级别会算错。
const _countCache = new Map<string, number>()
function countAt(def: SynthesisDef, level: number): number {
  if (level <= 1) return 1
  const key = def.id + ':' + level
  const cached = _countCache.get(key)
  if (cached != null) return cached
  const base = def.mergeBase ?? 2
  let c = base * countAt(def, level - 1)
  const rule = def.extraRule?.[level]
  if (rule) {
    for (const [extraLv, qty] of rule) c += countAt(def, extraLv) * qty
  }
  _countCache.set(key, c)
  return c
}

export function synthesisLadder(def: SynthesisDef): SynthesisRow[] {
  const avail = maxRowLevel(def)
  // 本级费用残差 feeWan(L) = cumFeeAt(L) − cumFeeAt(L−1)；「消耗额外梦幻币」按 count 递归反推（与单价无关）
  const feeByLv: number[] = new Array(avail + 1).fill(0)
  for (let L = 1; L <= avail; L++) feeByLv[L] = cumFeeAt(def, L) - cumFeeAt(def, L - 1)
  const base = def.mergeBase ?? 2
  const rows: SynthesisRow[] = []
  for (let L = 1; L <= avail; L++) {
    const count = countAt(def, L)
    const stamina = staminaOf(def, L)
    const feeWan = feeByLv[L]
    const cumFeeWan = cumFeeAt(def, L)
    // 消耗额外梦幻币（万）= feeWan(L) − mergeBase×feeWan(L−1) − Σ(额外等级数量×feeWan(额外等级))
    // 等价于 本级梦幻币(L) − mergeBase×本级(L−1) − 额外材料成本；材料单价项在数量递归中抵消，故与单价无关。
    let extra = 0
    if (L >= 2) extra += base * feeByLv[L - 1]
    const rule = def.extraRule?.[L]
    if (rule) for (const [exLv, qty] of rule) extra += feeByLv[exLv] * qty
    const gameFeeWan = L <= 1 ? 0 : feeWan - extra
    rows.push({
      level: L,
      count,
      stamina,
      staminaCostWan: stamina * STAMINA_PER_UNIT,
      feeWan,
      gameFeeWan,
      cumFeeWan,
    })
  }
  return rows
}
