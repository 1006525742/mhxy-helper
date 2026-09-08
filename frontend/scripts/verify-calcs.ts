// 数据对拍脚本：用真实引擎独立复算关键数值，确认计算器口径正确。
// 运行：node_modules/.bin/esbuild scripts/verify-calcs.ts --bundle --platform=node --format=esm --outfile=/tmp/verify.mjs && node /tmp/verify.mjs
import { getCalc } from '../src/calculators/data/calcs'
import { compute, computeAnimalSet, synthesisLadder, computeFixedDamage, computeFdWeapon, computeSpeedChaos, computeChaosCheck, computeVitality } from '../src/calculators/services/calcEngine'
import type { FixedDamageItem } from '../src/calculators/engine/types'
import { fmtRMB } from '../src/calculators/engine/format'

let failed = 0
function assert(name: string, cond: boolean, got: unknown, exp: unknown) {
  const ok = cond ? 'PASS' : 'FAIL'
  if (!cond) failed++
  console.log(`[${ok}] ${name}  got=${JSON.stringify(got)}  exp=${JSON.stringify(exp)}`)
}
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

// ---- 人物修炼 0->25（依赖1 逐级权威表：经验=(n²+3n+11)×10，攻法猎×0.3万、抗修×0.2万）----
const cult = getCalc('cultivation')!
const r1 = compute(cult, { fromLevel: 0, toLevel: 25, count: 1 }, 100, 1)
assert('cultivation 0->25 总经验', r1.totalExp === 67750, r1.totalExp, 67750)
// 总万 = 67750 * (3*0.3 + 2*0.2) = 67750 * 1.3 = 88075
assert('cultivation 0->25 总万', near(r1.totalWan, 88075), r1.totalWan, 88075)
const atk = r1.perSlot.find((s) => s.key === 'atk')!
assert('cultivation 攻修 单项万', near(atk.moneyWan, 20325), atk.moneyWan, 20325)
assert('cultivation 抗修 单项万', near(r1.perSlot.find((s) => s.key === 'def')!.moneyWan, 13550), r1.perSlot.find((s) => s.key === 'def')!.moneyWan, 13550)
// 金价100元/3000万 => 1万=0.0333元；攻修20325万 => 677.5元
assert('cultivation 攻修 RMB@100', near(atk.rmb, 677.5), atk.rmb, 677.5)

// ---- 人物修炼：5 项各自独立设级 + 合计（multiEntry）----
const cultZero = { atk: { from: 0, to: 0 }, magic: { from: 0, to: 0 }, hunt: { from: 0, to: 0 }, def: { from: 0, to: 0 }, mdef: { from: 0, to: 0 } }
const c1 = compute(cult, { fromLevel: 0, toLevel: 25, count: 1, slotLevels: { ...cultZero, atk: { from: 0, to: 25 } } }, 100, 1)
assert('cultivation 多项 perSlot 5 项', c1.perSlot.length === 5, c1.perSlot.length, 5)
assert('cultivation 仅攻修满 → 合计=20325万', near(c1.totalWan, 20325), c1.totalWan, 20325)
assert('cultivation 未设项成本 0', c1.perSlot.find((s) => s.key === 'magic')!.moneyWan === 0, c1.perSlot.find((s) => s.key === 'magic')!.moneyWan, 0)
const cAll = compute(cult, { fromLevel: 0, toLevel: 25, count: 1, slotLevels: { atk: { from: 0, to: 25 }, magic: { from: 0, to: 25 }, hunt: { from: 0, to: 25 }, def: { from: 0, to: 25 }, mdef: { from: 0, to: 25 } } }, 100, 1)
assert('cultivation 5 项全满 → 合计=88075万', near(cAll.totalWan, 88075), cAll.totalWan, 88075)
// 部分区间（10→25 攻修）：Σ_{n=11..25} exp × 0.3
const cPart = compute(cult, { fromLevel: 0, toLevel: 25, count: 1, slotLevels: { ...cultZero, atk: { from: 10, to: 25 } } }, 100, 1)
let expPart = 0
for (let n = 11; n <= 25; n++) expPart += (n * n + 3 * n + 11) * 10
assert('cultivation 攻修 10->25 独立区间', near(cPart.totalWan, expPart * 0.3), cPart.totalWan, expPart * 0.3)

// ---- 召唤兽修炼 0->25（依赖1 权威口径：经验同人物修炼曲线，果=经验/150，金币=果×单价80万）----
const pet = getCalc('pet-cultivation')!
// 单区间模式：4 项（攻/法/物防/法防）分别计算后汇总；总万 = 4×单类型
const r2 = compute(pet, { fromLevel: 0, toLevel: 25, count: 1, fruitPrice: 80 }, 100, 1)
const petOne = 67750 / 150 * 80 // 451.6667 果 × 80万 = 36133.33万
assert('pet 0->25 总经验(单类型)', r2.totalExp === 67750, r2.totalExp, 67750)
assert('pet 0->25 修炼果数(单类型)', near(r2.fruitCount!, 67750 / 150, 0.01), r2.fruitCount, 451.6667)
assert('pet 单类型 0->25 金币万@80', near(r2.perSlot.find((s) => s.key === 'patk')!.moneyWan, petOne, 0.01), r2.perSlot.find((s) => s.key === 'patk')!.moneyWan, petOne)
assert('pet 0->25 总万 = 4×单类型', near(r2.totalWan, petOne * 4, 0.01), r2.totalWan, petOne * 4)
// 0->10 = 6600经验 = 44修炼果（社区公认锚点）、单类型金币=44×80=3520万
const r10 = compute(pet, { fromLevel: 0, toLevel: 10, count: 1, fruitPrice: 80 }, 100, 1)
assert('pet 0->10 修炼果=44', near(r10.fruitCount!, 44, 0.01), r10.fruitCount, 44)
assert('pet 0->10 单类型金币万@80', near(r10.perSlot.find((s) => s.key === 'patk')!.moneyWan, 3520, 0.01), r10.perSlot.find((s) => s.key === 'patk')!.moneyWan, 3520)
// 果价随输入缩放（100万/个）
const r2p = compute(pet, { fromLevel: 0, toLevel: 25, count: 1, fruitPrice: 100 }, 100, 1)
assert('pet 果价100 → 单类型 45166.67万', near(r2p.perSlot.find((s) => s.key === 'patk')!.moneyWan, 67750 / 150 * 100, 0.01), r2p.perSlot.find((s) => s.key === 'patk')!.moneyWan, 67750 / 150 * 100)

