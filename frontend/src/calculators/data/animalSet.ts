// 动物套（变身术套装）数据，来源：藏宝阁自动估价表2024-08-08.xlsx → 动物套大全
// 加成公式：floor(等级 / divisor + base)，base 区分三件套 / 五件套。
//   估价表「加成方式」列写作「等级/X+Y，Z」：Y = 三件套基础值，Z = 五件套基础值。
//   1线: 三件 /4+15、五件 /4+25   超1线: 三件 /3+5、五件 /3+15   2线: 三件 /4+10、五件 /4+15
// 与估价表 col I/J 在 129 级时的值一致（如 巴蛇 三件47.25/五件57.25 → floor 后 47/57；本公式 floor 对齐游戏显示）。
// 三件套/五件套触发几率：多数 0.03 / 0.1，蛟龙、雨师为 0.05 / 0.15。

import type { AnimalSet } from '../engine/types'

// 加成公式 floor(等级 / divisor + base)，base 区分三件/五件：
//   估价表「动物套大全」加成方式列写作「等级/X+Y，Z」：Y=三件基础值，Z=五件基础值。
//   1线: 三件 /4+15，五件 /4+25（Z=Y+10）
//   超1线: 三件 /3+5，五件 /3+15（Z=Y+10）
//   2线: 三件 /4+10，五件 /4+15（Z=Y+5，注意 2线不是统一 +10）
// 1线：divisor=4, base=15, fiveBase=25
const T1 = { divisor: 4, base: 15, fiveBase: 25, threeRate: 0.03, fiveRate: 0.1 } as const
// 超1线：divisor=3, base=5, fiveBase=15
const T11 = { divisor: 3, base: 5, fiveBase: 15, threeRate: 0.03, fiveRate: 0.1 } as const
// 2线：divisor=4, base=10, fiveBase=15
const T2 = { divisor: 4, base: 10, fiveBase: 15, threeRate: 0.03, fiveRate: 0.1 } as const
// 2线（高触发）：蛟龙、雨师
const T2H = { divisor: 4, base: 10, fiveBase: 15, threeRate: 0.05, fiveRate: 0.15 } as const

