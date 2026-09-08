// 计算器模块公共类型

// 等级输入模型（LevelInput 与 CalcView 共用）
export interface LevelModel {
  from: number
  to: number
  count: number
}


export interface MetaInfo {
  version: string
  updated: string
  sources: string[]
  note: string
  // verified=true 表示数据来自官方/实测并已逐行核验；false 表示尚未核验
  verified: boolean
}

export type CalcType = 'synthesis' | 'levelcost' | 'animalset' | 'fixeddamage' | 'fdweapon' | 'speedchaos' | 'vitality'

// 首页分组大类：养成 / 宝石工艺（宝石、星辉石、钟灵石、五色灵尘等合成） / 装备灵饰（召唤兽套装等） / 体活收益（体力活力相关）
export type CalcCategory = '养成' | '宝石工艺' | '装备灵饰' | '体活收益'

// 合成类（宝石/星辉石/钟灵石/五色灵尘）：每一级「本级梦幻币」与「累计梦幻币」
export interface SynthesisRow {
  level: number
  costWan: number // 本级消耗（万梦幻币）
  cumWan: number // 累计消耗（万梦幻币）
}

export interface SynthesisDef {
  id: string
  name: string
  category: CalcCategory
  type: 'synthesis'
  unit: string // 材料单位，如「1级宝石」
  maxLevel: number
  // 1级材料单价（万梦幻币），用户可输入；默认给一个参考值
  defaultMatPriceWan: number
  rows: SynthesisRow[]
  // 体力倍率：每升 1 级消耗体力 = staminaPerLevel × (等级-1)（1级为0）。宝石=10、星辉石=30，按计算器不同。
  staminaPerLevel?: number
  // 数量递归基数：每升 1 级主链 = mergeBase × 上一级数量。宝石=2、星辉石=3。
  mergeBase?: number
  // 额外提交规则（官方合成规则）：target 级 -> [[额外材料等级, 数量], ...]
  // 存在规则的等级：数量 = mergeBase×上一级数量 + Σ(额外等级数量×数量)；合成费仍取固定录入值。
  extraRule?: Record<number, Array<[number, number]>>
  meta: MetaInfo
}

// 等级消耗类（师门技能/人物修炼/召唤兽修炼/帮派技能）
export interface LevelCostSlot {
  key: string
  label: string
  // 修炼类：攻法猎 moneyRate=0.3（万/经验），抗修=0.2；师门/帮派表驱动时为 undefined
  moneyRate?: number
  // 表驱动时每个 slot 可用独立成本表（如帮派技能：普通辅助技能 / 强壮神速 不同表）
  table?: number[][]
  // 该 slot 可输入的上限（覆盖 def.maxLevel），如强壮/神速上限 40、普通辅助技能 160
  maxLevel?: number
}

export interface LevelCostDef {
  id: string
  name: string
  category: CalcCategory
  type: 'levelcost'
  minLevel: number
  maxLevel: number
  mode: 'formula' | 'table'
  // 修炼类公式：本级经验
  expOf?: (n: number) => number
  // 表驱动：perLevel[n] = [经验, 金钱(两)]（n 从 1 起，表示 n-1→n）
  table?: number[][]
  slots: LevelCostSlot[]
  // 额外输入（如修炼果单价）
  extraInputs?: { key: string; label: string; default: number; unit: string }[]
  // 多技能分别计算（如师门技能）：UI 渲染每个 slot 独立的起始/目标等级输入，
  // 引擎按 slotLevels 各自计算后汇总（逐项独立设级 + 底部合计布局）。
  multiEntry?: boolean
  // 召唤兽修炼等：显示「修炼果」个数（经验/150）。多技能模式下逐槽显示 + 合计总果数。
  showFruit?: boolean
  // 成本由「修炼果个数 × 修炼果单价」驱动（召唤兽修炼，对齐估价表依赖1「按修炼果80万算金币」）。
  // 为 true 时忽略 slot.moneyRate 与表金钱列，单价取 input.fruitPrice / extraInputs 默认值。
  costFromFruit?: boolean
  meta: MetaInfo
}

// 动物套（变身术套装）选择类：输入召唤兽等级，按属性加成排序推荐。
// 与「合成 / 等级消耗」不同，本类不计算梦幻币，只做属性加成排序对比。
export type AnimalAttr = '敏捷' | '魔力' | '力量' | '体质' | '耐力'

export interface AnimalSet {
  name: string
  attr: AnimalAttr
  skill: string // 战斗触发变身时的附带技能
  impact: '正' | '负' | '无' // 附带技能是否有负面影响
  tier: 1 | 2 | '超1'
  threeRate: number // 三件套触发几率（如 0.03）
  fiveRate: number // 五件套触发几率（如 0.1）
  // 属性加成公式：floor(等级 / divisor + base)
  //   1线: /4 +15，超1线: /3 +5，2线: /4 +10（与估价表「动物套大全」加成方式列一致）
  // 估价表「加成方式」列写作「等级/X+Y，Z」：Y = 三件套基础值，Z = 五件套基础值。
  //   三件套/五件套基础值差：1线 +10、超1线 +10、2线 +5（即 fiveBase 并非统一 +10）。
  divisor: number
  base: number // 三件套基础值
  fiveBase: number // 五件套基础值
}

