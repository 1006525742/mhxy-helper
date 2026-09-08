<script setup lang="ts">
import { ref, computed } from 'vue'

// ============================================================
// 天地砍王 · 地煞星 速度配速（首版：109 地煞 + 鸟翔阵）
//
// 数据说明（硬编码，后续扩展等级/阵法时迁移到独立 data 文件）：
//   - 阵位加成：鸟翔阵 ①+20% / ②③+10% / ④⑤+15%（全速型阵法）
//   - 辅助目标：快过神封（~900）；物理目标：快过长生（~540）
//   - steady 稳健 = 考虑乱敏（±5%）后的推荐面板速度
//   - limit  极限 = 理论最低面板速度（赌乱敏下限，不推荐日常使用）
// ============================================================

interface SpeedData {
  steady: number
  limit: number
  hint: string
}

type Role = 'support' | 'physical'

const DATA: Record<Role, Record<number, SpeedData>> = {
  support: {
    1: { steady: 880, limit: 750, hint: '抢一速' },
    2: { steady: 960, limit: 818, hint: '需流云' },
    3: { steady: 960, limit: 818, hint: '需流云' },
    4: { steady: 920, limit: 783, hint: '抢一速' },
    5: { steady: 920, limit: 783, hint: '抢一速' },
  },
  physical: {
    1: { steady: 530, limit: 450, hint: '结算636' },
    2: { steady: 560, limit: 491, hint: '结算616' },
    3: { steady: 560, limit: 491, hint: '结算616' },
    4: { steady: 540, limit: 470, hint: '结算621' },
    5: { steady: 540, limit: 470, hint: '结算621' },
  },
}

// 阵位布局：row = front(1人) / mid(2人) / back(2人)
interface PositionDef {
  pos: number
  bonus: number
  label: string
  avatar: string
  row: 'front' | 'mid' | 'back'
}

const POSITIONS: PositionDef[] = [
  { pos: 1, bonus: 20, label: '① 队长', avatar: '🧙', row: 'front' },
  { pos: 3, bonus: 10, label: '③ 左翼', avatar: '🛡️', row: 'mid' },
  { pos: 2, bonus: 10, label: '② 右翼', avatar: '🛡️', row: 'mid' },
  { pos: 4, bonus: 15, label: '④ 后左', avatar: '⚔️', row: 'back' },
  { pos: 5, bonus: 15, label: '⑤ 后右', avatar: '⚔️', row: 'back' },
]

const ROLES: { key: Role; icon: string; label: string }[] = [
  { key: 'support', icon: '💚', label: '辅助 · 抢神封' },
  { key: 'physical', icon: '⚔️', label: '物理 · 快过长生' },
]

// 角色对应的阵位头像与目标说明
const AVATARS: Record<Role, Record<number, string>> = {
  support: { 1: '💚', 2: '💚', 3: '💚', 4: '💚', 5: '💚' },
  physical: { 1: '⚔️', 2: '⚔️', 3: '⚔️', 4: '⚔️', 5: '⚔️' },
}

const TARGETS: Record<Role, string> = {
  support: '🎯 辅助目标：快过神封（~900）',
  physical: '🎯 物理目标：快过长生（~540）',
}

// 顶层 Tab：地煞星（可用）/ 天罡星（占位）
const tab = ref<'disha' | 'tiangang'>('disha')
const role = ref<Role>('support')

// 109 地煞星气血数据
interface MonsterData {
  name: string
  hp: string
  resistance: string
  note?: string
}

const MONSTER_DATA_109: MonsterData[] = [
  { name: '主怪', hp: '2.2W', resistance: '双不抗' },
  { name: '小夜、幽灵、鸭子、灵符', hp: '2.2W', resistance: '双不抗' },
  { name: '大力、混沌兽', hp: '2W', resistance: '抗物理怕法术' },
  { name: '律法、炎魔神', hp: '1.8W', resistance: '双抗' },
  { name: '神封', hp: '3.5W', resistance: '-' },
  { name: '长生', hp: '4W', resistance: '-' },
]

const SPECIAL_NOTES = [
  '血量低于20%舍生',
  '长生变异：消耗自身80%气血，给3个单位回复大量气血（休息一回合）',
]

// 天罡星分组（8组按周轮换）
const TIANGANG_GROUPS: Record<number, string[]> = {
  1: ['天暗', '天牢', '天败', '天杀'],
  2: ['天寿', '天富', '天究', '天闲'],
  3: ['天哭', '天孤', '天佑', '天伤'],
  4: ['天退', '天威', '天立', '天空'],
  5: ['天异', '天损', '天勇', '天速'],
  6: ['天满', '天剑', '天猛', '天罪'],
  7: ['天平', '天微', '天巧', '天爆'],
  8: ['天机', '天雄', '天英', '天慧'],
}

// 天罡星攻略数据
interface TiangangGuide {
  name: string
  level: string // 难度等级，如 3X、4X
  hasYaoYan: boolean
  monsters: string // 怪物配置
  mainSkill: string // 主怪技能
  firstRound?: string // 第一回合要点
  roundPoints?: string // 后续回合要点
  notes?: string[] // 注意事项
  specialTactic?: string // 特殊战法
}