export const ANIMAL_SETS: AnimalSet[] = [
  // ===== 敏捷套 =====
  { name: '巴蛇', attr: '敏捷', skill: '高级毒', impact: '无', tier: 1, ...T1 },
  { name: '画魂', attr: '敏捷', skill: '高级幸运', impact: '无', tier: 1, ...T1 },
  { name: '机关鸟', attr: '敏捷', skill: '高级再生，-5%防御', impact: '负', tier: 1, ...T1 },
  { name: '猫灵（人型）', attr: '敏捷', skill: '敏捷，+10%速度', impact: '正', tier: 1, ...T1 },
  { name: '雾中仙', attr: '敏捷', skill: '高级敏捷，-10%防御', impact: '负', tier: 1, ...T1 },
  { name: '修罗傀儡妖', attr: '敏捷', skill: '必杀', impact: '无', tier: '超1', ...T11 },
  { name: '凤凰', attr: '敏捷', skill: '飞行', impact: '无', tier: 2, ...T2 },
  { name: '吸血鬼', attr: '敏捷', skill: '偷袭，-5%速度', impact: '负', tier: 2, ...T2 },
  { name: '幽灵', attr: '敏捷', skill: '高级夜战', impact: '无', tier: 2, ...T2 },

  // ===== 魔力套 =====
  { name: '葫芦宝贝', attr: '魔力', skill: '慧根，+5%气血', impact: '正', tier: 1, ...T1 },
  { name: '灵鹤', attr: '魔力', skill: '高级魔心，-10%防御', impact: '负', tier: 1, ...T1 },
  { name: '炎魔神', attr: '魔力', skill: '高级魔心，-15%气血', impact: '负', tier: 1, ...T1 },
  { name: '混沌兽', attr: '魔力', skill: '高级魔心，-12%气血', impact: '负', tier: '超1', ...T11 },
  { name: '蜃气妖', attr: '魔力', skill: '魔心，+30防御', impact: '正', tier: '超1', ...T11 },
  { name: '长眉灵猴', attr: '魔力', skill: '法爆，-10%气血', impact: '负', tier: '超1', ...T11 },
  { name: '蛟龙', attr: '魔力', skill: '永恒/感知', impact: '无', tier: 2, ...T2H },
  { name: '净瓶女娲', attr: '魔力', skill: '高级永恒，-5%防御', impact: '负', tier: 2, ...T2 },
  { name: '灵符女娲', attr: '魔力', skill: '魔心', impact: '正', tier: 2, ...T2 },
  { name: '如意仙子', attr: '魔力', skill: '+8%速度，+20灵力', impact: '正', tier: 2, ...T2 },
  { name: '星灵仙子', attr: '魔力', skill: '慧根，+10灵力', impact: '正', tier: 2, ...T2 },
  { name: '雨师', attr: '魔力', skill: '+20灵力', impact: '正', tier: 2, ...T2H },

  // ===== 力量套 =====
  { name: '狂豹（人型）', attr: '力量', skill: '高级飞行，+5%速度', impact: '正', tier: 1, ...T1 },
  { name: '噬天虎', attr: '力量', skill: '高级强力，-10%速度', impact: '负', tier: 1, ...T1 },
  { name: '夜罗刹', attr: '力量', skill: '高级夜战，+5%速度', impact: '正', tier: 1, ...T1 },
  { name: '巨力神猿', attr: '力量', skill: '高级强力，-5灵力', impact: '负', tier: '超1', ...T11 },
  { name: '修罗傀儡鬼', attr: '力量', skill: '夜战，+150气血', impact: '正', tier: '超1', ...T11 },
  { name: '鬼将', attr: '力量', skill: '高级必杀，-10%伤害', impact: '负', tier: 2, ...T2 },
  { name: '巡游天神', attr: '力量', skill: '必杀，-20%速度', impact: '负', tier: 2, ...T2 },

  // ===== 体质套 =====
  { name: '大力金刚', attr: '体质', skill: '高防，-5%灵力', impact: '负', tier: 1, ...T1 },
  { name: '机关兽', attr: '体质', skill: '+10%速度', impact: '正', tier: 1, ...T1 },
  { name: '踏云兽', attr: '体质', skill: '+10%气血', impact: '正', tier: 1, ...T1 },
  { name: '金身罗汉', attr: '体质', skill: '+10%气血，+50魔法', impact: '正', tier: '超1', ...T11 },
  { name: '藤蔓妖花', attr: '体质', skill: '毒，+100命中', impact: '正', tier: '超1', ...T11 },

  // ===== 耐力套 =====
  { name: '红萼仙子', attr: '耐力', skill: '+5%速度，+5%气血', impact: '正', tier: 1, ...T1 },
  { name: '连弩车', attr: '耐力', skill: '高级强力，-10%气血', impact: '负', tier: 1, ...T1 },
  { name: '龙龟', attr: '耐力', skill: '高防，-5%灵力/法防，-15%气血', impact: '负', tier: 1, ...T1 },
  { name: '幽萤娃娃', attr: '耐力', skill: '防御，+5%速度', impact: '正', tier: 1, ...T1 },
  { name: '曼珠沙华', attr: '耐力', skill: '高敏，-9%防御', impact: '负', tier: '超1', ...T11 },
  { name: '蝎子精', attr: '耐力', skill: '高反，-10%气血', impact: '负', tier: '超1', ...T11 },
  { name: '芙蓉仙子', attr: '耐力', skill: '再生，-30防御', impact: '负', tier: 2, ...T2 },
  { name: '律法女娲', attr: '耐力', skill: '高反，-10%速度', impact: '负', tier: 2, ...T2 },
]