// ---- 召唤兽修炼：4 项各自独立设级 + 合计（multiEntry，含逐项果数与合计果数）----
const petZero = { patk: { from: 0, to: 0 }, pmagic: { from: 0, to: 0 }, pdef: { from: 0, to: 0 }, pmdef: { from: 0, to: 0 } }
const p1 = compute(pet, { fromLevel: 0, toLevel: 25, count: 1, fruitPrice: 80, slotLevels: { ...petZero, patk: { from: 0, to: 25 }, pmagic: { from: 0, to: 10 } } }, 100, 1)
assert('pet 多项 perSlot 4 项', p1.perSlot.length === 4, p1.perSlot.length, 4)
assert('pet 攻修满 逐项果数', near(p1.perSlot.find((s) => s.key === 'patk')!.fruitCount!, 451.6667, 0.01), p1.perSlot.find((s) => s.key === 'patk')!.fruitCount, 451.6667)
assert('pet 法修0->10 逐项果数=44', near(p1.perSlot.find((s) => s.key === 'pmagic')!.fruitCount!, 44, 0.01), p1.perSlot.find((s) => s.key === 'pmagic')!.fruitCount, 44)
assert('pet 多项 合计果数=451.67+44', near(p1.fruitCount!, 451.6667 + 44, 0.01), p1.fruitCount, 495.6667)
assert('pet 多项 合计万 = (451.67+44)×80', near(p1.totalWan, (67750 / 150 + 44) * 80, 0.01), p1.totalWan, (67750 / 150 + 44) * 80)

// ---- 师门技能 0->160（表驱动；经验列由依赖1 定比 8/3 反推，累计对齐依赖1 197,441,713）----
const ms = getCalc('master-skill')!
const r3 = compute(ms, { fromLevel: 0, toLevel: 160, count: 1 }, 100, 1)
console.log(`[INFO] 师门技能 0->160 单技能: 经验=${r3.totalExp} 梦幻币=${r3.totalWan.toFixed(2)}万`)
assert('师门技能 0->160 有值', r3.valid && r3.totalWan > 0, r3.totalWan, '>0')
// 经验列：依赖1 分段合计 0->160 = 197,441,713（定比换算误差 <200，占比 1e-6）
assert('师门技能 0->160 累计经验 ≈依赖1', near(r3.totalExp!, 197441713, 200), r3.totalExp, 197441713)
const r3b = compute(ms, { fromLevel: 0, toLevel: 180, count: 1 }, 100, 1)
assert('师门技能 0->180 累计经验 ≈依赖1合计', near(r3b.totalExp!, 660384473, 200), r3b.totalExp, 660384473)
// 经验/金钱定比：≤160 级为 8/3（依赖1 实测 2.667）
// 注意 r3 为单区间模式，totalWan 是 7 个技能之和，而 totalExp 是「单技能路径」经验 → 需用单技能金钱 7404.0588万
const msRatio = r3.totalExp! / (7404.0588 * 10000)
assert('师门技能 经验/金钱(两) ≈8/3', near(msRatio, 8 / 3, 0.001), msRatio, 8 / 3)

// ---- 师门技能：多技能分别计算（每技能独立区间）----
const msMulti = getCalc('master-skill')!
// 合并单区间模式（旧行为，7 槽共用 0->160）：= 7 × 单技能
const msOne = compute(msMulti, { fromLevel: 0, toLevel: 160, count: 1 }, 100, 1)
// 多技能：显式设全 7 项（对齐 UI 始终传全 7 项）；s1/s7 满级、其余 0->0
const msr = compute(
  msMulti,
  {
    fromLevel: 0,
    toLevel: 160,
    count: 1,
    slotLevels: {
      s1: { from: 0, to: 160 },
      s2: { from: 0, to: 0 },
      s3: { from: 0, to: 0 },
      s4: { from: 0, to: 0 },
      s5: { from: 0, to: 0 },
      s6: { from: 0, to: 0 },
      s7: { from: 0, to: 160 },
    },
  },
  100,
  1,
)
const perSkill = msr.perSlot.find((s) => s.key === 's1')!.moneyWan // 单技能 0->160
assert('师门技能 多技能 perSlot 7 项', msr.perSlot.length === 7, msr.perSlot.length, 7)
assert('师门技能 单技能 0->160 ≈7404.06万', near(perSkill, 7404.0588, 0.01), perSkill, 7404.0588)
assert('师门技能 s7 与 s1 同价', near(msr.perSlot.find((s) => s.key === 's7')!.moneyWan, perSkill, 0.01), msr.perSlot.find((s) => s.key === 's7')!.moneyWan, perSkill)
assert('师门技能 0->0 槽成本 0', msr.perSlot.find((s) => s.key === 's2')!.moneyWan === 0, msr.perSlot.find((s) => s.key === 's2')!.moneyWan, 0)
assert('师门技能 2 满级汇总 = 2×单技能', near(msr.totalWan, perSkill * 2, 0.01), msr.totalWan, perSkill * 2)
assert('师门技能 合并模式 = 7×单技能（旧行为保持）', near(msOne.totalWan, perSkill * 7, 0.01), msOne.totalWan, perSkill * 7)
assert('师门技能 多技能不展示经验列', msr.totalExp === undefined, msr.totalExp, undefined)
// 超 160 上限应非法
const msrBad = compute(
  msMulti,
  { fromLevel: 0, toLevel: 160, count: 1, slotLevels: { s1: { from: 0, to: 181 }, s2: { from: 0, to: 0 }, s3: { from: 0, to: 0 }, s4: { from: 0, to: 0 }, s5: { from: 0, to: 0 }, s6: { from: 0, to: 0 }, s7: { from: 0, to: 0 } } },
  100,
  1,
)
assert('师门技能 s1 0->181 超上限非法', msrBad.valid === false, msrBad.valid, false)