const TIANGANG_GUIDES: Record<string, TiangangGuide> = {
  天平: {
    name: '天平星',
    level: '3X',
    hasYaoYan: true,
    monsters: '2物理 2法系 2封系',
    mainSkill: '一速无限舍身',
    firstRound: '人物点杀一个狂攻，召唤兽点杀另一个狂攻，封印前排神封',
    roundPoints: '第二回合集火全力点杀掉血较少的（主会回掉血多的怪）',
    notes: [
      '主怪持续舍身，血量损耗较大的怪物',
      '109级狂攻血约 2.97W',
      '只剩主怪后不再舍身，需点杀收尾',
    ],
  },
  天微: {
    name: '天微星',
    level: '1X',
    hasYaoYan: false,
    monsters: '2物理 2法系 3封印 2辅助',
    mainSkill: '第一回合清空我方蓝，之后逐回合恢复',
    firstRound: '辅助起塔、上法宝，输出特技或普攻防御',
    roundPoints: '第二回合起正常杀小怪',
    notes: [
      '切记不要使用技能（会无蓝可用）',
    ],
  },
  天巧: {
    name: '天巧星',
    level: '4X',
    hasYaoYan: true,
    monsters: '3物理 2法系 无封印',
    mainSkill: '一速封印150回合，后排5个连体随机封印（普攻/法术/特技）我方5人',
    firstRound: '最好直接起罗汉',
    roundPoints: '先杀前面小怪，可封印前排小怪',
    notes: [
      '5个主怪FC封全队（技能/特技/物理全封）',
      '次回合起：主怪五雷咒随机点杀，罗汉金钟必须提前一回合续上',
      '不要解封超过两个单位',
      '不要使用晶清/玉清（会灭队）',
    ],
    specialTactic: '杀完前排主不会打召唤兽，可以洞明草看血，使用后血出现在聊天栏那边，然后召唤兽拉个速度最快的角色，按照速度快慢拉起来a-b-c-d-e，最后这个e直接输出主怪。就过了。',
  },
  天爆: {
    name: '天爆星',
    level: '3X',
    hasYaoYan: true,
    monsters: '2物理 3法系 2封系 2辅助',
    mainSkill: '一速群秒，忽视罗汉',
    firstRound: '全力点杀主怪',
    roundPoints: '凌波城浪涌、地府毒可熄灭主怪阵法',
    notes: [
      '主怪一速群秒，伤害很高',
      '不要起罗汉（无效）',
      '杀掉主怪基本就过了',
    ],
  },
  天机: {
    name: '天机星',
    level: '5X',
    hasYaoYan: true,
    monsters: '2物理 3法系 2辅助 2封系',
    mainSkill: '一速雷霆三秒，阵法满后秒10雷法',
    firstRound: '先杀后排左长生',
    roundPoints: '然后杀主，再杀辅助',
    notes: [
      '一定要先杀2个辅助，辅助会舍身主怪',
      '前排先封印，等连体后一起杀',
      '需要提前一回合起罗汉',
      '主怪血多，注意血量过半要回复',
    ],
  },
  天雄: {
    name: '天雄星',
    level: '4X',
    hasYaoYan: true,
    monsters: '2物理 3法系 2辅助 2封系',
    mainSkill: '根据我方首个技能选天气，暴雨天气加愤怒，残血集火',
    firstRound: '凌波城浪涌选暴雨天气，九黎直接风影，辅助用法宝，宝宝集火左后长生',
    roundPoints: '击杀顺序：左后长生 → 右后长生 → 神封',
    notes: [
      '长生血约2.26W，神封约2.68W',
      '前排全封后就不会解了',
    ],
  },
  天英: {
    name: '天英星',
    level: '3X',
    hasYaoYan: true,
    monsters: '3法系 2物理 2封系 2辅助',
    mainSkill: '无限回复大量气血（怒气由我方技能增加）',
    firstRound: '先杀2个辅助（血少，1回合杀1个）',
    roundPoints: '等主怪怒气消耗完再杀主',
    notes: [
      'HS/WDD不要用加血，可用特技/药',
      'WDD可封，地府可毒',
      '使用人物技能会增加主怪怒气',
      '主怪血量约5W',
      '有封女儿和WZ优先杀（能加法阵）',
    ],
  },
  天慧: {
    name: '天慧星',
    level: '2X',
    hasYaoYan: false,
    monsters: '前排5雨师（打酱油）后排神封长生狂攻诡法各1',
    mainSkill: '一速，视进度条开秒',
    firstRound: '强行杀主即可',
    notes: [
      '诡法与狂攻不可封印',
      '只能封神封',
      '神封速度慢（比五星地煞长生还慢）',
      '主怪死则无脑过',
      '全场只有3个输出点，罗汉都不是必须',
    ],
  },
  天暗: {
    name: '天暗星',
    level: '4X',
    hasYaoYan: true,
    monsters: '2物理 3法系 2封印 2辅助',
    mainSkill: '一速飞沙走石秒10',
    firstRound: '必起罗汉，同时杀主',
    roundPoints: '第二回合晶清，消除摇头摆尾10%扣血状态',
    notes: [
      'DF毒、LBC浪涌惊涛可降低主怪法阵',
      '小怪输出低，可封2个封系或封输出',
    ],
  },
  天杀: {
    name: '天杀星',
    level: '2X',
    hasYaoYan: true,
    monsters: '3物理 2法系 3封印 1辅助',
    mainSkill: '怒杀（必杀技打7下，带FC封印）',
    firstRound: '先杀小怪再杀主',
    notes: [
      '主怪出杀意（名字出现在主怪头上）时小心7连',
    ],
  },
  天败: {
    name: '天败星',
    level: '2X',
    hasYaoYan: true,
    monsters: '主怪法系龙宫，输出怪多，永不为封印怪，言弃为辅助',
    mainSkill: '法伤相对比较高',
    firstRound: '杀狂攻，再杀主，封印2个凌波豹子',
    roundPoints: '杀完一个前排怪后，立刻杀对应后面的星星，再杀下一个',
    notes: [
      '杀完一个前排怪后，对应后面的星星会换造型（变强）',
      '杀完前排后可直接对着星星打',
    ],
  },
  天牢: {
    name: '天牢星',
    level: '1X',
    hasYaoYan: false,
    monsters: '3物理 2法系 2封印 2辅助',
    mainSkill: '日月乾坤（必中1速），一回合解封',
    firstRound: '先杀1物理输出，封印2封系',
  },
  天伤: {
    name: '天伤星',
    level: '2X',
    hasYaoYan: false,
    monsters: '主怪大唐，连扫4下不休息',
    mainSkill: '横扫千军（连扫4下不休息，喜欢扫宝宝）',
    firstRound: '先杀主',
    notes: [
      '最好先杀几个诡法减轻压力',
      '注意宝宝损失（主怪喜欢扫宝宝）',
    ],
  },
  天孤: {
    name: '天孤星',
    level: '3X',
    hasYaoYan: true,
    monsters: '4物理 2法系 1辅助 3封系',
    mainSkill: '大招秒10（触发条件：我方有人死亡或全部被封印）',
    firstRound: '可以先杀几个小怪再杀主怪',
    notes: [
      '主怪PS门派',
      '注意我方人物死亡和封印状态，有人死亡或全封会触发主怪大招',
    ],
  },
  天哭: {
    name: '天哭星',
    level: '3X',
    hasYaoYan: true,
    monsters: '2物理 1法系 1封系 1辅助（输出非常暴力）',
    mainSkill: '龙啸九天（一速封印召唤兽，隐身鬼混无效）',
    firstRound: '先杀老虎（物理攻击非常高）',
    roundPoints: '杀完老虎 → 狂攻 → 主',
    notes: [
      '输出非常暴力，难度高',
      '不带隐身宝宝（隐身无效且晶清玉清解不了）',
      '封印法系（只可封1个，封2个就晶清）',
      '我方需晶清玉清3个以上',
    ],
  },
  天佑: {
    name: '天佑星',
    level: '2X',
    hasYaoYan: false,
    monsters: '4诡法 2狂攻 2神封 1长生',
    mainSkill: '每几回合点名，下回放大招（随机加满血或翻倍扣血）',
    firstRound: '最好先杀几个诡法减轻压力',
    notes: [
      '神封速度：快',
      '诡法会单秒残血单位',
      '可使用尸体战术',
      '主怪大招无所谓，该星简单',
      '六星：大招变为两回合一次，且对全体人物释放',
    ],
  },
  天寿: {
    name: '天寿星',
    level: '3X',
    hasYaoYan: true,
    monsters: '3物理 4法系 2封系 无辅助（共10只怪）',
    mainSkill: '翻江倒海、断岳式、浪涌',
    firstRound: '杀大（主怪凌波城，伤害很高）',
    roundPoints: '第二回合后进行2=2连体，先杀2物理输出',
    notes: [
      '难度大，主怪凌波城伤害很高',
      '第一回合主怪召唤前排5只',
      '物理与物理连体，法系与法系连体，死一个即死另外一个',
      '封印怪物只有1回合，第2回合扣血自动解封',
    ],
  },
  天究: {
    name: '天究星',
    level: '2X',
    hasYaoYan: false,
    monsters: '2物理 2法系 2封印 3辅助',
    mainSkill: '一速封印特技（无输出）',
    firstRound: '先杀小怪，一速二速吃五龙',
    roundPoints: '再杀主',
    notes: [
      '主怪一速，一直封印特技',
      '二速晶清，三速罗汉',
    ],
  },
  天闲: {
    name: '天闲星',
    level: '3X',
    hasYaoYan: true,
    monsters: '2物理 2法系 2封系 3辅助',
    mainSkill: '含情脉脉（怒气条机制）',
    firstRound: '先杀小怪，主怪留最后',
    notes: [
      '封印恶心，输出不恶心',
      '主怪盘丝，防御非常高，需要点时间杀主',
      '有怒气时封印2个单位，没怒气时封印1个单位',
    ],
  },
  天富: {
    name: '天富星',
    level: '3X',
    hasYaoYan: true,
    monsters: '主怪 + 召唤5波怪',
    mainSkill: '召唤（共5波）',
    roundPoints: '集中点杀第5波',
    notes: [
      '第1、2、3波简单，第4波有点难度',
      '第5波关键：输出非常高',
      '第5波门派：DT、DF、LBC、ST',
    ],
  },
  天退: {
    name: '天退星',
    level: '5X',
    hasYaoYan: true,
    monsters: '法系秒10，输出极高',
    mainSkill: '集体打蓝→禁法宝→禁道具→清愤怒（三阶段）',
    firstRound: '封1法，集火1法，怒目罗汉',
    roundPoints: '第二回合封长生，守着被加血单位打',
    notes: [
      '天罡星里最难的之一，必须2封以上',
      '第1-5回合：每回合扣10%蓝',
      '第6回合起：禁止法宝',
      '第7回合起：禁止道具，必须放罗汉',
      '第8回合起：清空愤怒（持续至结束）',
      '第五回合：必放罗汉',
      '方法1：控2法系+1辅助，分别击杀3怪',
      '方法2：控2法系，集中杀1法系，再控1辅助',
      '罗汉非常重要！无罗汉宝宝直接飞',
      '坚持10回合',
    ],
  },
  天威: {
    name: '天威星',
    level: '3X',
    hasYaoYan: false,
    monsters: '2物理 4法系 2封系 1辅助',
    mainSkill: '3/6/9回合喊话全体扣血（按小怪存活数提升）',
    firstRound: '集火前排法系，起罗汉',
    notes: [
      '主怪输出能力弱',
      '小怪第2回合后3=3连体，死一个即死3个，比较简单',
    ],
  },
  天立: {
    name: '天立星',
    level: '2X',
    hasYaoYan: false,
    monsters: '5法系 2物理 2封系 1辅助（共7个输出怪）',
    mainSkill: '无特殊技能',
    firstRound: '必起罗汉（怒目罗汉），杀物理',
    notes: [
      '法系输出多，左右两个怪输出大',
      '主怪法系秒10，伤害较大',
      '血量不多',
    ],
  },
  天空: {
    name: '天空星',
    level: '1X',
    hasYaoYan: false,
    monsters: '主怪 + 召唤5个舞灵（均为大唐）',
    mainSkill: '无特殊技能',
    firstRound: '直接杀主',
    notes: [
      '舞灵均为大唐怪，伤害一般',
      '舞灵血量5000-8000',
      '想杀快点直接杀主',
    ],
  },
  天损: {
    name: '天损星',
    level: '3X',
    hasYaoYan: true,
    monsters: '3物理 4法系 1封印 1辅助',
    mainSkill: '超级力劈（固定伤3000-10000，保护无效）',
    firstRound: '集火物理，可起罗汉',
    roundPoints: '各个击破，避免一回合杀两只（触发连破）',
    notes: [
      '主怪凌波城',
      '每死一只小怪，主怪触发一次超级力劈',
      '先杀2物理2法系，控住2个法系',
      '再杀主怪，根据队伍配置选杀物理或法系',
    ],
  },
  天勇: {
    name: '天勇星',
    level: '4X',
    hasYaoYan: true,
    monsters: '主怪 + 召唤怪（血勇/骨气/神勇/气勇）',
    mainSkill: '持续输出+召唤，后期雷霆全秒10',
    firstRound: '直接杀主，最好4-5回合内点死',
    roundPoints: '第3回合主杀血勇回血1W+，连击4下打我方防御最低，再召唤5小怪',
    notes: [
      '难度高',
      '第2回合：主降防但提升法防',
      '一定要提前起罗汉（后期全秒雷霆）',
      '主可封，前三回合必须下主',
      '主死后丢武魂，对面无七宝',
      '封印1回合自动解但扣血3300',
      '小怪三只无限回血，需要封印',
    ],
  },
  天速: {
    name: '天速星',
    level: '2X',
    hasYaoYan: false,
    monsters: '主怪LBC + 2法系 + 2ST + 3封系 + 2辅助',
    mainSkill: '凌波城输出，血量厚',
    firstRound: '集火长生，可起罗汉',
    roundPoints: '杀完辅助再杀一个封系，一定要封印2个输出',
    notes: [
      '一定要先杀2个辅助（不然一直舍身）',
      '按队伍怕法系或物理选封印',
      '后排连体怪，血特别多，放后面杀',
      '后排点杀1个单位其余都掉血，杀死一个全死',
    ],
  },
  天异: {
    name: '天异星',
    level: '2X',
    hasYaoYan: false,
    monsters: '主怪会变身（3种形态）',
    mainSkill: '每回合变身一次',
    firstRound: '先杀物理输出',
    notes: [
      '比较简单',
      '三种变身形态：',
      '· 外星人：无抗物理法属性',
      '· 龙龟：怕物理，抗法',
      '· 猴子：怕法，抗物理',
      '记住位置，一回合变一次',
      '优先杀龙龟和外星人形态',
    ],
  },
  天满: {
    name: '天满星',
    level: '3X',
    hasYaoYan: true,
    monsters: '1物理 3法系 3封印 2辅助',
    mainSkill: '每回合打气血最多的人60%气血（只打人物）',
    firstRound: '先杀1个物理+1个法系小怪，封印2个封系',
    roundPoints: '再集中攻击主怪',
    notes: [
      '需要HS舍生取义回复，否则费大金',
      '主怪必杀不死人，但损60%气血，注意回血就好',
    ],
  },
  天剑: {
    name: '天剑星',
    level: '4X',
    hasYaoYan: true,
    monsters: '主怪 + 召唤小怪',
    mainSkill: '召唤（受击8000-10000血后召唤小怪）',
    firstRound: '先起无回合限制的状态，再开始杀主',
    roundPoints: '一直杀主，让主最快召唤满，主怪招满后第2回合再杀小怪',
    notes: [
      '主怪不扣血10%不会动',
      '1回合打掉8000-10000血才召唤，最多一回合召唤2只',
      '出现3个LBC直接跑重杀',
      '千万别刚招满就杀小怪（没用）',
    ],
  },
  天猛: {
    name: '天猛星',
    level: '2X',
    hasYaoYan: false,
    monsters: '输出不暴力，主怪一速',
    mainSkill: '封印道具和法宝',
    firstRound: '晶清解除主怪封印，砍小',
    notes: [
      '主怪固定一速，封印我方道具法宝',
      '后排两神封固定五庄，可以先杀',
      '可晶清解除主怪封印',
    ],
  },
  天罪: {
    name: '天罪星',
    level: '3X',
    hasYaoYan: false,
    monsters: '主怪 + 无限召唤小怪',
    mainSkill: '无限召唤，召唤后2回合杀死小怪',
    firstRound: '拉伤害，自动杀小',
    roundPoints: '2回合内杀完所有小怪，主只能召唤3次就死',
    notes: [
      '主怪不造成伤害，不要杀主',
      '主怪召唤会掉血，小怪杀得越多主掉血越多',
      '第2回合必须杀死BY怪（变异怪），不杀BY怪会自爆，全体受大量伤害',
      '5NE队最爱，2分钟杀完',
    ],
  },
}

