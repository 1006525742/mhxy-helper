import type { CalcDef } from '../engine/types'
import { MASTER_SKILL_PER_LEVEL } from './masterSkill'
import { GUILD_GENERIC_TABLE, GUILD_STRONG_TABLE } from './guildSkill'
import { ANIMAL_SETS } from './animalSet'
import { FIXED_DAMAGE_SECTS } from './fixedDamage'
import { VITALITY } from './vitality'

// ============================================================
// 合成类（宝石/星辉石/钟灵石/五色灵尘）
// 说明：四款合成的计算费(costWan)均为游戏固定值（不随材料单价缩放），
// 由真值表「本级梦幻币 = 数量×单价 + 合成费」反推并逐行核验。
// 数量(count) 为递归值：主链 mergeBase×上一级数量（mergeBase：宝石=2、星辉石=3、钟灵石=3、五色灵尘=2），
//   特定等级再叠加额外提交同类型材料折算的 1级数（extraRule），由引擎 countAt 驱动。
// rows 中 cumWan 为累计合成费（万梦幻币），与 costWan 一致时即单级。
// ============================================================

const synthesisCommon = {
  category: '宝石工艺' as const,
  type: 'synthesis' as const,
}

export const CALCS: CalcDef[] = [
  // ---------- 合成类 ----------
  {
    ...synthesisCommon,
    id: 'gem',
    name: '宝石合成',
    unit: '1级宝石',
    maxLevel: 20,
    defaultMatPriceWan: 10, // 默认「1级宝石价格 = 10万」
    // 12-20 级官方额外提交规则：target 级 -> [[额外宝石等级, 数量], ...]
    // 引擎据此递归计算「数量」count(L)=2×count(L-1)+Σ[count(额外等级)×数量]（mergeBase=2）；
    // 合成费(costWan)为游戏固定值（与材料单价无关），由「本级梦幻币=数量×单价+合成费」反推并逐行核验。
    extraRule: {
      12: [[3, 1], [5, 1], [6, 1]],
      13: [[9, 1]],
      14: [[9, 1], [10, 1]],
      15: [[9, 1], [12, 1]],
      16: [[11, 1], [12, 1], [13, 1]],
      17: [[15, 1]],
      18: [[13, 1], [14, 1], [16, 1]],
      19: [[15, 1], [16, 1], [17, 1]],
      20: [[17, 1], [18, 2]],
    },
    // 数量(count)对 12-20 级为递归值（引擎按 extraRule 计算）；合成费(costWan)为游戏固定值，逐行反推校准。
    rows: [
      { level: 1, costWan: 0.0, cumWan: 0.0 },
      { level: 2, costWan: 0.08, cumWan: 0.08 },
      { level: 3, costWan: 0.3, cumWan: 0.38 },
      { level: 4, costWan: 0.83, cumWan: 1.21 },
      { level: 5, costWan: 1.95, cumWan: 3.16 },
      { level: 6, costWan: 4.28, cumWan: 7.44 },
      { level: 7, costWan: 9.0, cumWan: 16.44 },
      { level: 8, costWan: 18.52, cumWan: 34.96 },
      { level: 9, costWan: 37.65, cumWan: 72.61 },
      { level: 10, costWan: 75.97, cumWan: 148.58 },
      { level: 11, costWan: 152.7, cumWan: 301.28 },
      { level: 12, costWan: 312.75, cumWan: 614.03 },
      { level: 13, costWan: 664.05, cumWan: 1278.08 },
      { level: 14, costWan: 1443.0, cumWan: 2721.08 },
      { level: 15, costWan: 3237.0, cumWan: 5958.08 },
      { level: 16, costWan: 7604.0, cumWan: 13562.08 },
      { level: 17, costWan: 18447.0, cumWan: 32009.08 },
      { level: 18, costWan: 46606.0, cumWan: 78615.08 },
      { level: 19, costWan: 122501.0, cumWan: 201116.08 },
      { level: 20, costWan: 356661.0, cumWan: 557777.08 },
    ],
    meta: {
      version: '1.0.0',
      updated: '2026-08-12',
      sources: ['梦幻西游官方合成规则', '真值表逐行核验（230金价 / 1级单价2万）'],
      note: '数量对 12-20 级为递归值（主链+额外提交宝石折算1级数），由 extraRule 计算；合成费为游戏固定值（与单价无关）。本级梦幻币=数量×单价+合成费（体力成本单列）。已用 230金价 / 1级单价2万 真值表逐行核验：L13 本级 9576.05万、L20 累计 804.0870亿均吻合。',
      verified: true,
    },
  },
  {
    ...synthesisCommon,
    id: 'starlight',
    name: '星辉石合成',
    unit: '1级星辉石',
    maxLevel: 11,
    defaultMatPriceWan: 16, // 默认「1级星辉石价格 = 16万」
    // 体力 = 30×(等级-1)（星辉石倍率，区别于宝石的 10）
    staminaPerLevel: 30,
    // 数量基数 = 3（星辉石每级主链 ×3，区别于宝石 ×2）
    mergeBase: 3,
    // 9-11 级官方额外提交规则：target 级 -> [[额外星辉石等级, 数量], ...]
    // 数量 count(L)=3×count(L-1)+Σ[count(额外等级)×数量]
    extraRule: {
      9: [[5, 1]],
      10: [[6, 1], [7, 1]],
      11: [[9, 1]],
    },
    // 数量(count)对 9-11 级为递归值（引擎按 extraRule 计算，基数 3）；合成费(costWan)为游戏固定值（与单价无关），由「本级梦幻币=数量×单价+合成费」反推并逐行核验。
    rows: [
      { level: 1, costWan: 0.0, cumWan: 0.0 },
      { level: 2, costWan: 0.23, cumWan: 0.23 },
      { level: 3, costWan: 1.13, cumWan: 1.36 },
      { level: 4, costWan: 4.05, cumWan: 5.41 },
      { level: 5, costWan: 13.05, cumWan: 18.46 },
      { level: 6, costWan: 40.28, cumWan: 58.74 },
      { level: 7, costWan: 122.0, cumWan: 180.74 },
      { level: 8, costWan: 368.0, cumWan: 548.74 },
      { level: 9, costWan: 1119.0, cumWan: 1667.74 },
      { level: 10, costWan: 3522.0, cumWan: 5189.74 },
      { level: 11, costWan: 11687.0, cumWan: 16876.74 },
    ],
    meta: {
      version: '1.0.0',
      updated: '2026-08-12',
      sources: ['梦幻西游官方合成规则', '真值表逐行核验（230金价 / 1级单价16万）'],
      note: '数量基数 3、9-11 级额外提交规则（extraRule）已对齐官方；合成费为游戏固定值（与单价无关）。已用 230金价 / 1级单价16万 真值表逐行核验：L11 数量 69336、本级 112.1063亿、累计 161.9373亿、累计人民币 12.42万 均吻合。',
      verified: true,
    },
  },
  {
    ...synthesisCommon,
    id: 'spirit',
    name: '钟灵石合成',
    unit: '1级钟灵石',
    maxLevel: 8,
    defaultMatPriceWan: 5, // 默认「1级钟灵石价格 = 5万」
    // 钟灵石无体力消耗（无体力列），体力倍率置 0
    staminaPerLevel: 0,
    // 数量基数 = 3（主链 ×3，同星辉石）；L4/L6/L7/L8 有额外提交同类型低级别钟灵石，打断纯 3 次幂链
    // count(L)=3×count(L-1)+Σ[count(额外等级)×数量]：L4=+count(3)、L6=+count(5)、L7=+count(6)、L8=+2×count(7)
    mergeBase: 3,
    extraRule: {
      4: [[3, 1]],
      6: [[5, 1]],
      7: [[6, 1]],
      8: [[7, 2]],
    },
    // 数量(count) 由 extraRule 驱动；合成费(costWan)为游戏固定值（与单价无关），由「本级梦幻币=数量×单价+合成费」反推并逐行核验。
    rows: [
      { level: 1, costWan: 0.0, cumWan: 0.0 },
      { level: 2, costWan: 1.0, cumWan: 1.0 },
      { level: 3, costWan: 7.0, cumWan: 8.0 },
      { level: 4, costWan: 37.0, cumWan: 45.0 },
      { level: 5, costWan: 127.0, cumWan: 172.0 },
      { level: 6, costWan: 533.0, cumWan: 705.0 },
      { level: 7, costWan: 2168.0, cumWan: 2873.0 },
      { level: 8, costWan: 10889.0, cumWan: 13762.0 },
    ],
    meta: {
      version: '1.0.0',
      updated: '2026-08-13',
      sources: ['梦幻西游官方合成规则', '真值表逐行核验（230金价 / 1级单价5万）'],
      note: '数量基数 3、L4/L6/L7/L8 额外提交同类型低级别钟灵石（extraRule）已对齐官方；无体力消耗（体力倍率 0）。合成费为游戏固定值（与单价无关）。已用 230金价 / 1级单价5万 真值表逐行核验：L8 数量 8640、本级 5.4089亿、累计 6.8547亿、累计人民币 5255.27元 均吻合。',
      verified: true,
    },
  },
  {
    ...synthesisCommon,
    id: 'colorstone',
    name: '五色灵尘合成',
    unit: '1级灵尘',
    maxLevel: 15,
    defaultMatPriceWan: 30, // 默认「1级灵尘价格 = 30万」
    // 体力 = 30×(等级-1)（五色灵尘倍率，同星辉石）
    staminaPerLevel: 30,
    // 数量基数 = 2（主链 ×2）；3 级起额外提交「前前级」灵尘（类斐波那契）：count(L)=2×count(L-1)+count(L-2)
    mergeBase: 2,
    // 3-15 级额外提交规则：target 级 -> [[目标级-2, 数量=1], ...]（按官方「额外提交同类型灵尘」逐行核验确认）
    extraRule: {
      3: [[1, 1]],
      4: [[2, 1]],
      5: [[3, 1]],
      6: [[4, 1]],
      7: [[5, 1]],
      8: [[6, 1]],
      9: [[7, 1]],
      10: [[8, 1]],
      11: [[9, 1]],
      12: [[10, 1]],
      13: [[11, 1]],
      14: [[12, 1]],
      15: [[13, 1]],
    },
    // 数量(count)对 3-15 级为递归值（引擎按 extraRule 计算，基数 2）；合成费(costWan)为游戏固定值（与单价无关），由「本级梦幻币=数量×单价+合成费」反推并逐行核验。
    rows: [
      { level: 1, costWan: 0.0, cumWan: 0.0 },
      { level: 2, costWan: 0.23, cumWan: 0.23 },
      { level: 3, costWan: 0.90, cumWan: 1.13 },
      { level: 4, costWan: 2.70, cumWan: 3.83 },
      { level: 5, costWan: 7.20, cumWan: 11.03 },
      { level: 6, costWan: 18.22, cumWan: 29.25 },
      { level: 7, costWan: 45.00, cumWan: 74.25 },
      { level: 8, costWan: 110.00, cumWan: 184.25 },
      { level: 9, costWan: 266.00, cumWan: 450.25 },
      { level: 10, costWan: 645.00, cumWan: 1095.25 },
      { level: 11, costWan: 1558.00, cumWan: 2653.25 },
      { level: 12, costWan: 3763.00, cumWan: 6416.25 },
      { level: 13, costWan: 9086.00, cumWan: 15502.25 },
      { level: 14, costWan: 21939.00, cumWan: 37441.25 },
      { level: 15, costWan: 52967.00, cumWan: 90408.25 },
    ],
    meta: {
      version: '1.0.0',
      updated: '2026-08-13',
      sources: ['梦幻西游官方合成规则', '真值表逐行核验（230金价 / 1级单价30万）'],
      note: '数量基数 2、3-15 级额外提交「前前级」灵尘（类斐波那契 extraRule）已对齐官方；合成费为游戏固定值（与单价无关）。已用 230金价 / 1级单价30万 真值表逐行核验：L11 累计 29.6653亿、L15 累计 1007.8248亿 均吻合。',
      verified: true,
    },
  },

  // ---------- 等级消耗类 ----------
  {
    id: 'master-skill',
    name: '师门技能',
    category: '养成',
    type: 'levelcost',
    minLevel: 0,
    maxLevel: 180,
    mode: 'table',
    table: MASTER_SKILL_PER_LEVEL,
    // 7 个师门技能分别计算（各自独立设 0→N 级，底部汇总）
    multiEntry: true,
    slots: [
      { key: 's1', label: '师门技能1' },
      { key: 's2', label: '师门技能2' },
      { key: 's3', label: '师门技能3' },
      { key: 's4', label: '师门技能4' },
      { key: 's5', label: '师门技能5' },
      { key: 's6', label: '师门技能6' },
      { key: 's7', label: '师门技能7' },
    ],
    meta: {
      version: '1.2.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 估价依赖2不要动!S2:U182（师门技能累计梦幻币/万，0-180 逐級，金钱权威）',
        '同表 估价依赖1不要动!U1:X15（师门技能 分段「需要经验/需要金钱万」权威静态表，经验定比来源）',
      ],
      note: '金钱(梦幻币)对齐依赖2：0→150=3864.6693万、0→160=7404.0588万、0→180=21292.341万，各级累计 diff=0。经验列由依赖1 分段表反推的定比关系生成：经验=金钱(两)×8/3（1-160级）、×10/3（161-180级），累计 0→160=1.9744亿、0→180=6.6038亿，与依赖1 分段合计 660,384,473 相对误差 2.5e-7。满级 180。7 个师门技能各自独立设级计算后底部汇总。',
      verified: true,
    },
  },
  {
    id: 'cultivation',
    name: '人物修炼',
    category: '养成',
    type: 'levelcost',
    minLevel: 0,
    maxLevel: 25,
    mode: 'formula',
    expOf: (n: number) => (n * n + 3 * n + 11) * 10,
    // 5 个修炼类型分别独立设级计算，底部汇总（对齐估价表逐项布局）
    multiEntry: true,
    slots: [
      { key: 'atk', label: '人物攻修', moneyRate: 0.3 },
      { key: 'magic', label: '人物法修', moneyRate: 0.3 },
      { key: 'hunt', label: '人物猎术', moneyRate: 0.3 },
      { key: 'def', label: '人物物抗', moneyRate: 0.2 },
      { key: 'mdef', label: '人物法抗', moneyRate: 0.2 },
    ],
    meta: {
      version: '1.2.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 估价依赖1不要动!F1:J26（攻/法/猎术修 逐级 经验+金钱/万，权威静态表）',
        '同表 K1:M26（法抗/物抗修 逐级 金钱/万）',
        '估价依赖2不要动!F2:H27 / I2:K27（累计值，交叉校验）',
      ],
      note: '逐级经验=(n²+3n+11)×10，与依赖1 F列 150/210/290…7110 逐行一致；攻法猎金钱=经验×0.3万（依赖1：1级=45万、25级=2133万），抗修=经验×0.2万（依赖1：1级=30万、25级=1422万）。单项 0→25：攻法猎=20325万、抗修=13550万；五项全满=88075万。五个修炼类型各自独立设级后汇总。',
      verified: true,
    },
  },
  {
    id: 'pet-cultivation',
    name: '召唤兽修炼',
    category: '养成',
    type: 'levelcost',
    minLevel: 0,
    maxLevel: 25,
    mode: 'formula',
    // 逐级经验与人物修炼同曲线（依赖1 Q列：150/210/290…7110 逐行一致）
    expOf: (n: number) => (n * n + 3 * n + 11) * 10,
    showFruit: true,
    // 成本 = 修炼果个数 × 修炼果单价（依赖1「按修炼果80万算金币」）
    costFromFruit: true,
    // 4 个宝宝修炼类型分别独立设级计算，底部汇总
    multiEntry: true,
    slots: [
      { key: 'patk', label: '宝宝攻修' },
      { key: 'pmagic', label: '宝宝法修' },
      { key: 'pdef', label: '宝宝物防' },
      { key: 'pmdef', label: '宝宝法防' },
    ],
    extraInputs: [{ key: 'fruitPrice', label: '修炼果单价', default: 80, unit: '万梦幻币/个' }],
    meta: {
      version: '2.0.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 估价依赖1不要动!O1:S26（宝宝修炼 逐级 需要经验/需要修炼果个数/按修炼果80万算金币，权威静态表）',
      ],
      note: '依赖1 权威口径：逐级经验=(n²+3n+11)×10（与人物修炼同曲线，1级=150、25级=7110）；修炼果=经验/150（1级=1个、25级=47.4个）；金币=修炼果×单价（默认80万/个）。单类型 0→25 累计 67750 经验 = 451.67 修炼果 ≈ 36133万（依赖1 合计 36114万，差值来自其逐级果数取1位小数）。四项（攻/法/物防/法防）分别独立设级后汇总。注：旧版误将依赖2 的「第25级单级值 47.4果/7110经验」当作累计值，已修正。',
      verified: true,
    },
  },
  {
    id: 'guild-skill',
    name: '帮派技能',
    category: '养成',
    type: 'levelcost',
    minLevel: 0,
    maxLevel: 160,
    mode: 'table',
    table: GUILD_GENERIC_TABLE, // 默认（普通辅助技能：打造/裁缝/炼金/烹饪/炼药等）0-160
    multiEntry: true,
    slots: [
      { key: 'g1', label: '帮派技能1', table: GUILD_GENERIC_TABLE, maxLevel: 160 },
      { key: 'g2', label: '帮派技能2', table: GUILD_GENERIC_TABLE, maxLevel: 160 },
      { key: 'g3', label: '帮派技能3', table: GUILD_GENERIC_TABLE, maxLevel: 160 },
      { key: 'g4', label: '帮派技能4', table: GUILD_GENERIC_TABLE, maxLevel: 160 },
      { key: 'g5', label: '帮派技能5', table: GUILD_GENERIC_TABLE, maxLevel: 160 },
      { key: 'g6', label: '帮派技能6', table: GUILD_GENERIC_TABLE, maxLevel: 160 },
      { key: 'strong', label: '强壮', table: GUILD_STRONG_TABLE, maxLevel: 40 },
      { key: 'speed', label: '神速', table: GUILD_STRONG_TABLE, maxLevel: 40 },
    ],
    meta: {
      version: '1.0.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 估价依赖2不要动!W2:Y83（普通帮派 0-160 逐级累计）',
        '同表 AA2:AC42（强壮/神速 0-40 逐级累计）',
        '估价依赖1不要动!Z1:AD6 与 AE1:AH9（分段权威值，交叉校验）',
      ],
      note: '普通帮派技能对齐依赖2 W2:Y83（0-160；依赖2 仅 80-160 有数据，0→80 全并入 80 级）。强壮/神速单独用 GUILD_STRONG_TABLE（依赖2 AA2:AC42，0-40）。依赖2 仅提供累计金币(万)，经验恒 0。已与依赖1 分段值交叉校验：普通帮派 0→160 本实现 3348.09万 vs 依赖1 3346万；强壮/神速 0→40 本实现 16670万 vs 依赖1 16668万（依赖1 分段取整，差值 <0.07%）。各项独立设级后汇总（普通上限160、强壮/神速上限40）。',
      verified: true,
    },
  },
  {
    id: 'animal-set',
    name: '动物套选择',
    category: '装备灵饰',
    type: 'animalset',
    defaultLevel: 129,
    maxLevel: 175,
    sets: ANIMAL_SETS,
    meta: {
      version: '1.0.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 动物套大全（各套装 属性类型/附带技能/负面影响/几线/三件套/五件套/加成方式）',
      ],
      note: '输入召唤兽等级，按属性加成 floor(等级/系数 + 基础) 降序排序推荐。1线 = 等级/4+15、超1线 = 等级/3+5、2线 = 等级/4+10（与估价表「加成方式」列一致；129 级时得 47.25/48/42.25，取整后 47/48/42，对齐动物套选择页面默认显示）。三件套/五件套为变身触发几率（多数 3%/10%，蛟龙/雨师 5%/15%）。',
      verified: true,
    },
  },
  {
    id: 'fixed-damage',
    name: '固伤加成',
    category: '养成',
    type: 'fixeddamage',
    sects: FIXED_DAMAGE_SECTS,
    meta: {
      version: '1.0.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 自动计算固伤加成（四大主流固伤门派：女儿村/无底洞/地府/普陀山，伤害/敏捷/法修/试剑石/落星飞鸿 对 主秒/副秒 的转换系数）',
      ],
      note: '固伤加成换算：选门派后输入各项「加伤项」数值（伤害点数/敏捷点数/法修等级/试剑石等级/落星飞鸿等级），按估价表转换系数线性算出 主秒/副秒 固伤加成。该表仅给出「加伤项→固伤」的边际换算系数，不含技能等级/修炼带来的基础固伤本身，故结果为各项加成之和，非完整固伤输出。已用估价表「武器性价比」示例对拍（女儿村 490伤害→主秒343/副秒98、500伤害→350/100、467伤害+19敏捷→主秒336.78/副秒103.28，全部吻合）。',
      verified: true,
    },
  },
  {
    id: 'fd-weapon',
    name: '固伤武器性价比',
    category: '装备灵饰',
    type: 'fdweapon',
    sects: FIXED_DAMAGE_SECTS,
    meta: {
      version: '1.0.0',
      updated: '2026-08-14',
      sources: [
        '藏宝阁自动估价表2024-08-08.xlsx → 自动计算固伤加成（L2:T6 固伤武器副秒计算及性价比对比）',
      ],
      note: '选门派后录入若干把武器的 伤害/敏捷/价格，按该门派系数算每把主秒/副秒加成，并按「每元副秒」降序排名。固伤门派最关心副秒伤害，性价比以副秒为准；价格单位任意，仅用于横向对比。系数来自估价表「自动计算固伤加成」。已用估价表示例对拍（女儿村 武器1:490伤/0敏/10元→主秒343/副秒98/每元副秒9.8，排名1；武器2:467伤/19敏/333元→副秒103.28/每元副秒0.31，排名2；武器3:500伤/333元→每元副秒0.30，排名3）。',
      verified: true,
    },
  },
  {
    id: 'speed-chaos',
    name: '乱敏分析',
    category: '养成',
    type: 'speedchaos',
    meta: {
      version: '1.0.0',
      updated: '2026-08-14',
      sources: [
        'fbbizyy.com/calculator/speed-chaos 页面下方公式与示例（乱敏 ±5%、天阵人物速度 ×0.9）',
        '梦幻西游官方乱敏规则：战斗速度 = 面板 × [0.95, 1.05]（取整）',
      ],
      note: '乱敏（速度波动）概率分析：输入「最高速须弥」面板速度，算其战斗速度波动范围 floor(面板×0.95)~floor(面板×1.05)；并反推人物各速度梯队（5速→1速）在「开天阵/不开天阵」下要求面板速度下限，使该梯队一定比下一梯队快。天阵模式人物速度 ×0.9（floor）后再乱敏。已用页面示例对拍（须弥601→战斗570-631；开天阵 5速≥740/4速≥819/3速≥906/2速≥1003/1速≥1109，天阵减少后分别为666/737/815/902/998，波动范围 632-699/700-773/774-855/856-947/948-1047，全部吻合）。注：本页波动范围取 floor 边界，与页面原显示个别上限相差 ±1（页面为展示用取整），但梯队要求（关键输出）完全一致。',
      verified: true,
    },
  },
  VITALITY,
]

export function getCalc(id: string): CalcDef | undefined {
  return CALCS.find((c) => c.id === id)
}