// ---- 师门技能 依赖2 锚点（单技能 0->150 / 0->180）----
const ms150 = compute(msMulti, { fromLevel: 0, toLevel: 150, count: 1, slotLevels: { s1: { from: 0, to: 150 }, s2: { from: 0, to: 0 }, s3: { from: 0, to: 0 }, s4: { from: 0, to: 0 }, s5: { from: 0, to: 0 }, s6: { from: 0, to: 0 }, s7: { from: 0, to: 0 } } }, 100, 1)
assert('师门技能 单技能 0->150 ≈3864.67万', near(ms150.perSlot.find((s) => s.key === 's1')!.moneyWan, 3864.6693, 0.01), ms150.perSlot.find((s) => s.key === 's1')!.moneyWan, 3864.6693)
const ms180 = compute(msMulti, { fromLevel: 0, toLevel: 180, count: 1, slotLevels: { s1: { from: 0, to: 180 }, s2: { from: 0, to: 0 }, s3: { from: 0, to: 0 }, s4: { from: 0, to: 0 }, s5: { from: 0, to: 0 }, s6: { from: 0, to: 0 }, s7: { from: 0, to: 0 } } }, 100, 1)
assert('师门技能 单技能 0->180 ≈21292.34万', near(ms180.perSlot.find((s) => s.key === 's1')!.moneyWan, 21292.341, 0.01), ms180.perSlot.find((s) => s.key === 's1')!.moneyWan, 21292.341)

// ---- 帮派技能（依赖2 口径：普通 0->160=3348.09万；强壮/神速 0->40=16670万）----
const guild = getCalc('guild-skill')!
const g1 = compute(guild, { fromLevel: 0, toLevel: 160, count: 1, slotLevels: { g1: { from: 0, to: 160 }, g2: { from: 0, to: 0 }, g3: { from: 0, to: 0 }, g4: { from: 0, to: 0 }, g5: { from: 0, to: 0 }, g6: { from: 0, to: 0 }, strong: { from: 0, to: 0 }, speed: { from: 0, to: 0 } } }, 100, 1)
assert('guild 普通 0->160 万', near(g1.perSlot.find((s) => s.key === 'g1')!.moneyWan, 3348.0902, 0.001), g1.perSlot.find((s) => s.key === 'g1')!.moneyWan, 3348.0902)
const gStr = compute(guild, { fromLevel: 0, toLevel: 40, count: 1, slotLevels: { g1: { from: 0, to: 0 }, g2: { from: 0, to: 0 }, g3: { from: 0, to: 0 }, g4: { from: 0, to: 0 }, g5: { from: 0, to: 0 }, g6: { from: 0, to: 0 }, strong: { from: 0, to: 40 }, speed: { from: 0, to: 0 } } }, 100, 1)
assert('guild 强壮 0->40 万', near(gStr.perSlot.find((s) => s.key === 'strong')!.moneyWan, 16670, 0.001), gStr.perSlot.find((s) => s.key === 'strong')!.moneyWan, 16670)
const gBad = compute(guild, { fromLevel: 0, toLevel: 160, count: 1, slotLevels: { g1: { from: 0, to: 0 }, g2: { from: 0, to: 0 }, g3: { from: 0, to: 0 }, g4: { from: 0, to: 0 }, g5: { from: 0, to: 0 }, g6: { from: 0, to: 0 }, strong: { from: 0, to: 50 }, speed: { from: 0, to: 0 } } }, 100, 1)
assert('guild 强壮 0->50 超上限非法', gBad.valid === false, gBad.valid, false)

// ---- 星辉石合成：递归数量(基数3) + 固定合成费（与 230金价/16单价 真值表逐行核验）----
const sl = getCalc('starlight')!
const slLadder = synthesisLadder(sl as any)
const slCnt = (lv: number) => slLadder.find((r) => r.level === lv)!.count
// 数量递归（基数3，9-11 含额外提交规则）
assert('starlight 数量(L8)=3^7', slCnt(8) === 2187, slCnt(8), 2187)
assert('starlight 数量(L9) 递归', slCnt(9) === 6642, slCnt(9), 6642)
assert('starlight 数量(L10) 递归', slCnt(10) === 20898, slCnt(10), 20898)
assert('starlight 数量(L11) 递归', slCnt(11) === 69336, slCnt(11), 69336)
// 体力（倍率30，区别于宝石的10）
assert('starlight 体力(L11)=300', slLadder.find((r) => r.level === 11)!.stamina === 300, slLadder.find((r) => r.level === 11)!.stamina, 300)
// 用「230金价 / 16单价」真值表逐行核验
const SP = 16
const slRow = (lv: number) => slCnt(lv) * SP + slLadder.find((r) => r.level === lv)!.feeWan
const slCum = (lv: number) => slLadder.filter((r) => r.level <= lv).reduce((s, r) => s + r.count * SP + r.feeWan, 0)
assert('starlight 本级(L2)@单价16', near(slRow(2), 48.23, 0.05), slRow(2), 48.23)
assert('starlight 本级(L7)@单价16', near(slRow(7), 11786, 1), slRow(7), 11786)
assert('starlight 本级(L11)@单价16', near(slRow(11), 1121063, 1), slRow(11), 1121063)
assert('starlight 累计(L11)@单价16', near(slCum(11), 1619373, 1), slCum(11), 1619373)
// 人民币显示（fmtRMB）对齐真值表人民币列
assert('starlight 本级人民币(L2)', fmtRMB(slRow(2) * 230 / 3000) === '3.70', fmtRMB(slRow(2) * 230 / 3000), '3.70')
assert('starlight 本级人民币(L11)', fmtRMB(slRow(11) * 230 / 3000) === '8.59万', fmtRMB(slRow(11) * 230 / 3000), '8.59万')
assert('starlight 累计人民币(L11)', fmtRMB(slCum(11) * 230 / 3000) === '12.42万', fmtRMB(slCum(11) * 230 / 3000), '12.42万')

// ---- 五色灵尘合成：递归数量(类斐波那契) + 固定合成费（与 230金价/30单价 真值表逐行核验）----
const cs = getCalc('colorstone')!
const csLadder = synthesisLadder(cs as any)
const csCnt = (lv: number) => csLadder.find((r) => r.level === lv)!.count
// 数量递归（基数2，3-15 含「前前级」额外提交规则：count(L)=2×count(L-1)+count(L-2)）
assert('colorstone 数量(L3)=5', csCnt(3) === 5, csCnt(3), 5)
assert('colorstone 数量(L6)=70', csCnt(6) === 70, csCnt(6), 70)
assert('colorstone 数量(L11)=5741', csCnt(11) === 5741, csCnt(11), 5741)
assert('colorstone 数量(L15)=195025', csCnt(15) === 195025, csCnt(15), 195025)
// 体力（倍率30，同星辉石）
assert('colorstone 体力(L15)=420', csLadder.find((r) => r.level === 15)!.stamina === 420, csLadder.find((r) => r.level === 15)!.stamina, 420)
// 用「230金价 / 30单价」真值表逐行核验
const CP = 30
const csRow = (lv: number) => csCnt(lv) * CP + csLadder.find((r) => r.level === lv)!.feeWan
const csCum = (lv: number) => csLadder.filter((r) => r.level <= lv).reduce((s, r) => s + r.count * CP + r.feeWan, 0)
assert('colorstone 本级(L2)@单价30', near(csRow(2), 60.23, 0.05), csRow(2), 60.23)
assert('colorstone 本级(L11)@单价30', near(csRow(11), 173788, 1), csRow(11), 173788)
assert('colorstone 累计(L11)@单价30', near(csCum(11), 296653.25, 1), csCum(11), 296653.25)
assert('colorstone 累计(L15)@单价30', near(csCum(15), 10078248.25, 10), csCum(15), 10078248.25)
// 人民币显示（fmtRMB）对齐真值表人民币列
assert('colorstone 本级人民币(L2)', fmtRMB(csRow(2) * 230 / 3000) === '4.62', fmtRMB(csRow(2) * 230 / 3000), '4.62')
assert('colorstone 累计人民币(L11)', fmtRMB(csCum(11) * 230 / 3000) === '2.27万', fmtRMB(csCum(11) * 230 / 3000), '2.27万')
assert('colorstone 累计人民币(L15)', fmtRMB(csCum(15) * 230 / 3000) === '77.27万', fmtRMB(csCum(15) * 230 / 3000), '77.27万')