// 锚定 2026-08-31（ISO 周序号 36）为第 7 组，推算当前周
function getCurrentWeek(): number {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000)
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7)
  // 锚点：周序号 36 -> 第 7 组
  const anchorWeek = 36
  const anchorGroup = 7
  const offset = weekNumber - anchorWeek
  const group = ((offset % 8) + anchorGroup - 1 + 8) % 8 + 1
  return group
}

const tiangangWeek = ref(getCurrentWeek())
const currentWeek = getCurrentWeek()
const currentTiangangStars = computed(() => TIANGANG_GROUPS[tiangangWeek.value])

const rows = computed(() => ({
  front: POSITIONS.filter((p) => p.row === 'front'),
  mid: POSITIONS.filter((p) => p.row === 'mid'),
  back: POSITIONS.filter((p) => p.row === 'back'),
}))

function speedOf(pos: number): SpeedData {
  return DATA[role.value][pos]
}

function avatarOf(pos: number): string {
  return AVATARS[role.value][pos]
}
</script>

<template>
  <div class="tdk-page">
    <!-- 页头 -->
    <header class="tdk-header">
      <h1>⚔️ 天地砍王</h1>
      <span class="badge">{{ tab === 'disha' ? '⭐ 109 地煞 · 鸟翔阵 · 速度配速' : '⭐ 天罡星 · 8组按周轮换' }}</span>
    </header>

    <!-- 顶层 Tab：地煞星 / 天罡星 -->
    <div class="tdk-tabs">
      <button :class="{ active: tab === 'disha' }" @click="tab = 'disha'">🌑 地煞星</button>
      <button :class="{ active: tab === 'tiangang' }" @click="tab = 'tiangang'">☀️ 天罡星</button>
    </div>

    <!-- ===== 地煞星面板 ===== -->
    <template v-if="tab === 'disha'">
      <!-- 角色选择 -->
      <div class="tdk-selector">
        <button
          v-for="r in ROLES"
          :key="r.key"
          :class="{ active: role === r.key }"
          @click="role = r.key"
        >
          <span class="icon">{{ r.icon }}</span> {{ r.label }}
        </button>
      </div>

      <!-- 阵法图 -->
      <div class="battlefield">
        <div class="ground">
          <div class="formation-grid">
            <div class="row row-front">
              <div v-for="p in rows.front" :key="p.pos" class="position active">
                <span class="bonus-tag">+{{ p.bonus }}%</span>
                <div class="avatar">{{ avatarOf(p.pos) }}</div>
                <div class="pos-label">{{ p.label }}</div>
                <div class="speed-data">
                  <span class="steady">🛡{{ speedOf(p.pos).steady }}</span>
                  <span class="limit">⚡{{ speedOf(p.pos).limit }}</span>
                  <span class="hint">{{ speedOf(p.pos).hint }}</span>
                </div>
              </div>
            </div>
            <div class="row row-mid">
              <div v-for="p in rows.mid" :key="p.pos" class="position active">
                <span class="bonus-tag">+{{ p.bonus }}%</span>
                <div class="avatar">{{ avatarOf(p.pos) }}</div>
                <div class="pos-label">{{ p.label }}</div>
                <div class="speed-data">
                  <span class="steady">🛡{{ speedOf(p.pos).steady }}</span>
                  <span class="limit">⚡{{ speedOf(p.pos).limit }}</span>
                  <span class="hint">{{ speedOf(p.pos).hint }}</span>
                </div>
              </div>
            </div>
            <div class="row row-back">
              <div v-for="p in rows.back" :key="p.pos" class="position active">
                <span class="bonus-tag">+{{ p.bonus }}%</span>
                <div class="avatar">{{ avatarOf(p.pos) }}</div>
                <div class="pos-label">{{ p.label }}</div>
                <div class="speed-data">
                  <span class="steady">🛡{{ speedOf(p.pos).steady }}</span>
                  <span class="limit">⚡{{ speedOf(p.pos).limit }}</span>
                  <span class="hint">{{ speedOf(p.pos).hint }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="formation-name">🐦 鸟翔阵 · 全速型阵法</div>
        </div>
      </div>

      <!-- 气血信息表格 -->
      <div class="hp-section">
        <h3 class="hp-title">📊 109 地煞星气血信息</h3>
        <table class="hp-table">
          <thead>
            <tr>
              <th>怪物</th>
              <th>气血</th>
              <th>抗性</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in MONSTER_DATA_109" :key="m.name">
              <td class="monster-name">{{ m.name }}</td>
              <td class="hp-value">{{ m.hp }}</td>
              <td class="resistance">{{ m.resistance }}</td>
            </tr>
          </tbody>
        </table>
        <div class="hp-notes">
          <div v-for="(note, i) in SPECIAL_NOTES" :key="i" class="note-item">
            💡 {{ note }}
          </div>
        </div>
      </div>

      <!-- 图例 & 目标说明 -->
      <div class="tdk-footer">
        <div class="legend">
          <span><span class="dot steady-dot"></span> 🛡 稳健（考虑乱敏）</span>
          <span><span class="dot limit-dot"></span> ⚡ 极限（理论最低）</span>
        </div>
        <div class="target">{{ TARGETS[role] }}</div>
        <div class="ref">长生~540 · 神封~900</div>
      </div>
    </template>

    <!-- ===== 天罡星面板 ===== -->
    <template v-else>
      <div class="tg-section">
        <h3 class="tg-title">☀️ 天罡星 · 8组按周轮换</h3>

        <!-- 周选择器 -->
        <div class="tg-week-picker">
          <button
            v-for="w in 8"
            :key="w"
            :class="{ active: tiangangWeek === w }"
            @click="tiangangWeek = w"
          >
            第{{ w }}周<sup v-if="currentWeek === w" class="now-tag">本周</sup>
          </button>
        </div>

        <!-- 本周星宿攻略卡片 -->
        <div class="tg-guides">
          <div
            v-for="star in currentTiangangStars"
            :key="star"
            class="tg-guide-card"
          >
            <template v-if="TIANGANG_GUIDES[star]">
              <div class="tg-guide-header">
                <span class="tg-guide-name">{{ TIANGANG_GUIDES[star].name }}</span>
                <span :class="['tg-guide-level', `level-${TIANGANG_GUIDES[star].level}`]">{{ TIANGANG_GUIDES[star].level }}</span>
                <span v-if="TIANGANG_GUIDES[star].hasYaoYan" class="tg-guide-yao">✨ 耀眼</span>
              </div>
              <div class="tg-guide-monsters">👹 {{ TIANGANG_GUIDES[star].monsters }}</div>
              <div class="tg-guide-skill">⚡ 主怪：{{ TIANGANG_GUIDES[star].mainSkill }}</div>

              <!-- 回合要点 -->
              <div v-if="TIANGANG_GUIDES[star].firstRound || TIANGANG_GUIDES[star].roundPoints" class="tg-round-section">
                <div v-if="TIANGANG_GUIDES[star].firstRound" class="tg-round-item highlight">
                  <span class="round-label">第一回合：</span>{{ TIANGANG_GUIDES[star].firstRound }}
                </div>
                <div v-if="TIANGANG_GUIDES[star].roundPoints" class="tg-round-item">
                  <span class="round-label">后续回合：</span>{{ TIANGANG_GUIDES[star].roundPoints }}
                </div>
              </div>

              <!-- 注意事项 -->
              <div v-if="TIANGANG_GUIDES[star].notes && TIANGANG_GUIDES[star].notes.length" class="tg-notes-section">
                <div class="tg-notes-title">⚠️ 注意事项</div>
                <div v-for="(note, i) in TIANGANG_GUIDES[star].notes" :key="i" class="tg-note-item">
                  {{ i + 1 }}. {{ note }}
                </div>
              </div>

              <!-- 特殊战法 -->
              <div v-if="TIANGANG_GUIDES[star].specialTactic" class="tg-special-section">
                <div class="tg-special-title">🎯 特殊战法</div>
                <div class="tg-special-content">{{ TIANGANG_GUIDES[star].specialTactic }}</div>
              </div>
            </template>
            <div v-else class="tg-guide-placeholder">
              暂无「{{ star }}」攻略数据
            </div>
          </div>
        </div>

        <!-- 所有分组一览 -->
        <div class="tg-all-groups">
          <div
            v-for="(stars, w) in TIANGANG_GROUPS"
            :key="w"
            class="tg-group"
            :class="{ current: tiangangWeek === Number(w), 'is-now': currentWeek === Number(w) }"
            @click="tiangangWeek = Number(w)"
          >
            <div class="tg-group-week">第{{ w }}周</div>
            <div class="tg-group-stars">{{ stars.join(' · ') }}</div>
            <span v-if="currentWeek === Number(w)" class="now-badge">📍 本周</span>
          </div>
        </div>

        <div class="tg-note">
          💡 天罡星共 8 组，按周独立轮换：本周第 {{ currentWeek }} 组，下周第 {{ (currentWeek % 8) + 1 }} 组（第 8 组后回到第 1 组）
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tdk-page {
  flex: 1;
  width: 100%;
  margin: 0 auto;
  padding: 20px 20px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 页头 ===== */
.tdk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
}
.tdk-header h1 {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-primary);
  letter-spacing: 2px;
  text-shadow: 0 0 24px rgba(34, 211, 238, 0.35);
}