export interface AnimalSetDef {
  id: string
  name: string
  category: CalcCategory
  type: 'animalset'
  defaultLevel: number
  maxLevel: number // 仅用于 UI 输入上限，不影响公式
  sets: AnimalSet[]
  meta: MetaInfo
}

// 固伤加成换算（固定伤害门派）：给定门派与各项「加伤项」数值，
// 按估价表「自动计算固伤加成」的转换系数，线性换算出主秒 / 副秒 固伤加成。
// 加伤项：伤害(武器伤害点数) / 敏捷(点数) / 法修(法术修炼等级) / 试剑石(等级) / 落星飞鸿(等级)。
// 系数 [主秒, 副秒] 取自估价表四大主流固伤门派（女儿村/无底洞/地府/普陀山）。
export type FixedDamageItem = 'damage' | 'agility' | 'magicCult' | 'swordStone' | 'meteor'

export interface FixedDamageCoeff {
  damage: [number, number] // 1点伤害 → [主秒, 副秒]
  agility: [number, number] // 1点敏捷 → [主秒, 副秒]
  magicCult: [number, number] // 1级法修 → [主秒, 副秒]
  swordStone: [number, number] // 1级试剑石 → [主秒, 副秒]
  meteor: [number, number] // 1级落星飞鸿 → [主秒, 副秒]
}

export interface FixedDamageSect {
  id: string
  name: string
  coeff: FixedDamageCoeff
}

export interface FixedDamageDef {
  id: string
  name: string
  category: CalcCategory
  type: 'fixeddamage'
  sects: FixedDamageSect[]
  meta: MetaInfo
}

// 固伤武器副秒计算及性价比对比：选门派，录入若干把武器（每把含 伤害/敏捷/价格），
// 按该门派转换系数算出每把的主秒加成/副秒加成，再按「每元副秒」降序排名。
// 系数复用 FixedDamageSect（伤害/敏捷两项的 [主秒,副秒]）。
export interface FixedDamageWeaponDef {
  id: string
  name: string
  category: CalcCategory
  type: 'fdweapon'
  sects: FixedDamageSect[]
  meta: MetaInfo
}

// 乱敏（速度波动）概率分析：给定最高速须弥（召唤兽）面板速度，计算其战斗时速度波动范围
// （乱敏 ±5%，即 floor(面板×0.95) ~ floor(面板×1.05)），并在「开天阵/不开天阵」两种模式下，
// 反推人物各速度梯队（5速→1速）要求面板速度下限，使该梯队一定比下一梯队快。
// 天阵模式：人物速度 ×0.9 后再乱敏（floor(面板×0.9) 为天阵减少后速度，再算 ±5%）。
// 梯队要求锚点：5速需一定快过最高速须弥；4/3/2/1速依次需快过上一梯队的最大战斗速度。
// 本模块纯分析、不计算梦幻币，与固定伤害/动物套同属「选择器/分析类」。
export interface SpeedChaosDef {
  id: string
  name: string
  category: CalcCategory
  type: 'speedchaos'
  meta: MetaInfo
}

// 体力活力计算（体活收益）：纯分析类，不计算梦幻币。
// 含两部分：① 恢复时间 —— 给定当前/目标体力(活力)与每5分钟恢复量，算需在线多久；
//          ② 使用方案收益对比 —— 列出把体力/活力变现的各项方式，按每小时银两(储备金)降序找最优。
// 注：本模块公式来自 fbbizyy 体活计算页面的可见静态文字（恢复速率、各方案每小时费率）；
//     该页为 JS 渲染，沙箱无法抓取精确判定逻辑，故「在线保点卡/粮草挂机/百岁香/海马」四块收益分析未收录，标 verified:false。
export interface VitalityPlan {
  key: string
  label: string
  // 消耗的资源：体力/活力；粮草挂机（万界通廊）不消耗体活 → '无'
  resource: '体力' | '活力' | '无'
  // 每小时银两收益（万梦幻币）。
  // derive 未设置：手动可改（按本区物价校正）。
  // derive='jushen'：自动 = 聚神瓶单价(万/点) × 体力每小时恢复点数（与「收益分析」同源、联动）。
  // derive='talisman'：自动 = 临时符单价(万/点) × 活力每小时恢复点数（与「收益分析」同源、联动）。
  // derive='lingxi'：自动 = 灵犀之屑净单价(万/点) × 体力每小时恢复点数；净单价已扣每次 42 万炼制费。
  // derive='bookstore'：自动 = 书店打工固定汇率(0.3万/40体力) × 体力每小时恢复点数；储备金同步派生(0.375万/40体力)。
  // derive='liangcao'：自动 = 粮草单价(万/个) × 20个/时（不消耗体活，与在线卖体活互斥）。
  silverPerHour: number
  // 每小时储备金收益（万），无则 0。derive='bookstore' 时由固定汇率自动派生
  reservePerHour: number
  note?: string
  // 标记该方案为「单价×恢复速率」自动派生（与收益分析联动），UI 只读展示
  derive?: 'jushen' | 'talisman' | 'lingxi' | 'bookstore' | 'liangcao'
}