// ---- 钟灵石合成：递归数量(基数3, L4/L6/L7/L8 断链额外提交) + 固定合成费（与 230金价/5单价 真值表逐行核验）----
const sp = getCalc('spirit')!
const spLadder = synthesisLadder(sp as any)
const spCnt = (lv: number) => spLadder.find((r) => r.level === lv)!.count
// 数量递归（基数3；L4/L6/L7/L8 额外提交低级别钟灵石，打断纯 3 次幂链）
assert('spirit 数量(L4)=36', spCnt(4) === 36, spCnt(4), 36)
assert('spirit 数量(L6)=432', spCnt(6) === 432, spCnt(6), 432)
assert('spirit 数量(L8)=8640', spCnt(8) === 8640, spCnt(8), 8640)
// 无体力（倍率0）
assert('spirit 体力(L8)=0', spLadder.find((r) => r.level === 8)!.stamina === 0, spLadder.find((r) => r.level === 8)!.stamina, 0)
// 用「230金价 / 5单价」真值表逐行核验
const SPI = 5
const spRow = (lv: number) => spCnt(lv) * SPI + spLadder.find((r) => r.level === lv)!.feeWan
const spCum = (lv: number) => spLadder.filter((r) => r.level <= lv).reduce((s, r) => s + r.count * SPI + r.feeWan, 0)
assert('spirit 本级(L2)@单价5', near(spRow(2), 16.0, 0.05), spRow(2), 16.0)
assert('spirit 本级(L8)@单价5', near(spRow(8), 54089, 1), spRow(8), 54089)
assert('spirit 累计(L8)@单价5', near(spCum(8), 68547, 1), spCum(8), 68547)
// 人民币显示（fmtRMB）对齐真值表人民币列
assert('spirit 本级人民币(L2)', fmtRMB(spRow(2) * 230 / 3000) === '1.23', fmtRMB(spRow(2) * 230 / 3000), '1.23')
assert('spirit 累计人民币(L8)', fmtRMB(spCum(8) * 230 / 3000) === '5255.27', fmtRMB(spCum(8) * 230 / 3000), '5255.27')
// 「消耗额外梦幻币」列（游戏固定合成费）：由 feeWan 按 count 递归反推，与单价无关
//   钟灵石 = (L-1)²：0,1,4,9,16,25,36,49
const spGameFee = spLadder.map((r) => r.gameFeeWan)
assert('spirit 消耗额外梦幻币(L1..L8)', spGameFee.every((v, i) => near(v, [0, 1, 4, 9, 16, 25, 36, 49][i], 0.001)), spGameFee, [0, 1, 4, 9, 16, 25, 36, 49])

// ---- 宝石合成：递归数量模型 + 固定合成费（与 230金价/2单价 真值表逐行核验）----
const gem = getCalc('gem')!
// 1->10（单价=10）：材料 = Σ_{k=2}^{10} 数量(k)×10 = (2^10-2)×10 = 10220万；合成费=148.58；合计=10368.58
const r5 = compute(gem, { fromLevel: 1, toLevel: 10, count: 1, matPriceWan: 10 }, 100, 1)
assert('gem 1->10 可计算', r5.valid === true, r5.valid, true)
assert('gem 1->10 材料万', near(r5.materialsWan!, 10220), r5.materialsWan, 10220)
assert('gem 1->10 合成费万', near(r5.feeWan!, 148.58), r5.feeWan, 148.58)
assert('gem 1->10 总万', near(r5.totalWan, 10368.58), r5.totalWan, 10368.58)
// 数量递归值（宝石 12-20 关键）
const gemLadder = synthesisLadder(gem as any)
const cnt = (lv: number) => gemLadder.find((r) => r.level === lv)!.count
assert('gem 数量(L12) 递归', cnt(12) === 2100, cnt(12), 2100)
assert('gem 数量(L13) 递归', cnt(13) === 4456, cnt(13), 4456)
assert('gem 数量(L20) 递归', cnt(20) === 2392444, cnt(20), 2392444)
// 用「230金价 / 2单价」真值表逐行核验
const P2 = 2
const rowWan = (lv: number) => cnt(lv) * P2 + gemLadder.find((r) => r.level === lv)!.feeWan
const cumWan = (lv: number) => gemLadder.filter((r) => r.level <= lv).reduce((s, r) => s + r.count * P2 + r.feeWan, 0)
assert('gem 本级(L2)@单价2 对齐真值表', near(rowWan(2), 4.08, 0.05), rowWan(2), 4.08)
assert('gem 本级(L13)@单价2 对齐真值表', near(rowWan(13), 9576.05, 1), rowWan(13), 9576.05)
assert('gem 本级(L20)@单价2 对齐真值表', near(rowWan(20), 5141549, 50), rowWan(20), 5141549)
assert('gem 累计(L10)@单价2 对齐真值表', near(cumWan(10), 2194.57, 1), cumWan(10), 2194.57)
assert('gem 累计(L20)@单价2 对齐真值表', near(cumWan(20), 8040871.08, 20), cumWan(20), 8040870)
// 默认单价(10)下核心口径
assert('gem 本级(L13)@单价10 对齐真值表', near(cnt(13) * 10 + 664.05, 45224.05, 1), cnt(13) * 10 + 664.05, 45224.05)
const gemCumL20_10 = gemLadder.reduce((s, r) => s + r.count * 10 + r.feeWan, 0)
assert('gem 累计(L20)@单价10 对齐真值表', near(gemCumL20_10, 37973247.08, 20), gemCumL20_10, 37973247.08)
// 单价翻倍(20)时：数量已含额外宝石，材料成本随单价翻倍，合成费固定
const rowWan20 = cnt(13) * 20 + gemLadder.find((r) => r.level === 13)!.feeWan
assert('gem 本级(L13)@单价20 缩放', near(rowWan20, 89784.05, 1), rowWan20, 89784.05)