/* ===== 顶层 Tab ===== */
.tdk-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.tdk-tabs button {
  padding: 10px 28px;
  border: 2px solid var(--border-color);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  background: var(--bg-card);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.1s linear;
}
.tdk-tabs button:hover {
  color: var(--color-primary);
  border-color: rgba(34, 211, 238, 0.3);
}
.tdk-tabs button.active {
  background: rgba(34, 211, 238, 0.1);
  color: var(--color-primary);
  border-color: var(--color-primary);
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.18);
}

/* ===== 角色选择器 ===== */
.tdk-selector {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.tdk-selector button {
  padding: 10px 30px;
  border: 2px solid var(--border-color);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  background: var(--bg-card);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.1s linear;
}
.tdk-selector button:hover {
  transform: translateY(-2px);
  color: var(--color-text);
  border-color: rgba(34, 211, 238, 0.3);
}
.tdk-selector button.active {
  background: var(--color-accent);
  color: #1a1402;
  border-color: var(--color-accent);
  box-shadow: 0 0 24px rgba(255, 215, 0, 0.3);
}
.tdk-selector .icon {
  margin-right: 6px;
}

/* ===== 阵法战场 ===== */
.battlefield {
  position: relative;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 24px 24px 32px;
  overflow: hidden;
}
.ground {
  position: relative;
  border: 2px solid rgba(34, 211, 238, 0.35);
  border-radius: 10px;
  padding: 20px 16px 40px;
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(10, 14, 24, 0.98));
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(34, 211, 238, 0.1);
}
.formation-name {
  position: absolute;
  bottom: 6px;
  right: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-muted);
  background: rgba(34, 211, 238, 0.06);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 2px 10px;
  letter-spacing: 1px;
}