// 收益块参数（变现单价与道具规则）。
// 单价改用玩家可直接观测的单位（不再用「万/点」这种算不出来的单位）：
//   - 聚神瓶：玩家看得到「一个聚神瓶卖多少万」，内部按 POINTS_PER_JUSHEN_PING 折算成 万/点
//   - 临时符：玩家看得到「某级临时符卖多少万」，内部按「每符耗活力 = 符等级」折算成 万/点
// 数值从 fbbizyy 单组样本(175级·健身100·养生144)反推标定，不同区/号会变，UI 可改。
export const POINTS_PER_JUSHEN_PING = 1330 // 每瓶聚神瓶体力当量：99聚神丹(≈99神通)+合成10体力；99神通按400体力=30神通→99/30×400=1320，再加合成10体力=1330（七十二变资料片规则）

// 灵犀之屑炼制规则（打铁炉 → 神器相关 → 炼制灵犀之屑，官方固定）：
//   每次消耗 800 体力 + 42 万梦幻币，保底出 1 个，有概率额外爆 3/6/9 个。
export const POINTS_PER_LINGXI = 800 // 每次炼制消耗体力（官方固定）
export const LINGXI_REFINE_COST_WAN = 42 // 每次炼制额外消耗梦幻币（万，官方固定）
export const LINGXI_PER_REFINE = 1.36 // 每次炼制平均产出个数（保底1；玩家1000次实测均值1.36）

// 书店打工规则（长安城书香斋→颜如玉，官方固定）：
//   每次消耗 40 体力，换 3000 两现金【或】3750 两储备金（二选一，不可兼得）。
export const BOOKSTORE_POINTS_PER_TIME = 40 // 每次打工消耗体力（官方固定）
export const BOOKSTORE_SILVER_WAN = 0.3 // 换现金：3000 两 = 0.3 万
export const BOOKSTORE_RESERVE_WAN = 0.375 // 换储备金：3750 两 = 0.375 万

// 粮草挂机（万界通廊）：固定 3 分钟产出 1 个粮草 → 20 个/小时。
// 关键：挂机万界通廊期间【体活不恢复】，故粮草挂机收益只算粮草，不计体活变现收入。
export const LIANGCAO_PER_HOUR = 20 // 每小时产出粮草个数（3分钟/个，官方固定）

// 点卡计费：梦幻标准计费 6 点/小时（1点≈6分钟≈0.1元），全服固定。
export const POINT_CARD_PER_HOUR = 6 // 每小时消耗点卡数（官方计费，固定）

export interface VitalityProfitRate {
  pointCardPerHour: number // 每小时消耗点卡数（梦幻计费，样本 6 点/小时）
  jushenPrice: number // 聚神瓶售价（万/个，玩家可观测；内部 ÷ POINTS_PER_JUSHEN_PING 得 万/点）
  talismanLevel: number // 临时符等级（每符耗活力 = 等级）
  talismanPrice: number // 该级临时符售价（万/张，玩家可观测；内部 ÷ 等级 得 万/点）
  liangcaoPerHour: number // 粮草摆摊每小时产出个数（样本 20）
  lingxiPrice: number // 灵犀之屑售价（万/个，玩家可观测；市场约 35 万/个）
  lingxiPerRefine: number // 每次炼制平均产出个数（保底1，爆率看脸；默认 1.36）
  lingxiRefineCost: number // 每次炼制额外消耗梦幻币（万，官方 42 万；填 0 表示不计）
}

export interface VitalityDef {
  id: string
  name: string
  category: CalcCategory
  type: 'vitality'
  // 角色基础：等级 + 健身术(体力) + 养生术(活力)
  level: number
  fitness: number // 健身术等级 → 影响体力上限与每5分钟恢复
  regimen: number // 养生术等级 → 影响活力上限与每5分钟恢复
  // 使用方案（体力/活力变现）对比列表
  plans: VitalityPlan[]
  // 收益块参数
  profit: VitalityProfitRate
  profitDefaults: {
    baishouQuality: number // 百岁香默认品质
    baishouPrice: number // 百岁香默认价格（万）
    haimaPrice: number // 海马默认价格（万）
  }
  meta: MetaInfo
}

// 计算器定义：合成 / 等级消耗 / 动物套选择 / 固伤加成 / 固伤武器性价比 / 乱敏分析 / 体活计算 七类，用 type 字段区分（判别联合）
export type CalcDef = SynthesisDef | LevelCostDef | AnimalSetDef | FixedDamageDef | FixedDamageWeaponDef | SpeedChaosDef | VitalityDef