// ---- 动物套选择（selector 类）：129 级按加成排序 ----
const aset = getCalc('animal-set')!
const a129 = computeAnimalSet(aset, 129) // 默认三件套
assert('动物套 129级(三件) 最高加成=48', a129.animalRows![0].bonus === 48, a129.animalRows![0].bonus, 48)
assert('动物套 修罗傀儡妖(超1线) 129级 三件加成=48', a129.animalRows!.find((r) => r.name === '修罗傀儡妖')!.bonus === 48, a129.animalRows!.find((r) => r.name === '修罗傀儡妖')!.bonus, 48)
const ba = a129.animalRows!.find((r) => r.name === '巴蛇')!
assert('动物套 巴蛇 129级 三件加成=47', ba.bonus === 47, ba.bonus, 47)
const ph = a129.animalRows!.find((r) => r.name === '凤凰')!
assert('动物套 凤凰(2线) 129级 三件加成=42', ph.bonus === 42, ph.bonus, 42)
// 三件套 / 五件套加成应不同（用户指出两者数值不同）
assert('动物套 巴蛇 三件≠五件', ba.threeBonus !== ba.fiveBonus, `${ba.threeBonus}/${ba.fiveBonus}`, true)
assert('动物套 巴蛇 129级 五件加成=57', ba.fiveBonus === 57, ba.fiveBonus, 57)
assert('动物套 修罗 129级 五件加成=58', a129.animalRows!.find((r) => r.name === '修罗傀儡妖')!.fiveBonus === 58, a129.animalRows!.find((r) => r.name === '修罗傀儡妖')!.fiveBonus, 58)
assert('动物套 凤凰 129级 五件加成=47', ph.fiveBonus === 47, ph.fiveBonus, 47)
// 五件套整体排名应改用五件加成（最高=58）
const a129_5 = computeAnimalSet(aset, 129, 5)
assert('动物套 129级(五件) 最高加成=58', a129_5.animalRows![0].bonus === 58, a129_5.animalRows![0].bonus, 58)
assert('动物套 129级(五件) 首选为超1线套装', a129_5.animalRows![0].tier === '超1', a129_5.animalRows![0].name, '超1线')
// 0 级应返回 invalid
const a0 = computeAnimalSet(aset, 0)
assert('动物套 0级 非法', a0.valid === false, a0.valid, false)
// 低等级(<120) 1线应高于超1线：100 级巴蛇(1线)=40 > 修罗(超1)=38
const a100 = computeAnimalSet(aset, 100)
assert('动物套 100级 首选=巴蛇(1线)', a100.animalRows![0].name === '巴蛇', a100.animalRows![0].name, '巴蛇')
assert('动物套 100级 最高加成=40', a100.animalRows![0].bonus === 40, a100.animalRows![0].bonus, 40)
const a100_5 = computeAnimalSet(aset, 100, 5)
assert('动物套 100级(五件) 首选=巴蛇', a100_5.animalRows![0].name === '巴蛇', a100_5.animalRows![0].name, '巴蛇')
assert('动物套 100级(五件) 最高加成=50', a100_5.animalRows![0].bonus === 50, a100_5.animalRows![0].bonus, 50)

// ---- 固伤加成换算（估价表「自动计算固伤加成」）----
const fd = getCalc('fixed-damage')!
const fdEmpty: Record<FixedDamageItem, number> = { damage: 0, agility: 0, magicCult: 0, swordStone: 0, meteor: 0 }
// 女儿村 490伤害/0敏捷 → 主秒343(490×0.7) 副秒98(490×0.2)
const fdN1 = computeFixedDamage(fd, 'nver', { ...fdEmpty, damage: 490 })
assert('固伤 女儿村 490伤害 主秒=343', fdN1.fixedDamage!.mainHit === 343, fdN1.fixedDamage!.mainHit, 343)
assert('固伤 女儿村 490伤害 副秒=98', fdN1.fixedDamage!.subHit === 98, fdN1.fixedDamage!.subHit, 98)
// 武器3：500伤害/0敏捷 → 主秒350 副秒100
const fdN2 = computeFixedDamage(fd, 'nver', { ...fdEmpty, damage: 500 })
assert('固伤 女儿村 500伤害 主秒=350', fdN2.fixedDamage!.mainHit === 350, fdN2.fixedDamage!.mainHit, 350)
assert('固伤 女儿村 500伤害 副秒=100', fdN2.fixedDamage!.subHit === 100, fdN2.fixedDamage!.subHit, 100)
// 武器2：467伤害+19敏捷 → 主秒336.78(467×0.7+19×0.52) 副秒103.28(467×0.2+19×0.52)
const fdN3 = computeFixedDamage(fd, 'nver', { ...fdEmpty, damage: 467, agility: 19 })
assert('固伤 女儿村 467伤害+19敏捷 主秒=336.78', near(fdN3.fixedDamage!.mainHit, 336.78), fdN3.fixedDamage!.mainHit, 336.78)
assert('固伤 女儿村 467伤害+19敏捷 副秒=103.28', near(fdN3.fixedDamage!.subHit, 103.28), fdN3.fixedDamage!.subHit, 103.28)
// 普陀山 试剑石/落星飞鸿 副秒系数为 0
const fdP = computeFixedDamage(fd, 'putuo', { ...fdEmpty, swordStone: 9, meteor: 2 })
assert('固伤 普陀山 试剑石副秒=0', fdP.fixedDamage!.rows.find((r) => r.key === 'swordStone')!.sub === 0, fdP.fixedDamage!.rows.find((r) => r.key === 'swordStone')!.sub, 0)
assert('固伤 普陀山 落星副秒=0', fdP.fixedDamage!.rows.find((r) => r.key === 'meteor')!.sub === 0, fdP.fixedDamage!.rows.find((r) => r.key === 'meteor')!.sub, 0)
assert('固伤 普陀山 试剑石主秒=225(9×25)', fdP.fixedDamage!.rows.find((r) => r.key === 'swordStone')!.main === 225, fdP.fixedDamage!.rows.find((r) => r.key === 'swordStone')!.main, 225)