.formation-grid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}
.row {
  display: flex;
  justify-content: center;
  gap: 24px;
  width: 100%;
}
.row-mid {
  justify-content: space-between;
  padding: 0 10%;
}
.row-back {
  justify-content: space-between;
  padding: 0 22%;
}

/* ===== 阵位卡片 ===== */
.position {
  position: relative;
  background: rgba(10, 14, 24, 0.85);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 12px;
  padding: 12px 14px 14px;
  min-width: 140px;
  max-width: 200px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transition: all 0.15s ease;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.position.active {
  border-color: rgba(34, 211, 238, 0.5);
  box-shadow: 0 0 24px rgba(34, 211, 238, 0.25), 0 8px 20px rgba(0, 0, 0, 0.55);
}
.position:hover {
  transform: translateY(-5px);
  box-shadow: 0 0 32px rgba(34, 211, 238, 0.35), 0 12px 28px rgba(0, 0, 0, 0.55);
}

.position .avatar {
  display: none;
}
.position .pos-label {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  color: #e2e8f0;
  background: rgba(34, 211, 238, 0.18);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 5px;
  padding: 4px 16px;
  margin-bottom: 10px;
  white-space: nowrap;
}
.position .speed-data {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px 12px;
  width: 100%;
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 8px;
  padding: 8px 10px;
  font-variant-numeric: tabular-nums;
}
.position .speed-data .steady {
  color: #22c55e;
  text-shadow: 0 0 10px rgba(34, 197, 94, 0.7);
}
.position .speed-data .limit {
  color: #f59e0b;
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.7);
}
.position .speed-data .hint {
  font-size: 14px;
  font-weight: 500;
  color: #f1f5f9;
  width: 100%;
}

/* 加成角标 */
.position .bonus-tag {
  position: absolute;
  top: -14px;
  right: -12px;
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  color: #fbbf24;
  background: #0a0e18;
  border: 2px solid rgba(251, 191, 36, 0.7);
  border-radius: 5px;
  padding: 3px 14px;
  text-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
  white-space: nowrap;
}

/* ===== 气血信息表格 ===== */
.hp-section {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px 24px;
}
.hp-title {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 16px;
  letter-spacing: 1px;
}
.hp-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 17px;
}
.hp-table th,
.hp-table td {
  padding: 12px 18px;
  text-align: left;
  border-bottom: 1px solid rgba(34, 211, 238, 0.15);
}
.hp-table th {
  font-size: 16px;
  font-weight: 700;
  color: #94a3b8;
  background: rgba(34, 211, 238, 0.08);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.hp-table tbody tr:hover {
  background: rgba(34, 211, 238, 0.05);
}
.hp-table .monster-name {
  color: #e2e8f0;
  font-weight: 600;
}
.hp-table .hp-value {
  color: var(--color-accent);
  font-weight: 700;
  font-size: 22px;
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.4);
}
.hp-table .resistance {
  color: #94a3b8;
}
.hp-notes {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note-item {
  font-family: var(--font-mono);
  font-size: 16px;
  color: #cbd5e1;
  background: rgba(255, 215, 0, 0.08);
  border-left: 3px solid var(--color-accent);
  padding: 10px 16px;
  border-radius: 0 6px 6px 0;
}

/* ===== 底部信息条 ===== */
.tdk-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px 18px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text);
}
.tdk-footer .legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.tdk-footer .legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tdk-footer .dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
}
.dot.steady-dot {
  background: var(--color-success);
}
.dot.limit-dot {
  background: var(--color-accent);
}
.tdk-footer .target {
  color: var(--color-primary);
  font-weight: 700;
}
.tdk-footer .ref {
  color: var(--color-text-muted);
  background: rgba(34, 211, 238, 0.06);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 2px 12px;
}