// ---- 固伤武器副秒计算及性价比对比（估价表「自动计算固伤加成」L2:T6）----
// 女儿村三把武器：武器1(490伤/0敏/10元) 武器2(467伤/19敏/333元) 武器3(500伤/0敏/333元)
const fdw = getCalc('fd-weapon')!
const fdwR = computeFdWeapon(fdw, 'nver', [
  { damage: 490, agility: 0, price: 10 },
  { damage: 467, agility: 19, price: 333 },
  { damage: 500, agility: 0, price: 333 },
])
const fdw1 = fdwR.fdWeapon!.rows.find((r) => r.name === '武器1')!
const fdw2 = fdwR.fdWeapon!.rows.find((r) => r.name === '武器2')!
const fdw3 = fdwR.fdWeapon!.rows.find((r) => r.name === '武器3')!
assert('固伤武器 武器1 主秒=343', fdw1.mainHit === 343, fdw1.mainHit, 343)
assert('固伤武器 武器1 副秒=98', fdw1.subHit === 98, fdw1.subHit, 98)
assert('固伤武器 武器1 每元副秒=9.8', near(fdw1.subPerYuan, 9.8), fdw1.subPerYuan, 9.8)
assert('固伤武器 武器2 主秒=336.78', near(fdw2.mainHit, 336.78), fdw2.mainHit, 336.78)
assert('固伤武器 武器2 副秒=103.28', near(fdw2.subHit, 103.28), fdw2.subHit, 103.28)
assert('固伤武器 武器2 每元副秒=0.31', near(fdw2.subPerYuan, 0.31015015015015013), fdw2.subPerYuan, 0.31)
assert('固伤武器 武器3 每元副秒=0.3003', near(fdw3.subPerYuan, 0.3003003003003003), fdw3.subPerYuan, 0.30)
// 性价比排名：按每元副秒降序 → 武器1(9.8) > 武器2(0.31) > 武器3(0.30)
assert('固伤武器 武器1 排名=1', fdw1.rank === 1, fdw1.rank, 1)
assert('固伤武器 武器2 排名=2', fdw2.rank === 2, fdw2.rank, 2)
assert('固伤武器 武器3 排名=3', fdw3.rank === 3, fdw3.rank, 3)

// ---- 乱敏（速度波动）概率分析：须弥面板 601，开天阵 ----
const scDef = getCalc('speed-chaos')!
const scR = computeSpeedChaos(scDef, 601, true)
const sc = scR.speedChaos!
assert('乱敏 须弥战斗范围下限=570', sc.battleMin === 570, sc.battleMin, 570)
assert('乱敏 须弥战斗范围上限=631', sc.battleMax === 631, sc.battleMax, 631)
assert('乱敏 梯队数=5', sc.tiers.length === 5, sc.tiers.length, 5)
// 开天阵：5速≥740 / 4速≥819 / 3速≥906 / 2速≥1003 / 1速≥1109
const t5 = sc.tiers.find((t) => t.pos === 5)!
const t4 = sc.tiers.find((t) => t.pos === 4)!
const t3 = sc.tiers.find((t) => t.pos === 3)!
const t2 = sc.tiers.find((t) => t.pos === 2)!
const t1 = sc.tiers.find((t) => t.pos === 1)!
assert('乱敏 5速要求面板≥740', t5.requiredPanel === 740, t5.requiredPanel, 740)
assert('乱敏 5速天阵减少后=666', t5.afterArray === 666, t5.afterArray, 666)
assert('乱敏 5速波动范围=632-699', t5.minBattle === 632 && t5.maxBattle === 699, [t5.minBattle, t5.maxBattle], [632, 699])
assert('乱敏 4速要求面板≥819', t4.requiredPanel === 819, t4.requiredPanel, 819)
assert('乱敏 4速天阵减少后=737', t4.afterArray === 737, t4.afterArray, 737)
assert('乱敏 3速要求面板≥906', t3.requiredPanel === 906, t3.requiredPanel, 906)
assert('乱敏 3速天阵减少后=815', t3.afterArray === 815, t3.afterArray, 815)
assert('乱敏 2速要求面板≥1003', t2.requiredPanel === 1003, t2.requiredPanel, 1003)
assert('乱敏 2速天阵减少后=902', t2.afterArray === 902, t2.afterArray, 902)
assert('乱敏 1速要求面板≥1109', t1.requiredPanel === 1109, t1.requiredPanel, 1109)
assert('乱敏 1速天阵减少后=998', t1.afterArray === 998, t1.afterArray, 998)
// 不开天阵：人物速度不 ×0.9；5速需 floor(panel×0.95) > 631 → panel≥666
const scOff = computeSpeedChaos(scDef, 601, false)
const t5off = scOff.speedChaos!.tiers.find((t) => t.pos === 5)!
assert('乱敏(不开天阵) 5速要求面板≥666', t5off.requiredPanel === 666, t5off.requiredPanel, 666)
assert('乱敏(不开天阵) 5速波动范围=632-699', t5off.minBattle === 632 && t5off.maxBattle === 699, [t5off.minBattle, t5off.maxBattle], [632, 699])
// 非法
const sc0 = computeSpeedChaos(scDef, 0, true)
assert('乱敏 0面板 非法', sc0.valid === false, sc0.valid, false)