/* ===== 天罡星面板 ===== */
.tg-section {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px 24px;
}
.tg-title {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 16px;
  letter-spacing: 1px;
}
.tg-week-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}
.tg-week-picker button {
  padding: 8px 20px;
  border: 2px solid var(--border-color);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  background: var(--bg-card);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.1s linear;
}
.tg-week-picker button:hover {
  color: var(--color-text);
  border-color: rgba(34, 211, 238, 0.3);
}
.tg-week-picker button.active {
  background: var(--color-accent);
  color: #1a1402;
  border-color: var(--color-accent);
  box-shadow: 0 0 18px rgba(255, 215, 0, 0.3);
}
.now-tag {
  margin-left: 2px;
  font-size: 10px;
  font-weight: 700;
}
.tg-preview-hint {
  text-align: center;
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--color-primary);
  margin-bottom: 18px;
}

/* 本周星宿大卡片 */
.tg-stars {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  margin-bottom: 20px;
}
.tg-star {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 26px;
  font-weight: 700;
  color: #f1f5f9;
  background: rgba(255, 215, 0, 0.1);
  border: 2px solid rgba(255, 215, 0, 0.4);
  border-radius: 10px;
  padding: 16px 28px;
  text-shadow: 0 0 12px rgba(255, 215, 0, 0.4);
  box-shadow: 0 0 20px rgba(255, 215, 0, 0.15), 0 6px 16px rgba(0, 0, 0, 0.4);
}

/* 所有分组一览 */
.tg-all-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tg-group {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.1s linear;
}
.tg-group:hover {
  border-color: rgba(34, 211, 238, 0.3);
  background: rgba(34, 211, 238, 0.04);
}
.tg-group.current {
  border-color: rgba(255, 215, 0, 0.5);
  background: rgba(255, 215, 0, 0.06);
  box-shadow: 0 0 16px rgba(255, 215, 0, 0.12);
}
.tg-group.is-now .tg-group-week {
  color: var(--color-accent);
}
.now-badge {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent);
  background: rgba(255, 215, 0, 0.12);
  border: 1px solid rgba(255, 215, 0, 0.4);
  border-radius: 4px;
  padding: 2px 10px;
  white-space: nowrap;
}

/* ===== 天罡攻略卡片（一排两个） ===== */
.tg-guides {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 20px;
}
@media (max-width: 900px) {
  .tg-guides {
    grid-template-columns: 1fr;
  }
}
.tg-guide-card {
  background: rgba(10, 14, 24, 0.85);
  border: 1px solid rgba(34, 211, 238, 0.25);
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.tg-guide-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.tg-guide-name {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-primary);
  letter-spacing: 1px;
}
.tg-guide-level {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  background: rgba(34, 211, 238, 0.15);
  color: var(--color-primary);
}
.tg-guide-level.level-1X { background: rgba(52, 211, 153, 0.2); color: #34d399; }
.tg-guide-level.level-2X { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
.tg-guide-level.level-3X { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
.tg-guide-level.level-4X { background: rgba(249, 115, 22, 0.2); color: #fb923c; }
.tg-guide-level.level-5X { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.tg-guide-yao {
  font-size: 13px;
  font-weight: 600;
  color: #fbbf24;
  margin-left: auto;
}
.tg-guide-monsters,
.tg-guide-skill {
  font-family: var(--font-mono);
  font-size: 15px;
  color: #cbd5e1;
  margin-bottom: 6px;
  line-height: 1.5;
}
.tg-guide-placeholder {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 20px;
}

/* 回合要点 */
.tg-round-section {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tg-round-item {
  font-family: var(--font-mono);
  font-size: 15px;
  color: #e2e8f0;
  line-height: 1.6;
  background: rgba(34, 211, 238, 0.06);
  border: 1px solid rgba(34, 211, 238, 0.2);
  border-radius: 6px;
  padding: 10px 14px;
}
.tg-round-item.highlight {
  background: rgba(34, 211, 238, 0.1);
  border-color: rgba(34, 211, 238, 0.4);
}
.round-label {
  font-weight: 700;
  color: var(--color-primary);
  margin-right: 4px;
}

/* 注意事项 */
.tg-notes-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(34, 211, 238, 0.15);
}
.tg-notes-title {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent);
  margin-bottom: 8px;
}
.tg-note-item {
  font-family: var(--font-mono);
  font-size: 14px;
  color: #cbd5e1;
  line-height: 1.6;
  padding: 4px 10px;
  border-left: 2px solid rgba(255, 215, 0, 0.4);
  background: rgba(255, 215, 0, 0.04);
  margin-bottom: 4px;
}

/* 特殊战法 */
.tg-special-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(52, 211, 153, 0.25);
}
.tg-special-title {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: #34d399;
  margin-bottom: 8px;
}
.tg-special-content {
  font-family: var(--font-mono);
  font-size: 14px;
  color: #cbd5e1;
  line-height: 1.7;
  padding: 10px 14px;
  background: rgba(52, 211, 153, 0.06);
  border-left: 3px solid rgba(52, 211, 153, 0.5);
  border-radius: 0 6px 6px 0;
}
.tg-group-week {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  color: var(--color-primary);
  min-width: 64px;
  white-space: nowrap;
}
.tg-group.current .tg-group-week {
  color: var(--color-accent);
}
.tg-group-stars {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  color: #e2e8f0;
}
.tg-note {
  margin-top: 16px;
  font-family: var(--font-mono);
  font-size: 16px;
  color: #cbd5e1;
  background: rgba(34, 211, 238, 0.08);
  border-left: 3px solid var(--color-primary);
  padding: 10px 16px;
  border-radius: 0 6px 6px 0;
}

/* ===== 响应式 ===== */
@media (max-width: 1100px) {
  .position {
    min-width: 120px;
    max-width: 160px;
  }
  .row-back {
    padding: 0 18%;
  }
}
@media (max-width: 900px) {
  .position {
    min-width: 110px;
    max-width: 140px;
  }
  .row-mid {
    padding: 0 5%;
  }
  .row-back {
    padding: 0 12%;
  }
}
@media (max-width: 650px) {
  .position {
    min-width: 100px;
    max-width: 130px;
    padding: 14px 10px 12px;
  }
  .position .pos-label {
    font-size: 14px;
  }
  .position .speed-data {
    font-size: 16px;
    padding: 6px 8px;
  }
  .position .bonus-tag {
    font-size: 13px;
    top: -12px;
    right: -10px;
    padding: 2px 10px;
  }
  .row-mid,
  .row-back {
    padding: 0;
    justify-content: center;
    gap: 14px;
  }
  .tdk-tabs button {
    padding: 8px 20px;
    font-size: 15px;
  }
  .tdk-selector button {
    padding: 8px 18px;
    font-size: 15px;
  }
  .tdk-header h1 {
    font-size: 18px;
  }
  .hp-section {
    padding: 16px 18px;
  }
  .hp-table th,
  .hp-table td {
    padding: 8px 12px;
  }
  .hp-table {
    font-size: 14px;
  }
  .hp-title {
    font-size: 16px;
  }
  .tg-section {
    padding: 16px 18px;
  }
  .tg-star {
    font-size: 22px;
    padding: 12px 22px;
  }
  .tg-group {
    flex-wrap: wrap;
    gap: 8px 12px;
  }
}
@media (max-width: 450px) {
  .row-mid,
  .row-back {
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
  .position {
    max-width: 110px;
    min-width: 85px;
  }
  .battlefield {
    padding: 16px 14px 24px;
  }
  .ground {
    padding: 14px 12px 32px;
  }
  .tdk-footer {
    flex-direction: column;
    align-items: flex-start;
  }
  .hp-table th,
  .hp-table td {
    padding: 6px 10px;
    font-size: 13px;
  }
  .note-item {
    font-size: 13px;
  }
  .tg-week-picker button {
    padding: 6px 14px;
    font-size: 13px;
  }
  .tg-star {
    font-size: 18px;
    padding: 10px 18px;
  }
  .tg-group-week {
    font-size: 13px;
    min-width: 56px;
  }
  .tg-group-stars {
    font-size: 14px;
  }
  .tg-note {
    font-size: 14px;
  }
  .now-badge {
    font-size: 11px;
    padding: 1px 8px;
  }
}
</style>