// ---- 乱敏判定（人兽/人人/兽兽）----
// 不开天阵 人人：低速802人 / 高速887人 → 不乱敏（高速一定更快）
const cc1 = computeChaosCheck(802, '人物', 887, '人物', false)
assert('乱敏判定 不开天阵人人 低速[761,842]', cc1.low.min === 761 && cc1.low.max === 842, [cc1.low.min, cc1.low.max], [761, 842])
assert('乱敏判定 不开天阵人人 高速[842,931]', cc1.high.min === 842 && cc1.high.max === 931, [cc1.high.min, cc1.high.max], [842, 931])
assert('乱敏判定 不开天阵人人 不乱敏', cc1.isChaos === false, cc1.isChaos, false)
assert('乱敏判定 不开天阵人人 差值=0', cc1.diff === 0, cc1.diff, 0)
// 开天阵 人人：低速803人 / 高速878人 → 会乱敏（范围重叠）
const cc2 = computeChaosCheck(803, '人物', 878, '人物', true)
assert('乱敏判定 开天阵人人 低速天阵后722[685,758]', cc2.low.after === 722 && cc2.low.min === 685 && cc2.low.max === 758, [cc2.low.after, cc2.low.min, cc2.low.max], [722, 685, 758])
assert('乱敏判定 开天阵人人 高速天阵后790[750,829]', cc2.high.after === 790 && cc2.high.min === 750 && cc2.high.max === 829, [cc2.high.after, cc2.high.min, cc2.high.max], [790, 750, 829])
assert('乱敏判定 开天阵人人 会乱敏', cc2.isChaos === true, cc2.isChaos, true)
assert('乱敏判定 开天阵人人 差值=8', cc2.diff === 8, cc2.diff, 8)
// 兽人 不开天阵：低速357宝宝 / 高速441人 → 不乱敏（宝宝永不×0.9，人物不开天阵不×0.9）
const cc3 = computeChaosCheck(357, '宝宝', 441, '人物', false)
assert('乱敏判定 兽人 低速宝宝357[339,374]', cc3.low.after === 357 && cc3.low.min === 339 && cc3.low.max === 374, [cc3.low.after, cc3.low.min, cc3.low.max], [357, 339, 374])
assert('乱敏判定 兽人 不乱敏', cc3.isChaos === false, cc3.isChaos, false)

// ---- 体活计算：自动恢复 + 恢复时间 + 使用方案对比 + 四块收益 ----
const vt = getCalc('vitality')!
const vtInput = (over: Partial<Parameters<typeof computeVitality>[1]> = {}) =>
  computeVitality(vt, {
    physicalCurrent: 0, physicalTarget: 1325, vitalityCurrent: 0, vitalityTarget: 1501,
    level: 175, fitness: 100, regimen: 144,
    pointCardPrice: 1.56, liangcaoPrice: 0.5, baishouQuality: 140, baishouPrice: 10, haimaPrice: 18,
    ...over,
  })
// 自动恢复（175级·健身100·养生144）：体力上限1325/每5恢复18；活力上限1501/每5恢复20
const vtCap = vtInput()
assert('体活 自动体力上限=1325', vtCap.cap.capPhysical === 1325, vtCap.cap.capPhysical, 1325)
assert('体活 自动体力每5恢复=18', vtCap.cap.recoverPhysical === 18, vtCap.cap.recoverPhysical, 18)
assert('体活 自动活力上限=1501', vtCap.cap.capVitality === 1501, vtCap.cap.capVitality, 1501)
assert('体活 自动活力每5恢复=20', vtCap.cap.recoverVitality === 20, vtCap.cap.recoverVitality, 20)
// 恢复时间：体力 0→1325（recover18）→ 1325/18=73.6 → 74×5=370分钟
assert('体活 体力恢复 0→满需370分钟', vtCap.physical.minutes === 370, vtCap.physical.minutes, 370)
// 活力 0→1501（recover20）→ 1501/20=75.05 → 76×5=380分钟（对拍用户"6小时20分"）
assert('体活 活力恢复 0→满需380分钟', vtCap.vitality.minutes === 380, vtCap.vitality.minutes, 380)
// 当前=目标 → 0
const vtEq = vtInput({ physicalCurrent: 1325, physicalTarget: 1325, vitalityCurrent: 1501, vitalityTarget: 1501 })
assert('体活 当前=目标 → 0分钟', vtEq.physical.minutes === 0 && vtEq.physical.valid, vtEq.physical.minutes, 0)
// 目标>上限 → 仍算差值但警告
const vtOver = vtInput({ physicalCurrent: 0, physicalTarget: 2000, vitalityCurrent: 0, vitalityTarget: 0 })
assert('体活 目标>上限 仍按差值算', vtOver.physical.minutes > 0 && (vtOver.physical.message ?? '').includes('超过上限'), vtOver.physical.message, '超过上限')
// 四块收益对拍（样本 175/健身100/养生144/点卡1.56/粮草0.5/百岁品140价10/海马18）
assert('体活 收益·在线保点卡 净≈0.17万/时', near(vtCap.profit.pointCard.net, 0.17, 0.05), vtCap.profit.pointCard.net, 0.17)
// 粮草挂机【口径修正】：挂机万界通廊期间体活不恢复 → 只算粮草收入，不计体活变现
// 0.5万/个 × 20个/时 − 点卡(1.56×6=9.36) = 0.64 万/时
assert('体活 收益·粮草挂机 净≈0.64万/时 (仅粮草−点卡)', near(vtCap.profit.liangcao.net, 0.64, 0.05), vtCap.profit.liangcao.net, 0.64)
assert('体活 收益·粮草挂机 体活收入=0（挂机不恢复）', vtCap.profit.liangcao.physicalIncome === 0 && vtCap.profit.liangcao.vitalityIncome === 0, [vtCap.profit.liangcao.physicalIncome, vtCap.profit.liangcao.vitalityIncome], [0, 0])
assert('体活 收益·粮草挂机 粮草收入=10万 (=0.5×20)', near(vtCap.profit.liangcao.extraIncome, 10, 0.001), vtCap.profit.liangcao.extraIncome, 10)
assert('体活 收益·吃百岁香 净≈7.43万', near(vtCap.profit.baishou.net, 7.43, 0.05), vtCap.profit.baishou.net, 7.43)
assert('体活 收益·吃海马 净≈12.61万', near(vtCap.profit.haima.net, 12.61, 0.05), vtCap.profit.haima.net, 12.61)
assert('体活 收益·在线保点卡 赚', vtCap.profit.pointCard.profitable === true, vtCap.profit.pointCard.profitable, true)
assert('体活 收益·吃海马 体力收入≈5.78万', near(vtCap.profit.haima.physicalIncome, 5.78, 0.05), vtCap.profit.haima.physicalIncome, 5.78)
assert('体活 收益·吃海马 活力收入≈24.84万', near(vtCap.profit.haima.vitalityIncome, 24.84, 0.05), vtCap.profit.haima.vitalityIncome, 24.84)
// 使用方案降序：临时符7.74 > 聚神1.79 > 书店1.62 > 灵犀1.51（全部自动派生）
// 注：本表只列体活变现方式，「挂机万界通廊（粮草）」不消耗体活、不进本表（见下方收益分析）
assert('体活 方案数=4', vtCap.plans.length === 4, vtCap.plans.length, 4)
assert('体活 方案表不含粮草', vtCap.plans.every((p) => p.key !== 'liangcao'), vtCap.plans.map((p) => p.key).join(','), 'no-liangcao')
assert('体活 默认最优=临时符', vtCap.bestPlanKey === 'talisman', vtCap.bestPlanKey, 'talisman')
// 体力与活力【同时恢复、可同时进行】→ 按资源各取一个最优，UI 分别高亮
assert('体活 体力最优=聚神瓶(1.79>书店1.62>灵犀1.51)', vtCap.bestPhysicalKey === 'jushen', vtCap.bestPhysicalKey, 'jushen')
assert('体活 活力最优=临时符(7.74)', vtCap.bestVitalityKey === 'talisman', vtCap.bestVitalityKey, 'talisman')
assert('体活 两个最优互不重复', vtCap.bestPhysicalKey !== vtCap.bestVitalityKey, [vtCap.bestPhysicalKey, vtCap.bestVitalityKey], 'different')
assert(
  '体活 方案降序 临时符→聚神瓶→书店→灵犀',
  vtCap.plans.map((p) => p.key).join(',') === 'talisman,jushen,bookstore,lingxi',
  vtCap.plans.map((p) => p.key).join(','),
  'talisman,jushen,bookstore,lingxi',
)
// 联动：临时符单价降到1.0万 → 派生临时符≈1.6万/时 < 聚神瓶(≈1.79) → 最优翻为聚神瓶
const vtLinkDown = vtInput({ profitOverride: { talismanPrice: 1.0 } })
assert('体活 联动·临时符单价1.0 → 最优=聚神瓶', vtLinkDown.bestPlanKey === 'jushen', vtLinkDown.bestPlanKey, 'jushen')
// 联动：聚神瓶单价升到50万 → 派生聚神瓶≈8.12万/时 > 临时符(≈7.74) → 最优=聚神瓶
const vtLinkUp = vtInput({ profitOverride: { jushenPrice: 50 } })
assert('体活 联动·聚神瓶单价50 → 最优=聚神瓶', vtLinkUp.bestPlanKey === 'jushen', vtLinkUp.bestPlanKey, 'jushen')
// 联动派生值精确对拍（与「收益分析」同源：单价×每小时恢复点数）
const vpJushen = vtCap.plans.find((p) => p.key === 'jushen')!
const vpTalisman = vtCap.plans.find((p) => p.key === 'talisman')!
assert('体活 联动·聚神瓶派生≈1.79万/时 (=11/1330×216)', near(vpJushen.silverPerHour, (11 / 1330) * 216, 0.01), vpJushen.silverPerHour, 1.79)
assert('体活 联动·临时符派生≈7.74万/时 (=4.8384/150×240)', near(vpTalisman.silverPerHour, (4.8384 / 150) * 240, 0.01), vpTalisman.silverPerHour, 7.74)
// 灵犀之屑派生（已扣每次 42 万炼制费）：(35×1.36 − 42) ÷ 800 × 216 = 5.6/800×216 ≈ 1.512 万/时
const vpLingxi = vtCap.plans.find((p) => p.key === 'lingxi')!
assert('体活 联动·灵犀之屑 标记为自动派生', vpLingxi.derive === 'lingxi', vpLingxi.derive, 'lingxi')
assert(
  '体活 联动·灵犀之屑派生≈1.51万/时 (=(35×1.36−42)/800×216)',
  near(vpLingxi.silverPerHour, ((35 * 1.36 - 42) / 800) * 216, 0.01),
  vpLingxi.silverPerHour,
  1.51,
)
// 炼制费必须生效：每次炼制银两设 0 → 派生 = 47.6/800×216 ≈ 12.85 万/时 → 最优翻为灵犀之屑
const vtLingxiNoCost = vtInput({ profitOverride: { lingxiRefineCost: 0 } })
const vpLingxiNoCost = vtLingxiNoCost.plans.find((p) => p.key === 'lingxi')!
assert(
  '体活 联动·灵犀之屑 不扣炼制费≈12.85万/时',
  near(vpLingxiNoCost.silverPerHour, ((35 * 1.36) / 800) * 216, 0.01),
  vpLingxiNoCost.silverPerHour,
  12.85,
)
assert('体活 联动·灵犀之屑 不扣炼制费 → 最优=灵犀', vtLingxiNoCost.bestPlanKey === 'lingxi', vtLingxiNoCost.bestPlanKey, 'lingxi')
// 涨价联动：灵犀之屑涨到 60 万/个 → (60×1.36−42)/800×216 ≈ 10.69 万/时 > 临时符 7.74 → 最优=灵犀
const vtLingxiUp = vtInput({ profitOverride: { lingxiPrice: 60 } })
assert('体活 联动·灵犀之屑售价60 → 最优=灵犀', vtLingxiUp.bestPlanKey === 'lingxi', vtLingxiUp.bestPlanKey, 'lingxi')
assert('体活 联动·灵犀之屑售价60 → 体力最优=灵犀', vtLingxiUp.bestPhysicalKey === 'lingxi', vtLingxiUp.bestPhysicalKey, 'lingxi')
// 书店打工派生（官方固定汇率）：40体力→3000两现金 / 3750两储备金，二选一
//   现金 =(0.3/40)×216 = 1.62 万/时；储备金 =(0.375/40)×216 = 2.025 万/时（对拍 fbbizyy 样本 1.6 / 2.0）
const vpBookstore = vtCap.plans.find((p) => p.key === 'bookstore')!
assert('体活 联动·书店打工 标记为自动派生', vpBookstore.derive === 'bookstore', vpBookstore.derive, 'bookstore')
assert(
  '体活 联动·书店打工 现金≈1.62万/时 (=0.3/40×216)',
  near(vpBookstore.silverPerHour, (0.3 / 40) * 216, 0.01),
  vpBookstore.silverPerHour,
  1.62,
)
assert(
  '体活 联动·书店打工 储备金≈2.03万/时 (=0.375/40×216)',
  near(vpBookstore.reservePerHour, (0.375 / 40) * 216, 0.01),
  vpBookstore.reservePerHour,
  2.03,
)
// 保底 1 个（不爆）时是亏的：(35×1 − 42)/800×216 ≈ −1.89 万/时
const vtLingxiBase = vtInput({ profitOverride: { lingxiPerRefine: 1 } })
const vpLingxiBase = vtLingxiBase.plans.find((p) => p.key === 'lingxi')!
assert(
  '体活 联动·灵犀之屑 保底1个→亏损≈−1.89万/时',
  near(vpLingxiBase.silverPerHour, ((35 - 42) / 800) * 216, 0.01),
  vpLingxiBase.silverPerHour,
  -1.89,
)

console.log(failed === 0 ? '\nALL PASS ✅' : `\n${failed} FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
