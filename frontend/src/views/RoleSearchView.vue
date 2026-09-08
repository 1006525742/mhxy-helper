<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { cbgApi } from '@/services/cbgApi'

// ============ 服务器映射（复用 CollectionView 的 /cbg_servers.json）============
interface ServerInfo { server_id: string; server_name: string; area_name: string; area_id: string }
interface ServerMap { source: string; areas: { area_id: string; area_name: string }[]; servers: ServerInfo[] }
const serverMap = ref<ServerMap>({ source: '', areas: [], servers: [] })
const selArea = ref('58')          // 默认「无与伦比」
const selServerId = ref('976')     // 默认「梦幻西游」
const selServerName = computed(() => {
  const f = serverMap.value.servers.find((s) => s.server_id === selServerId.value)
  return f ? f.server_name : (selServerId.value ? `服务器${selServerId.value}` : '')
})
const areaServers = computed<ServerInfo[]>(() => {
  let list = serverMap.value.servers
  if (selArea.value) list = list.filter((s) => s.area_id === selArea.value)
  return list
})
const scope = ref<'single' | 'cross'>('single') // single=单服 / cross=全服
const serverTypes = ref<string[]>([])            // 全服服龄多选 3/2/1
function toggleServerType(v: string) {
  const i = serverTypes.value.indexOf(v)
  if (i >= 0) serverTypes.value.splice(i, 1)
  else serverTypes.value.push(v)
}
async function loadServerMap() {
  try {
    const r = await fetch('/cbg_servers.json')
    if (r.ok) serverMap.value = await r.json()
  } catch (e) { /* 离线降级 */ }
}
function serverLabelById(id?: string | null): string {
  if (!id) return ''
  const f = serverMap.value.servers.find((s) => s.server_id === String(id))
  return f ? f.server_name : ''
}

// ============ 选项常量（code 待校准的已标注）============
// 门派（标准 code，与藏宝阁一致）
const SCHOOLS = [
  { v: 'dt', t: '大唐官府' }, { v: 'hs', t: '化生寺' }, { v: 'ne', t: '女儿村' },
  { v: 'fc', t: '方寸山' }, { v: 'tg', t: '天宫' }, { v: 'pt', t: '普陀山' },
  { v: 'lg', t: '龙宫' }, { v: 'wz', t: '五庄观' }, { v: 'st', t: '狮驼岭' },
  { v: 'mw', t: '魔王寨' }, { v: 'df', t: '阴曹地府' }, { v: 'ps', t: '盘丝洞' },
  { v: 'sl', t: '神木林' }, { v: 'lb', t: '凌波城' }, { v: 'wdd', t: '无底洞' },
  { v: 'nw', t: '女魃墓' }, { v: 'tjc', t: '天机城' }, { v: 'hgs', t: '花果山' },
  { v: 'dhy', t: '东海渊' }, { v: 'jlc', t: '九黎城' }, { v: 'mls', t: '弥勒山' },
]
// code → 门派名 映射（订阅条件展示用）
const SCHOOL_MAP: Record<string, string> = Object.fromEntries(SCHOOLS.map(s => [s.v, s.t]))
// 种族（code 待校准）
const RACES = [
  { v: 'ren', t: '人族' }, { v: 'mo', t: '魔族' }, { v: 'xian', t: '仙族' },
]
// 原始种族（转门派前的种族，code 待校准）
const ORI_RACES = RACES
// 装备类型（own_equips_equip_kind_id，code 待校准）
const EQUIP_KINDS = [
  { v: '1', t: '扇' }, { v: '2', t: '剑' }, { v: '3', t: '刀' }, { v: '4', t: '斧' },
  { v: '5', t: '锤' }, { v: '6', t: '枪' }, { v: '7', t: '双环' }, { v: '8', t: '双剑' },
  { v: '9', t: '鞭' }, { v: '10', t: '爪刺' }, { v: '11', t: '魔棒' }, { v: '12', t: '飘带' },
  { v: '13', t: '宝珠' }, { v: '14', t: '弓' }, { v: '15', t: '法杖' }, { v: '16', t: '男衣' },
  { v: '17', t: '女衣' }, { v: '18', t: '男头' }, { v: '19', t: '女头' }, { v: '20', t: '腰带' },
  { v: '21', t: '鞋子' }, { v: '22', t: '饰品' }, { v: '23', t: '灯笼' }, { v: '24', t: '巨剑' },
  { v: '25', t: '伞' }, { v: '26', t: '双斧' }, { v: '27', t: '棍' },
]
// 特技（teji_list，code 待校准）
const TEJI = [
  { v: 'jingqing', t: '晶清诀' }, { v: 'luohan', t: '罗汉金钟' }, { v: 'fangxia', t: '放下屠刀' },
  { v: 'xiaoli', t: '笑里藏刀' }, { v: 'posue', t: '破血狂攻' }, { v: 'posui', t: '破碎无双' },
  { v: 'ruodian', t: '弱点击破' }, { v: 'cihang', t: '慈航普度' }, { v: 'sihai', t: '四海升平' },
  { v: 'yuqing', t: '玉清诀' }, { v: 'yeshou', t: '野兽之力' }, { v: 'liuyun', t: '流云诀' },
  { v: 'ningzhi', t: '凝滞术' }, { v: 'guanghui', t: '光辉之甲' }, { v: 'pojia', t: '破甲术' },
  { v: 'shuiqing', t: '水清诀' }, { v: 'jingang', t: '金刚怒目' }, { v: 'qinyin', t: '琴音三叠' },
  { v: 'qiankun', t: '乾坤挪移' }, { v: 'xuanniao', t: '玄鸟之灵' }, { v: 'shenniao', t: '神鸟之印' },
  { v: 'boya', t: '伯牙绝弦' }, { v: 'fenqin', t: '焚琴煮鹤' }, { v: 'gongxin', t: '攻心术' },
  { v: 'jingxin', t: '惊心术' }, { v: 'miaofa', t: '妙法之护' }, { v: 'shenji', t: '神机之护' },
]
// 特效（texiao_list，code 待校准）
const TEXIAO = [
  { v: 'zhuan_yong', t: '专用' }, { v: 'wu_dengji', t: '无级别限制' }, { v: 'jian_yi', t: '简易' },
  { v: 'yong_bu_mo_sun', t: '永不磨损' }, { v: 'fen_nu', t: '愤怒' }, { v: 'bi_zhong', t: '必中' },
  { v: 'shen_nong', t: '神农' }, { v: 'shen_you', t: '神佑' }, { v: 'jue_sha', t: '绝杀' },
  { v: 'bao_nu', t: '暴怒' }, { v: 'jing_zhi', t: '精致' },
]
// 套装（taozhuang_type，code 待校准）
const TAOZHUANG = [
  { v: 'biangeng_dingxin', t: '变身定心术' }, { v: 'jin_gang_hu_fa', t: '金刚护法' },
  { v: 'ni_lin', t: '逆鳞' }, { v: 'man_tian_hua_yu', t: '满天花雨' }, { v: 'lian_qi_hua_shen', t: '炼气化神' },
  { v: 'pu_du_zhong_sheng', t: '普渡众生' }, { v: 'sheng_ming_zhi_quan', t: '生命之泉' },
  { v: 'bian_shen_zhi_feng_huang', t: '变身术之凤凰' }, { v: 'bian_shen_zhi_jiao_long', t: '变身术之蛟龙' },
  { v: 'bian_shen_zhi_yu_shi', t: '变身术之雨师' }, { v: 'bian_shen_zhi_ru_yi', t: '变身术之如意仙子' },
  { v: 'bian_shen_zhi_fu_rong', t: '变身术之芙蓉仙子' }, { v: 'bian_shen_zhi_xun_you', t: '变身术之巡游天神' },
  { v: 'bian_shen_zhi_xing_ling', t: '变身术之星灵仙子' }, { v: 'bian_shen_zhi_you_ling', t: '变身术之幽灵' },
  { v: 'bian_shen_zhi_gui_jiang', t: '变身术之鬼将' }, { v: 'bian_shen_zhi_xi_xue_gui', t: '变身术之吸血鬼' },
]
// 召唤兽类型（pet_type_list，code 待校准）
const PET_TYPES = [
  { v: 'lipi', t: '力劈宠' }, { v: 'shan_e', t: '善恶宠' }, { v: 'xumi', t: '须弥宠' },
  { v: 'siwang', t: '死亡宠' }, { v: 'fafang', t: '法防宠' }, { v: 'bileng', t: '壁垒宠' },
  { v: 'yin_gong', t: '隐攻宠' }, { v: 'gao_lian', t: '高连宠' }, { v: 'shenshou', t: '神兽' },
]
// 孩子结局（child_ending，code 待校准）
const CHILD_ENDINGS = [
  { v: 'jin_jun', t: '禁军斥候' }, { v: 'shao_jiang', t: '少将军' }, { v: 'da_xue_shi', t: '大学士' },
  { v: 'xiao_shi_yi', t: '小神医' }, { v: 'da_shi_shi', t: '大诗人' }, { v: 'jiang_hu', t: '江湖豪侠' },
  { v: 'peng_lai', t: '蓬莱小仙' }, { v: 'san_qing', t: '三清小祖' }, { v: 'wen_qu_xing', t: '文曲星' },
  { v: 'da_tian_shi', t: '大天师' }, { v: 'xiao_xian_ji', t: '小仙姬' }, { v: 'kuang_jin_gang', t: '狂金刚' },
  { v: 'man_sheng_nv', t: '蛮圣女' }, { v: 'xiao_cai_shen', t: '小财神' }, { v: 'mo_jie', t: '魔界小卒' },
  { v: 'hun_shi', t: '混世魔尊' }, { v: 'bai_mei', t: '百媚魔女' }, { v: 'xun_shou', t: '驯兽小大王' },
  { v: 'xun_shou_xiao', t: '驯兽小小主' }, { v: 'leng_pan_guan', t: '冷判官' }, { v: 'xiao_yan_wang', t: '小阎王' },
  { v: 'jia_wu_chang', t: '假无常' },
]
// 孩子门派（child_school，与门派同 code，待校准）
const CHILD_SCHOOLS = SCHOOLS
// 施法特效（perform_effect，code 待校准）
const PERFORM_EFFECTS = [
  { v: 'jin_gang', t: '金刚护法' }, { v: 'ni_lin', t: '逆鳞' }, { v: 'man_tian', t: '满天花雨' },
  { v: 'ding_xin', t: '定心术' }, { v: 'lian_qi', t: '炼气化神' }, { v: 'pu_du', t: '普渡众生' },
  { v: 'sheng_ming', t: '生命之泉' }, { v: 'bi_hu', t: '庇护' }, { v: 'wan_jian', t: '万剑归宗' },
]
// 祥瑞列表（xiangrui_list，code 待校准）
const XIANG_RUI = [
  { v: 'shen_xing', t: '神行小驴' }, { v: 'bi_yi', t: '比翼飞' }, { v: 'qing_luan', t: '青鸾' },
  { v: 'zhu_que', t: '朱雀' }, { v: 'bai_hu', t: '白虎' }, { v: 'xuan_wu', t: '玄武' },
  { v: 'qing_long', t: '青龙' }, { v: 'huo_yun', t: '火云' }, { v: 'jin_yu', t: '金羽' },
]
// 限量锦衣（limit_clothes，code 待校准）
const LIMIT_CLOTHES = [
  { v: 'chi_li', t: '赤鳞' }, { v: 'lan_ying', t: '蓝影' }, { v: 'zi_dian', t: '紫电' },
  { v: 'jin_huang', t: '金黄' }, { v: 'mo_yu', t: '墨羽' }, { v: 'xue_bai', t: '雪白' },
]
// 召唤兽装备（widget_list，code 待校准）
const WIDGETS = [
  { v: 'hu_wang', t: '护腕' }, { v: 'pi_jia', t: '披甲' }, { v: 'zhuo_zi', t: '坠子' },
  { v: 'ling_pei', t: '灵佩' }, { v: 'ya_jiao', t: '押角' }, { v: 'ti_jie', t: '蹄铠' },
]
// 化圣状态（zhuang_zhi，code 待校准）
const ZHUANG_ZHI = [
  { v: '0', t: '未化圣' }, { v: '1', t: '已化圣' }, { v: '2', t: '化圣二重' }, { v: '3', t: '化圣三重' },
]
// 加点方案（attr_point_strategy，code 待校准）
const ATTR_STRATEGY = [
  { v: 'ti', t: '体质' }, { v: 'mo', t: '魔力' }, { v: 'li', t: '力量' }, { v: 'nai', t: '耐力' }, { v: 'min', t: '敏捷' },
]

// 灵饰属性（lingshi_attr_*）映射：依据官网 args_config 列出顺序 ⇄ 官网"属性"区顺序推导
const LINGSHI_ATTRS = [
  { k: 'lingshi_attr_2', t: '伤害' }, { k: 'lingshi_attr_3', t: '速度' },
  { k: 'lingshi_attr_8', t: '封印' }, { k: 'lingshi_attr_11', t: '治疗' },
  { k: 'lingshi_attr_7', t: '法爆' }, { k: 'lingshi_attr_4', t: '法伤' },
  { k: 'lingshi_attr_9', t: '法伤结果' }, { k: 'lingshi_attr_1', t: '固伤' },
  { k: 'lingshi_attr_6', t: '物爆' }, { k: 'lingshi_attr_12', t: '气血' },
  { k: 'lingshi_attr_13', t: '防御' }, { k: 'lingshi_attr_14', t: '法防' },
  { k: 'lingshi_attr_17', t: '抗封' }, { k: 'lingshi_attr_18', t: '格挡' },
  { k: 'lingshi_attr_16', t: '抗法爆' }, { k: 'lingshi_attr_15', t: '抗物爆' },
]

// ============ 表单 ============
const f = reactive({
  level_min: '', level_max: '',
  price_min: '', price_max: '',
  sum_exp_min: '', sum_exp_max: '',
  // 角色自身修炼
  expt_gongj: '', expt_fangyu: '', expt_fashu: '', expt_kangfa: '', expt_lieshu: '', expt_total: '',
  max_expt_gongji: '', max_expt_fangyu: '', max_expt_fashu: '', max_expt_kangfa: '',
  // 召唤兽控制修炼
  bb_expt_gongji: '', bb_expt_fangyu: '', bb_expt_fashu: '', bb_expt_kangfa: '', bb_expt_total: '', skill_drive_pet: '',
  // 武器 / 项链
  max_weapon_shang_hai: '', max_weapon_damage: '', max_weapon_init_damage: '', max_weapon_init_damage_raw: '',
  max_necklace_ling_li: '', max_necklace_init_wakan: '',
  // 装备
  equip_level_min: '', equip_level_max: '',
  special_equip_max_level: '', taozhuang_num: '', taozhuang_type: '',
  // 灵饰
  lingshi_min_level: '', lingshi_max_level: '',
  lingshi_min_duanzao_level: '', lingshi_max_duanzao_level: '',
  // 召唤兽
  pet_skill_num: '', pet_advance_skill_num: '',
  // 法宝
  fabao_total_cnt: '',
  fabao_lv4_cnt: '', fabao_lv3_cnt: '', fabao_lv2_cnt: '', fabao_lv1_cnt: '',
  // 进阶坐骑
  jinjie_rider_level: '', jinjie_rider_growth: '', jinjie_rider_tongyu: '', jinjie_rider_skill_level_count: '',
  jinjie_rider_scheme_logic: '', jinjie_rider_scheme_use_pct: false,
  // 玄灵珠
  xuan_ling_zhu_level: '',
  // 孩子
  child_skill_num_min: '', child_skill_num_max: '',
  // 其他
  cheng_jiu: '', xian_yu: '', cash: '', sheng_yu_ling_you: '',
  is_niceid_new: '', jiyuan_and_addpoint: '',
  zhuang_zhi: '', attr_point_strategy: '',
  is_married: '', is_tongpao: '',
  // 神器（简化，code 待校准）
  shenqi_level: '',
  // ============ 角色技能（与藏宝阁 role_skills_panel 参数名一致，直发官网）============
  // 师门技能
  school_skill_num: '', school_skill_level: '', original_school_skill: '1',
  // 临时符 / 乾元丹 / 熟练度
  lin_shi_fu: '', qian_yuan_dan: '', smith_skill: '', sew_skill: '',
  // 生活技能
  skill_qiang_shen: '', skill_qiang_zhuang: '', skill_shensu: '', skill_ming_xiang: '', skill_anqi: '',
  skill_dazao: '', skill_caifeng: '', skill_qiaojiang: '', skill_lianjin: '', skill_yangsheng: '',
  skill_pengren: '', skill_zhongyao: '', skill_lingshi: '', skill_jianshen: '', skill_taoli: '',
  skill_zhuibu: '', skill_ronglian: '', skill_cuiling: '', skill_wind_sense: '', skill_rain_sense: '', skill_snow_sense: '',
  // 剧情技能
  skill_danyuan: '', skill_bianhua: '', skill_xianling: '', skill_jianzhu: '', skill_miaoshou: '',
  skill_huoyan: '', skill_baoshi: '', skill_qimen: '', skill_gudong: '', skill_tiaoxi: '',
  skill_dazuo: '', skill_hanmo: '', skill_danqing: '',
})
// 角色技能字段名（用于区块内「重置」）
const ROLE_SKILL_KEYS = [
  'school_skill_num', 'school_skill_level', 'original_school_skill', 'lin_shi_fu', 'qian_yuan_dan',
  'smith_skill', 'sew_skill', 'skill_qiang_shen', 'skill_qiang_zhuang', 'skill_shensu', 'skill_ming_xiang',
  'skill_anqi', 'skill_dazao', 'skill_caifeng', 'skill_qiaojiang', 'skill_lianjin', 'skill_yangsheng',
  'skill_pengren', 'skill_zhongyao', 'skill_lingshi', 'skill_jianshen', 'skill_taoli', 'skill_zhuibu',
  'skill_ronglian', 'skill_cuiling', 'skill_wind_sense', 'skill_rain_sense', 'skill_snow_sense',
  'skill_danyuan', 'skill_bianhua', 'skill_xianling', 'skill_jianzhu', 'skill_miaoshou', 'skill_huoyan',
  'skill_baoshi', 'skill_qimen', 'skill_gudong', 'skill_tiaoxi', 'skill_dazuo', 'skill_hanmo', 'skill_danqing',
]
function resetRoleSkills() {
  ROLE_SKILL_KEYS.forEach((k) => { (f as any)[k] = (k === 'original_school_skill') ? '1' : '' })
}
// 多选
const schools = ref<string[]>([])
const oriRaces = ref<string[]>([])
const races = ref<string[]>([])
const schoolChange = ref<string[]>([])
const equipKinds = ref<string[]>([])
const teji = ref<string[]>([])
const texiao = ref<string[]>([])
const petTypes = ref<string[]>([])
const childEndings = ref<string[]>([])
const childSchools = ref<string[]>([])
const performEffects = ref<string[]>([])
const xiangrui = ref<string[]>([])
const limitClothes = ref<string[]>([])
const widgets = ref<string[]>([])
// 匹配逻辑
const tejiMatchAll = ref(false)
const texiaoMatchAll = ref(false)
const petMatchAll = ref(false)
const lingshiMatchAll = ref(false)
const xiangruiMatchAll = ref(false)
const performMatchAll = ref(false)
const widgetMatchAll = ref(false)
const limitClothesLogic = ref('any') // any=满足其一 / all=满足全部
// 灵饰属性值
const lingshiVals = reactive<Record<string, string>>({})

// ---- 搜索条件本地存储 ----
const ROLE_STORAGE_KEY = 'cbg_role_conditions'
function saveRoleConditions() {
  const data = {
    scope: scope.value,
    selArea: selArea.value,
    selServerId: selServerId.value,
    serverTypes: serverTypes.value,
    f: { ...f },
    schools: schools.value,
    oriRaces: oriRaces.value,
    races: races.value,
    schoolChange: schoolChange.value,
    equipKinds: equipKinds.value,
    teji: teji.value,
    texiao: texiao.value,
    petTypes: petTypes.value,
    childEndings: childEndings.value,
    childSchools: childSchools.value,
    performEffects: performEffects.value,
    xiangrui: xiangrui.value,
    limitClothes: limitClothes.value,
    widgets: widgets.value,
    tejiMatchAll: tejiMatchAll.value,
    texiaoMatchAll: texiaoMatchAll.value,
    petMatchAll: petMatchAll.value,
    lingshiMatchAll: lingshiMatchAll.value,
    xiangruiMatchAll: xiangruiMatchAll.value,
    performMatchAll: performMatchAll.value,
    widgetMatchAll: widgetMatchAll.value,
    limitClothesLogic: limitClothesLogic.value,
    lingshiVals: { ...lingshiVals },
  }
  localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(data))
}
function loadRoleConditions() {
  try {
    const raw = localStorage.getItem(ROLE_STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.scope) scope.value = data.scope
    if (data.selArea) selArea.value = data.selArea
    if (data.selServerId) selServerId.value = data.selServerId
    if (Array.isArray(data.serverTypes)) serverTypes.value = data.serverTypes
    if (data.f) Object.assign(f, data.f)
    if (Array.isArray(data.schools)) schools.value = data.schools
    if (Array.isArray(data.oriRaces)) oriRaces.value = data.oriRaces
    if (Array.isArray(data.races)) races.value = data.races
    if (Array.isArray(data.schoolChange)) schoolChange.value = data.schoolChange
    if (Array.isArray(data.equipKinds)) equipKinds.value = data.equipKinds
    if (Array.isArray(data.teji)) teji.value = data.teji
    if (Array.isArray(data.texiao)) texiao.value = data.texiao
    if (Array.isArray(data.petTypes)) petTypes.value = data.petTypes
    if (Array.isArray(data.childEndings)) childEndings.value = data.childEndings
    if (Array.isArray(data.childSchools)) childSchools.value = data.childSchools
    if (Array.isArray(data.performEffects)) performEffects.value = data.performEffects
    if (Array.isArray(data.xiangrui)) xiangrui.value = data.xiangrui
    if (Array.isArray(data.limitClothes)) limitClothes.value = data.limitClothes
    if (Array.isArray(data.widgets)) widgets.value = data.widgets
    if (typeof data.tejiMatchAll === 'boolean') tejiMatchAll.value = data.tejiMatchAll
    if (typeof data.texiaoMatchAll === 'boolean') texiaoMatchAll.value = data.texiaoMatchAll
    if (typeof data.petMatchAll === 'boolean') petMatchAll.value = data.petMatchAll
    if (typeof data.lingshiMatchAll === 'boolean') lingshiMatchAll.value = data.lingshiMatchAll
    if (typeof data.xiangruiMatchAll === 'boolean') xiangruiMatchAll.value = data.xiangruiMatchAll
    if (typeof data.performMatchAll === 'boolean') performMatchAll.value = data.performMatchAll
    if (typeof data.widgetMatchAll === 'boolean') widgetMatchAll.value = data.widgetMatchAll
    if (data.limitClothesLogic) limitClothesLogic.value = data.limitClothesLogic
    if (data.lingshiVals) Object.assign(lingshiVals, data.lingshiVals)
    // roleOpen 不从本地恢复，始终默认收起
  } catch (e) {
    /* 解析失败忽略 */
  }
}
function clearRoleConditions() {
  // 重置服务器
  scope.value = 'single'
  selArea.value = '58'
  selServerId.value = '976'
  serverTypes.value = []
  // 重置表单（按字段类型重置）
  Object.keys(f).forEach(k => {
    if (k === 'jinjie_rider_scheme_use_pct') {
      (f as any)[k] = false
    } else {
      (f as any)[k] = ''
    }
  })
  // 重置多选
  schools.value = []
  oriRaces.value = []
  races.value = []
  schoolChange.value = []
  equipKinds.value = []
  teji.value = []
  texiao.value = []
  petTypes.value = []
  childEndings.value = []
  childSchools.value = []
  performEffects.value = []
  xiangrui.value = []
  limitClothes.value = []
  widgets.value = []
  // 重置匹配逻辑
  tejiMatchAll.value = false
  texiaoMatchAll.value = false
  petMatchAll.value = false
  lingshiMatchAll.value = false
  xiangruiMatchAll.value = false
  performMatchAll.value = false
  widgetMatchAll.value = false
  limitClothesLogic.value = 'any'
  // 清空灵饰属性
  Object.keys(lingshiVals).forEach(k => { lingshiVals[k] = '' })
  localStorage.removeItem(ROLE_STORAGE_KEY)
}

function toggleArr(arr: string[], v: string) {
  const i = arr.indexOf(v)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(v)
}
function toggleSchools(v: string) { toggleArr(schools.value, v) }
function toggleOriRaces(v: string) { toggleArr(oriRaces.value, v) }
function toggleRaces(v: string) { toggleArr(races.value, v) }
function toggleSchoolChange(v: string) { toggleArr(schoolChange.value, v) }
function toggleEquipKinds(v: string) { toggleArr(equipKinds.value, v) }
function toggleTeji(v: string) { toggleArr(teji.value, v) }
function toggleTexiao(v: string) { toggleArr(texiao.value, v) }
function togglePetTypes(v: string) { toggleArr(petTypes.value, v) }
function toggleChildEndings(v: string) { toggleArr(childEndings.value, v) }
function toggleChildSchools(v: string) { toggleArr(childSchools.value, v) }
function togglePerform(v: string) { toggleArr(performEffects.value, v) }
function toggleXiangrui(v: string) { toggleArr(xiangrui.value, v) }
function toggleLimitClothes(v: string) { toggleArr(limitClothes.value, v) }
function toggleWidgets(v: string) { toggleArr(widgets.value, v) }

// ============ 构造 args（与官网 overall_search_role.js 一致）============
function buildArgs(): Record<string, any> {
  const a: Record<string, any> = {}
  const num = (k: string, v: string) => { if (v !== '' && v != null) a[k] = Number(v) }
  // 基础
  num('level_min', f.level_min); num('level_max', f.level_max)
  if (schools.value.length) a['school'] = schools.value.join(',')
  if (schoolChange.value.length) a['school_change_list'] = schoolChange.value.join(',')
  if (oriRaces.value.length) a['ori_race'] = oriRaces.value.join(',')
  if (races.value.length) a['race'] = races.value.join(',')
  if (f.price_min) a['price_min'] = Math.round(Number(f.price_min) * 100)
  if (f.price_max) a['price_max'] = Math.round(Number(f.price_max) * 100)
  if (f.sum_exp_min) a['sum_exp_min'] = Math.round(Number(f.sum_exp_min) * 10000)
  if (f.sum_exp_max) a['sum_exp_max'] = Math.round(Number(f.sum_exp_max) * 10000)
  if (f.attr_point_strategy) a['attr_point_strategy'] = f.attr_point_strategy
  if (f.is_niceid_new) a['is_niceid_new'] = f.is_niceid_new
  if (f.zhuang_zhi) a['zhuang_zhi'] = f.zhuang_zhi
  if (f.jiyuan_and_addpoint !== '') a['jiyuan_and_addpoint'] = Number(f.jiyuan_and_addpoint)
  // 角色自身修炼
  num('expt_gongj', f.expt_gongj); num('expt_fangyu', f.expt_fangyu); num('expt_fashu', f.expt_fashu)
  num('expt_kangfa', f.expt_kangfa); num('expt_lieshu', f.expt_lieshu); num('expt_total', f.expt_total)
  num('max_expt_gongji', f.max_expt_gongji); num('max_expt_fangyu', f.max_expt_fangyu)
  num('max_expt_fashu', f.max_expt_fashu); num('max_expt_kangfa', f.max_expt_kangfa)
  // 召唤兽控制修炼
  num('bb_expt_gongji', f.bb_expt_gongji); num('bb_expt_fangyu', f.bb_expt_fangyu)
  num('bb_expt_fashu', f.bb_expt_fashu); num('bb_expt_kangfa', f.bb_expt_kangfa); num('bb_expt_total', f.bb_expt_total)
  num('skill_drive_pet', f.skill_drive_pet)
  // 武器 / 项链
  num('max_weapon_shang_hai', f.max_weapon_shang_hai); num('max_weapon_damage', f.max_weapon_damage)
  num('max_weapon_init_damage', f.max_weapon_init_damage); num('max_weapon_init_damage_raw', f.max_weapon_init_damage_raw)
  num('max_necklace_ling_li', f.max_necklace_ling_li); num('max_necklace_init_wakan', f.max_necklace_init_wakan)
  // 装备
  num('equip_level_min', f.equip_level_min); num('equip_level_max', f.equip_level_max)
  if (equipKinds.value.length) a['own_equips_equip_kind_id'] = equipKinds.value
  if (teji.value.length) { a['teji_list'] = teji.value; if (tejiMatchAll.value) a['teji_match_all'] = 1 }
  if (texiao.value.length) { a['texiao_list'] = texiao.value; if (texiaoMatchAll.value) a['texiao_match_all'] = 1 }
  if (f.special_equip_max_level !== '') a['special_equip_max_level'] = f.special_equip_max_level || '1'
  num('taozhuang_num', f.taozhuang_num)
  if (f.taozhuang_type) a['taozhuang_type'] = f.taozhuang_type
  if (limitClothes.value.length) { a['limit_clothes'] = limitClothes.value; a['limit_clothes_logic'] = limitClothesLogic.value }
  // 灵饰
  num('lingshi_min_level', f.lingshi_min_level); num('lingshi_max_level', f.lingshi_max_level)
  num('lingshi_min_duanzao_level', f.lingshi_min_duanzao_level); num('lingshi_max_duanzao_level', f.lingshi_max_duanzao_level)
  for (const la of LINGSHI_ATTRS) {
    const v = lingshiVals[la.k]
    if (v !== '' && v != null) { a[la.k] = Number(v); if (lingshiMatchAll.value) a['lingshi_attr_match_all'] = 1 }
  }
  // 召唤兽
  num('pet_skill_num', f.pet_skill_num); num('pet_advance_skill_num', f.pet_advance_skill_num)
  if (petTypes.value.length) { a['pet_type_list'] = petTypes.value; if (petMatchAll.value) a['pet_match_all'] = 1 }
  // 召唤兽装备
  if (widgets.value.length) { a['widget_list'] = widgets.value; if (widgetMatchAll.value) a['widget_match_all'] = 1 }
  // 神器（简化：等级，code 待校准）
  if (f.shenqi_level !== '') a['shenqi_level'] = Number(f.shenqi_level)
  // 法宝
  num('fabao_total_cnt', f.fabao_total_cnt)
  for (const lv of [4, 3, 2, 1]) {
    const key = 'fabao_lv' + lv + '_cnt'
    if ((f as any)[key] !== '') a[key] = Number((f as any)[key])
  }
  // 进阶坐骑
  num('jinjie_rider_level', f.jinjie_rider_level); num('jinjie_rider_growth', f.jinjie_rider_growth)
  num('jinjie_rider_tongyu', f.jinjie_rider_tongyu); num('jinjie_rider_skill_level_count', f.jinjie_rider_skill_level_count)
  if (f.jinjie_rider_scheme_logic) a['jinjie_rider_scheme_logic'] = f.jinjie_rider_scheme_logic
  if (f.jinjie_rider_scheme_use_pct) a['jinjie_rider_scheme_use_pct'] = 1
  if (f.xuan_ling_zhu_level !== '') a['xuan_ling_zhu_level'] = Number(f.xuan_ling_zhu_level)
  // 孩子
  if (f.child_skill_num_min !== '') a['child_skill_num_min'] = Number(f.child_skill_num_min)
  if (f.child_skill_num_max !== '') a['child_skill_num_max'] = Number(f.child_skill_num_max)
  if (childEndings.value.length) a['child_ending'] = childEndings.value.join(',')
  if (childSchools.value.length) a['child_school'] = childSchools.value.join(',')
  // 祥瑞
  if (xiangrui.value.length) { a['xiangrui_list'] = xiangrui.value; if (xiangruiMatchAll.value) a['xiangrui_match_all'] = 1 }
  // 施法特效
  if (performEffects.value.length) { a['perform_effect'] = performEffects.value; if (performMatchAll.value) a['perform_match_all'] = 1 }
  // 其他
  num('cheng_jiu', f.cheng_jiu); num('xian_yu', f.xian_yu); num('cash', f.cash)
  num('sheng_yu_ling_you', f.sheng_yu_ling_you)
  if (f.is_married) a['is_married'] = f.is_married
  if (f.is_tongpao) a['is_tongpao'] = f.is_tongpao
  // ============ 角色技能（参数名与藏宝阁 role_skills_panel 完全一致，直发官网）============
  num('school_skill_num', f.school_skill_num)
  num('school_skill_level', f.school_skill_level)
  if (f.original_school_skill) a['original_school_skill'] = f.original_school_skill
  num('lin_shi_fu', f.lin_shi_fu); num('qian_yuan_dan', f.qian_yuan_dan)
  num('smith_skill', f.smith_skill); num('sew_skill', f.sew_skill)
  // 生活技能
  num('skill_qiang_shen', f.skill_qiang_shen); num('skill_qiang_zhuang', f.skill_qiang_zhuang)
  num('skill_shensu', f.skill_shensu); num('skill_ming_xiang', f.skill_ming_xiang); num('skill_anqi', f.skill_anqi)
  num('skill_dazao', f.skill_dazao); num('skill_caifeng', f.skill_caifeng); num('skill_qiaojiang', f.skill_qiaojiang)
  num('skill_lianjin', f.skill_lianjin); num('skill_yangsheng', f.skill_yangsheng); num('skill_pengren', f.skill_pengren)
  num('skill_zhongyao', f.skill_zhongyao); num('skill_lingshi', f.skill_lingshi); num('skill_jianshen', f.skill_jianshen)
  num('skill_taoli', f.skill_taoli); num('skill_zhuibu', f.skill_zhuibu); num('skill_ronglian', f.skill_ronglian)
  num('skill_cuiling', f.skill_cuiling); num('skill_wind_sense', f.skill_wind_sense)
  num('skill_rain_sense', f.skill_rain_sense); num('skill_snow_sense', f.skill_snow_sense)
  // 剧情技能
  num('skill_danyuan', f.skill_danyuan); num('skill_bianhua', f.skill_bianhua); num('skill_xianling', f.skill_xianling)
  num('skill_jianzhu', f.skill_jianzhu); num('skill_miaoshou', f.skill_miaoshou); num('skill_huoyan', f.skill_huoyan)
  num('skill_baoshi', f.skill_baoshi); num('skill_qimen', f.skill_qimen); num('skill_gudong', f.skill_gudong)
  num('skill_tiaoxi', f.skill_tiaoxi); num('skill_dazuo', f.skill_dazuo); num('skill_hanmo', f.skill_hanmo); num('skill_danqing', f.skill_danqing)
  // 服务器
  if (scope.value === 'single') {
    if (selServerId.value) a['serverid'] = selServerId.value
  } else {
    if (serverTypes.value.length) a['server_type'] = serverTypes.value.join(',')
  }
  return a
}

// ============ 收起/展开 ============
const roleOpen = ref(false)
function doSearch() {
  saveRoleConditions()  // 搜索前保存条件
  const args = buildArgs()
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = 'https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py'
  form.target = '_blank'
  form.style.display = 'none'
  const add = (name: string, value: string) => {
    const i = document.createElement('input')
    i.type = 'hidden'; i.name = name; i.value = value
    form.appendChild(i)
  }
  add('act', 'show_role_search_result')
  // 藏宝阁官网角色搜索表单只含 act + args 两个隐藏字段，args 是【扁平条件对象的 JSON 串】
  // （由 overall_search_role.js 的 JSON.encode(args) 生成，服务端只解析 args，不认展开后的扁平表单字段）。
  // 因此必须整体 JSON.stringify(args) 提交；若逐字段展开会缺失 args 导致服务端报「参数错误」。
  // 价格单位：元×100（分），与官网 parseInt(price*100) 一致，buildArgs() 已处理。
  add('args', JSON.stringify(args))
  document.body.appendChild(form)
  form.submit()
  document.body.removeChild(form)
}

// ============ 角色订阅（复用同一后端 /api/cbg/subscriptions）============
interface RoleSub { id: number; name: string; label?: string; enabled: boolean; interval_minutes?: number; next_run?: number | null; last_run?: number | null; last_result?: string | null; conditions_json?: string; server_name?: string; server_id?: string }
const roleSubs = ref<RoleSub[]>([])
const roleSubLoading = ref<number | null>(null) // 正在采集的订阅 ID
const roleSubForm = reactive({ name: '', label: '', interval_minutes: 60 })
const roleSubMsg = ref('')
async function loadRoleSubs() {
  try {
    const r = await cbgApi.listSubscriptions() as { subscriptions?: any[] }
    const all = r.subscriptions || []
    roleSubs.value = all
      .filter((s: any) => { try { const c = JSON.parse(s.conditions_json || '{}'); return c.type === 'role' } catch { return false } })
      .map((s: any) => ({ ...s, enabled: !!s.enabled }))
  } catch (e) { /* ignore */ }
}
function fmtTime(ts?: number | null): string {
  if (!ts) return '从未'
  const d = new Date(ts * 1000)
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function subNextText(s: RoleSub): string {
  if (s.next_run == null) return '待执行'
  const left = Math.floor(s.next_run - Date.now() / 1000)
  if (left <= 0) return '已到期·待执行'
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60)
  return h > 0 ? `约 ${h} 小时${m} 分钟后` : `约 ${m} 分钟后`
}
// 服龄映射
const SERVER_TYPE_MAP: Record<string, string> = { '3': '3年以上服', '2': '1到3年服', '1': '1年内服' }
// 解析订阅条件为可读摘要
function parseRoleConditions(s: RoleSub): string[] {
  if (!s.conditions_json) return []
  try {
    const c = JSON.parse(s.conditions_json)
    const role = c.role || {}
    const parts: string[] = []
    // 等级（只有 min 时显示 174+，只有 max 时显示 ?-174）
    if (role.level_min || role.level_max) {
      const min = role.level_min || '?'
      const max = role.level_max
      if (min !== '?' && !max) parts.push('等级 ' + min + '+')
      else if (min === '?' && max) parts.push('等级 ?-' + max)
      else parts.push('等级 ' + min + '-' + max)
    }
    // 服龄（全服搜索时）
    if (c.serverTypes && c.serverTypes.length) {
      const names = c.serverTypes.map((t: string) => SERVER_TYPE_MAP[t] || t).join('/')
      parts.push(names)
    }
    // 门派
    if (role.school) {
      const names = String(role.school).split(',').map((id: string) => SCHOOL_MAP[id] || id)
      parts.push('门派:' + names.join('/'))
    }
    // 修炼
    const expt: string[] = []
    if (role.expt_gongj) expt.push('攻' + role.expt_gongj)
    if (role.expt_fashu) expt.push('法' + role.expt_fashu)
    if (role.expt_kangfa) expt.push('抗' + role.expt_kangfa)
    if (role.expt_total) expt.push('总' + role.expt_total)
    if (expt.length) parts.push('修:' + expt.join('/'))
    // 价格
    if (role.price_min || role.price_max) {
      const min = role.price_min ? Math.round(role.price_min / 100) : '?'
      const max = role.price_max ? Math.round(role.price_max / 100) : '?'
      parts.push('¥' + min + '-' + max)
    }
    // 总经验
    if (role.sum_exp_min || role.sum_exp_max) {
      const min = role.sum_exp_min ? Math.round(role.sum_exp_min / 10000) : '?'
      const max = role.sum_exp_max ? Math.round(role.sum_exp_max / 10000) : '?'
      parts.push('经验' + min + '-' + max + '亿')
    }
    // 召唤兽控制修炼
    const bbExpt: string[] = []
    if (role.bb_expt_gongji) bbExpt.push('攻' + role.bb_expt_gongji)
    if (role.bb_expt_fashu) bbExpt.push('法' + role.bb_expt_fashu)
    if (role.bb_expt_total) bbExpt.push('总' + role.bb_expt_total)
    if (bbExpt.length) parts.push('控修:' + bbExpt.join('/'))
    // 特技
    if (role.teji_list) parts.push('特技×' + role.teji_list.length)
    // 召唤兽
    if (role.pet_type_list) parts.push('宠×' + role.pet_type_list.length)
    return parts
  } catch { return [] }
}
async function saveRoleSub() {
  const args = buildArgs()
  const cond: any = { type: 'role', scope: scope.value }
  if (scope.value === 'single') { cond.serverid = selServerId.value; cond.server_name = selServerName.value }
  else cond.serverTypes = serverTypes.value
  cond.role = args
  try {
    await cbgApi.addSubscription({
      name: roleSubForm.name.trim() || (selServerName.value + '·角色订阅'),
      label: roleSubForm.label.trim(),
      server_id: scope.value === 'single' ? selServerId.value : '',
      server_name: selServerName.value,
      search_url: 'https://xyq.cbg.163.com/cgi-bin/xyq_overall_search.py?act=show_role_search_result',
      conditions_json: JSON.stringify(cond),
      interval_minutes: roleSubForm.interval_minutes,
      // 关键：保存即启用，否则后端默认 enabled=0（已暂停）→ 不在 due 列表 → 永不自动采集；
      // 网页「立即采集」走 run-now 只改 next_run，仍被 due 的 enabled=1 过滤挡掉，会静默失效。
      enabled: 1,
    })
    roleSubMsg.value = '已保存角色订阅，扩展端将按设定间隔自动采集'
    roleSubForm.name = ''; roleSubForm.label = ''
    await loadRoleSubs()
  } catch (e) { roleSubMsg.value = '保存失败：' + (e as Error).message }
}
async function toggleRoleSub(s: RoleSub) {
  await cbgApi.updateSubscription(s.id, { enabled: !s.enabled })
  s.enabled = !s.enabled
}
async function runRoleSub(id: number) {
  roleSubLoading.value = id
  roleSubMsg.value = '已触发采集，等待扩展执行…'
  try {
    await cbgApi.runSubscriptionNow(id)
  } catch (e) {
    roleSubMsg.value = '触发失败：' + (e as Error).message
    roleSubLoading.value = null
    return
  }
  // 轮询直到 last_run 更新或超时 2 分钟
  const start = Date.now()
  const oldRun = roleSubs.value.find(s => s.id === id)?.last_run
  const poll = async () => {
    if (Date.now() - start > 120000) {
      roleSubMsg.value = '采集超时，请刷新查看结果'
      roleSubLoading.value = null
      return
    }
    await loadRoleSubs()
    const nowRun = roleSubs.value.find(s => s.id === id)?.last_run
    if (nowRun && nowRun !== oldRun) {
      roleSubLoading.value = null
      const result = roleSubs.value.find(s => s.id === id)?.last_result
      roleSubMsg.value = '采集完成：' + (result || '无结果')
    } else {
      setTimeout(poll, 3000)
    }
  }
  setTimeout(poll, 3000)
}
async function delRoleSub(id: number) {
  await cbgApi.delSubscription(id)
  await loadRoleSubs()
}

// ============ 角色藏品库 ============
interface RoleItem {
  eid: string; name: string; price: number; server_id?: string; server_name?: string; status?: string;
  attrs_json?: string; detail_url?: string; thumb_url?: string; local_thumb?: string; captured_at?: number;
  est_price?: number | null; // 后端自动估价结果
}
const roleItems = ref<RoleItem[]>([])
const roleLoading = ref(false)
async function loadRoleItems() {
  roleLoading.value = true
  try {
    const r = await cbgApi.listItems({ item_type: 'role' })
    roleItems.value = (r.items || []).sort((a: RoleItem, b: RoleItem) => (b.captured_at || 0) - (a.captured_at || 0))
  } catch (e) { /* ignore */ }
  roleLoading.value = false
}
// 头像优先用本地缩略图（后端已下载到 thumbs/，无网易防盗链问题），回退网易直链
function roleThumb(it: RoleItem): string {
  if (it.local_thumb) return '/api/cbg/thumb/' + it.local_thumb
  if (it.thumb_url) return it.thumb_url
  return ''
}
function openCbg(it: RoleItem) {
  if (it.detail_url) window.open(it.detail_url, '_blank', 'noopener')
}
function parseRoleAttrsJson(it: RoleItem): Record<string, any> {
  try { return it.attrs_json ? JSON.parse(it.attrs_json) : {} } catch { return {} }
}
function fmtPrice(p: number | null | undefined): string {
  if (p == null) return '—'
  return '¥' + Number(p)
}
// 采集时间（captured_at 为 unix 秒），与玉魄藏品库展示格式一致：月/日 时:分
// 注意：名字不能叫 fmtTime —— 上面已有一个 fmtTime 给订阅「上次运行」用（空值显示"从未"），
// 表格单元格需要空值显示"—"，故单独命名 fmtItemTime 避免重复实现与语义混淆。
function fmtItemTime(ts?: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// 估价展示（不带千分位逗号）：低于估价→性价比高(绿)，高于→偏贵(红)
function fmtEstPrice(it: RoleItem): string {
  if (it.est_price == null) return '—'
  if (it.est_price < 0) return '无数据'
  return '¥' + Math.round(it.est_price)
}
function estPriceClass(it: RoleItem): string {
  if (it.est_price == null || it.est_price < 0 || !it.price) return ''
  return it.price <= it.est_price ? 'est-good' : 'est-bad'
}
async function delRoleItem(eid: string) {
  await cbgApi.delItem(eid)
  await loadRoleItems()
}
async function clearAllRoleItems() {
  if (!roleItems.value.length) return
  await cbgApi.delItemsByType('role')
  await loadRoleItems()
}

// ============ 角色藏品库前端筛选（与玉魄 filter-grid 一致）============
// 服龄映射（复用 /cbg_server_ages.json）
interface ServerAgeInfo { name?: string; area?: string; date?: string; age?: string; source?: string }
const serverAges = ref<Record<string, ServerAgeInfo>>({})
async function loadServerAges() {
  try {
    const r = await fetch('/cbg_server_ages.json')
    if (r.ok) serverAges.value = await r.json()
  } catch (e) { /* 忽略 */ }
}
const AGE_LABEL: Record<string, string> = { old: '3年以上服', mid: '1-3年服', new: '1年内服' }
function serverAgeLabel(sid?: string | null): string {
  if (!sid) return ''
  const a = serverAges.value[String(sid)]
  return a && a.age ? (AGE_LABEL[a.age] || '') : ''
}
function serverAgeClass(sid?: string | null): string {
  if (!sid) return ''
  const a = serverAges.value[String(sid)]
  return a && a.age ? ('age-' + a.age) : ''
}

const roleServer = ref('')
const roleKw = ref('')
const roleMinPrice = ref('')
const roleMaxPrice = ref('')
const roleSort = ref('time_desc')
const roleStatusFilter = ref('')
const roleAgeFilter = ref('')

const filteredRoleItems = computed<RoleItem[]>(() => {
  let list = roleItems.value.slice()
  const sv = roleServer.value.trim().toLowerCase()
  if (sv) {
    list = list.filter((it) =>
      (it.server_id && String(it.server_id).toLowerCase().includes(sv)) ||
      (it.server_name && it.server_name.toLowerCase().includes(sv)) ||
      (serverLabelById(it.server_id) && serverLabelById(it.server_id).toLowerCase().includes(sv))
    )
  }
  const kw = roleKw.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((it) => {
      const hay = (it.name || '') + ' ' + JSON.stringify(parseRoleAttrsJson(it) || {})
      return hay.toLowerCase().includes(kw)
    })
  }
  if (roleMinPrice.value) {
    const min = Number(roleMinPrice.value)
    list = list.filter((it) => (it.price || 0) >= min)
  }
  if (roleMaxPrice.value) {
    const max = Number(roleMaxPrice.value)
    list = list.filter((it) => (it.price || 0) <= max)
  }
  if (roleStatusFilter.value) {
    list = list.filter((it) => (it.status || '在售') === roleStatusFilter.value)
  }
  if (roleAgeFilter.value) {
    list = list.filter((it) => {
      const a = serverAges.value[String(it.server_id)]
      return a && a.age === roleAgeFilter.value
    })
  }
  const s = roleSort.value
  list.sort((a, b) => {
    if (s === 'price_asc') return (a.price || 0) - (b.price || 0)
    if (s === 'price_desc') return (b.price || 0) - (a.price || 0)
    if (s === 'grade_asc') return gradeNum(a) - gradeNum(b)
    if (s === 'grade_desc') return gradeNum(b) - gradeNum(a)
    return (b.captured_at || 0) - (a.captured_at || 0)
  })
  return list
})
function gradeNum(it: RoleItem): number {
  const g = parseRoleAttrsJson(it)
  const v = g && g['等级']
  const n = typeof v === 'number' ? v : Number(v)
  return isNaN(n) ? 0 : n
}

function resetRoleFilters() {
  roleServer.value = ''; roleKw.value = ''; roleMinPrice.value = ''; roleMaxPrice.value = ''
  roleSort.value = 'time_desc'; roleStatusFilter.value = ''; roleAgeFilter.value = ''
}
// 点击列头排序：挂牌价 / 等级 直接点列头切换升/降序
function sortByPrice() {
  roleSort.value = roleSort.value === 'price_asc' ? 'price_desc' : 'price_asc'
}
function sortByGrade() {
  roleSort.value = roleSort.value === 'grade_asc' ? 'grade_desc' : 'grade_asc'
}
const priceSortInd = computed(() => roleSort.value === 'price_asc' ? '▲' : roleSort.value === 'price_desc' ? '▼' : '')
const gradeSortInd = computed(() => roleSort.value === 'grade_asc' ? '▲' : roleSort.value === 'grade_desc' ? '▼' : '')

onMounted(() => { loadServerMap(); loadServerAges(); loadRoleConditions(); loadRoleSubs(); loadRoleItems() })
</script>

<template>
  <div class="role-search">
    <!-- 收起/展开头部（与玉魄面板一致） -->
    <div class="role-head" @click="roleOpen = !roleOpen">
      <h2>🔍 按条件去藏宝阁搜「角色」</h2>
      <div class="role-head-right">
        <span class="role-toggle">{{ roleOpen ? '收起 ▲' : '展开 ▼' }}</span>
        <button class="btn btn-blue btn-sm" @click.stop="doSearch">去搜索 ↗</button>
      </div>
    </div>
    <div class="role-body" :class="{ open: roleOpen }">
      <p class="muted role-intro">
        选好<strong>服务器与条件</strong>，点「去搜索」直接跳到<strong>带筛选的藏宝阁实时结果页</strong>。
        排版对齐官网角色搜索：分组块 + 左列字段名、右列条件。参数名已按官网 <code>args</code> 全量校准；标「code 待校准」的列表项为最佳猜测值。
      </p>

      <!-- 服务器范围 -->
      <div class="divGride searchForm">
        <div class="title"><h3>服务器范围</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>搜索范围</th><td>
              <button type="button" class="seg" :class="{ on: scope === 'single' }" @click="scope = 'single'">单服（按所选服）</button>
              <button type="button" class="seg" :class="{ on: scope === 'cross' }" @click="scope = 'cross'">全服搜索</button>
            </td></tr>
            <tr v-if="scope === 'single'"><th>选择服务器</th><td>
              <select v-model="selArea" class="sel"><option v-for="a in serverMap.areas" :key="a.area_id" :value="a.area_id">{{ a.area_name }}</option></select>
              <select v-model="selServerId" class="sel"><option v-for="s in areaServers" :key="s.server_id" :value="s.server_id">{{ s.server_name }}</option></select>
              <span class="muted">当前：{{ selServerName }}</span>
            </td></tr>
            <tr v-else><th>开服时间</th><td>
              <ul class="btnList yp-range">
                <li :class="{ on: serverTypes.includes('3') }" @click="toggleServerType('3')"><span>3年以上服</span></li>
                <li :class="{ on: serverTypes.includes('2') }" @click="toggleServerType('2')"><span>1到3年服</span></li>
                <li :class="{ on: serverTypes.includes('1') }" @click="toggleServerType('1')"><span>1年内服</span></li>
              </ul>
              <span class="muted" style="margin-left:8px;font-size:12px">可多选</span>
            </td></tr>
          </table>
        </div>
      </div>

      <!-- 基础条件 -->
      <div class="divGride searchForm">
        <div class="title"><h3>基础条件</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>等级</th><td>
              ≥ <input class="mini" v-model="f.level_min" size="6" placeholder="0" /> -
              ≤ <input class="mini" v-model="f.level_max" size="6" placeholder="175" />
            </td></tr>
            <tr><th>价格(元)</th><td>
              ≥ <input class="mini" v-model="f.price_min" size="6" /> -
              ≤ <input class="mini" v-model="f.price_max" size="6" />
            </td></tr>
            <tr><th>总经验</th><td>
              ≥ <input class="mini" v-model="f.sum_exp_min" size="8" placeholder="万" />万 -
              ≤ <input class="mini" v-model="f.sum_exp_max" size="8" placeholder="万" />万
            </td></tr>
            <tr><th>门派</th><td>
              <ul class="btnList yp-range"><li v-for="o in SCHOOLS" :key="o.v" :class="{ on: schools.includes(o.v) }" @click="toggleSchools(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">可多选</span>
            </td></tr>
            <tr><th>原始种族</th><td>
              <ul class="btnList yp-range"><li v-for="o in ORI_RACES" :key="o.v" :class="{ on: oriRaces.includes(o.v) }" @click="toggleOriRaces(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">转门派前的种族·code 待校准</span>
            </td></tr>
            <tr><th>种族</th><td>
              <ul class="btnList yp-range"><li v-for="o in RACES" :key="o.v" :class="{ on: races.includes(o.v) }" @click="toggleRaces(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>曾用门派</th><td>
              <ul class="btnList yp-range"><li v-for="o in SCHOOLS" :key="o.v" :class="{ on: schoolChange.includes(o.v) }" @click="toggleSchoolChange(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">可多选·code 待校准</span>
            </td></tr>
            <tr><th>加点方案</th><td>
              <select v-model="f.attr_point_strategy" class="sel"><option value="">--不限--</option><option v-for="o in ATTR_STRATEGY" :key="o.v" :value="o.v">{{ o.t }}</option></select>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>靓号</th><td>
              <select v-model="f.is_niceid_new" class="sel"><option value="">不限</option><option value="1">是</option></select>
            </td></tr>
            <tr><th>化圣</th><td>
              <select v-model="f.zhuang_zhi" class="sel"><option value="">不限</option><option v-for="o in ZHUANG_ZHI" :key="o.v" :value="o.v">{{ o.t }}</option></select>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>机缘点</th><td>≥ <input class="mini" v-model="f.jiyuan_and_addpoint" size="6" placeholder="0" /></td></tr>
          </table>
        </div>
      </div>

      <!-- 角色自身修炼 -->
      <div class="divGride searchForm">
        <div class="title"><h3>角色自身修炼</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>攻击修炼</th><td>≥ <input class="mini" v-model="f.expt_gongj" size="6" /></td>
              <th>防御修炼</th><td>≥ <input class="mini" v-model="f.expt_fangyu" size="6" /></td></tr>
            <tr><th>法术修炼</th><td>≥ <input class="mini" v-model="f.expt_fashu" size="6" /></td>
              <th>抗法修炼</th><td>≥ <input class="mini" v-model="f.expt_kangfa" size="6" /></td></tr>
            <tr><th>修炼总和</th><td>≥ <input class="mini" v-model="f.expt_total" size="6" /></td>
              <th>猎术修炼</th><td>≥ <input class="mini" v-model="f.expt_lieshu" size="6" /> <span class="muted">（不计入修炼总和）</span></td></tr>
            <tr><th>攻击上限</th><td>≥ <input class="mini" v-model="f.max_expt_gongji" size="6" /></td>
              <th>防御上限</th><td>≥ <input class="mini" v-model="f.max_expt_fangyu" size="6" /></td></tr>
            <tr><th>法术上限</th><td>≥ <input class="mini" v-model="f.max_expt_fashu" size="6" /></td>
              <th>抗法上限</th><td>≥ <input class="mini" v-model="f.max_expt_kangfa" size="6" /></td></tr>
          </table>
        </div>
      </div>

      <!-- 召唤兽控制修炼 -->
      <div class="divGride searchForm">
        <div class="title"><h3>召唤兽控制修炼</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>攻击控制</th><td>≥ <input class="mini" v-model="f.bb_expt_gongji" size="6" /></td>
              <th>防御控制</th><td>≥ <input class="mini" v-model="f.bb_expt_fangyu" size="6" /></td></tr>
            <tr><th>法术控制</th><td>≥ <input class="mini" v-model="f.bb_expt_fashu" size="6" /></td>
              <th>抗法控制</th><td>≥ <input class="mini" v-model="f.bb_expt_kangfa" size="6" /></td></tr>
            <tr><th>宠修总和</th><td>≥ <input class="mini" v-model="f.bb_expt_total" size="6" /></td>
              <th>育兽术</th><td>≥ <input class="mini" v-model="f.skill_drive_pet" size="6" /></td></tr>
          </table>
        </div>
      </div>

      <!-- 角色技能（与藏宝阁 role_skills_panel 一致） -->
      <div class="divGride searchForm">
        <div class="title">
          <span style="float:left"><a href="#" class="fB f14px" @click.prevent="resetRoleSkills">重置</a></span>
          <h3 class="f14px textLeft fB js_form_title" data-title="角色技能">角色技能</h3>
        </div>
        <div class="grideCont">
          <table class="searcTb"><colgroup><col width="100" /><col /></colgroup>
            <tbody>
            <tr><th class="fB js_sub_title" data-title="师门技能">师门技能：</th>
              <td>任意&nbsp;<select v-model="f.school_skill_num" class="sel"><option value="">不限</option><option v-for="n in 7" :key="n" :value="n">{{ n }}</option></select>&nbsp;个技能等级≥&nbsp;<input class="mini" v-model="f.school_skill_level" size="6" />&nbsp;&nbsp;包含符石、法宝影响:
                <label><input type="radio" value="1" v-model="f.original_school_skill" /> 是</label>&nbsp;&nbsp;
                <label><input type="radio" value="0" v-model="f.original_school_skill" /> 否</label>
              </td></tr>
            <tr><th class="fB js_sub_title"></th>
              <td>临时符技能≥<input class="mini" v-model="f.lin_shi_fu" size="6" />&nbsp;&nbsp;乾元丹个数≥<input class="mini" v-model="f.qian_yuan_dan" size="6" />&nbsp;&nbsp;打造熟练度≥<input class="mini" v-model="f.smith_skill" size="6" />&nbsp;&nbsp;裁缝熟练度≥<input class="mini" v-model="f.sew_skill" size="6" /></td></tr>
            <tr><th class="fB js_sub_title" data-title="生活技能">生活技能：</th>
              <td>强身术≥<input class="mini" v-model="f.skill_qiang_shen" size="6" />&nbsp;&nbsp;&nbsp;强壮≥<input class="mini" v-model="f.skill_qiang_zhuang" size="6" />&nbsp;&nbsp;&nbsp;神速≥<input class="mini" v-model="f.skill_shensu" size="6" />&nbsp;&nbsp;&nbsp;冥想≥<input class="mini" v-model="f.skill_ming_xiang" size="6" />&nbsp;&nbsp;&nbsp;暗器技巧≥<input class="mini" v-model="f.skill_anqi" size="6" />
                <br />打造技巧≥<input class="mini" v-model="f.skill_dazao" size="6" />&nbsp;&nbsp;&nbsp;裁缝技巧≥<input class="mini" v-model="f.skill_caifeng" size="6" />&nbsp;&nbsp;&nbsp;巧匠之术≥<input class="mini" v-model="f.skill_qiaojiang" size="6" />&nbsp;&nbsp;&nbsp;炼金术≥<input class="mini" v-model="f.skill_lianjin" size="6" />&nbsp;&nbsp;&nbsp;养生之道≥<input class="mini" v-model="f.skill_yangsheng" size="6" />
                <br />烹饪技巧≥<input class="mini" v-model="f.skill_pengren" size="6" />&nbsp;&nbsp;&nbsp;中药医理≥<input class="mini" v-model="f.skill_zhongyao" size="6" />&nbsp;&nbsp;&nbsp;灵石技巧≥<input class="mini" v-model="f.skill_lingshi" size="6" />&nbsp;&nbsp;&nbsp;健身术≥<input class="mini" v-model="f.skill_jianshen" size="6" />
                <br />逃离技巧≥<input class="mini" v-model="f.skill_taoli" size="6" />&nbsp;&nbsp;&nbsp;追捕技巧≥<input class="mini" v-model="f.skill_zhuibu" size="6" />&nbsp;&nbsp;&nbsp;熔炼技巧≥<input class="mini" v-model="f.skill_ronglian" size="6" />&nbsp;&nbsp;&nbsp;淬灵之术≥<input class="mini" v-model="f.skill_cuiling" size="6" />
                <br />风之感应≥<input class="mini" v-model="f.skill_wind_sense" size="6" />&nbsp;&nbsp;&nbsp;雨之感应≥<input class="mini" v-model="f.skill_rain_sense" size="6" />&nbsp;&nbsp;&nbsp;雪之感应≥<input class="mini" v-model="f.skill_snow_sense" size="6" /></td></tr>
            <tr><th class="fB js_sub_title" data-title="剧情技能">剧情技能：</th>
              <td>丹元济会≥<input class="mini" v-model="f.skill_danyuan" size="6" />&nbsp;&nbsp;&nbsp;变化之术≥<input class="mini" v-model="f.skill_bianhua" size="6" />
                <br />仙灵店铺≥<input class="mini" v-model="f.skill_xianling" size="6" />&nbsp;&nbsp;&nbsp;建筑之术≥<input class="mini" v-model="f.skill_jianzhu" size="6" />&nbsp;&nbsp;&nbsp;妙手空空≥<input class="mini" v-model="f.skill_miaoshou" size="6" />&nbsp;&nbsp;&nbsp;火眼金睛≥<input class="mini" v-model="f.skill_huoyan" size="6" />&nbsp;&nbsp;&nbsp;宝石工艺≥<input class="mini" v-model="f.skill_baoshi" size="6" />&nbsp;&nbsp;&nbsp;奇门遁甲≥<input class="mini" v-model="f.skill_qimen" size="6" />
                <br />古董评估≥<input class="mini" v-model="f.skill_gudong" size="6" />&nbsp;&nbsp;&nbsp;调息≥<input class="mini" v-model="f.skill_tiaoxi" size="6" />&nbsp;&nbsp;&nbsp;打坐≥<input class="mini" v-model="f.skill_dazuo" size="6" />&nbsp;&nbsp;&nbsp;翰墨之道≥<input class="mini" v-model="f.skill_hanmo" size="6" />&nbsp;&nbsp;&nbsp;丹青之道≥<input class="mini" v-model="f.skill_danqing" size="6" /></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 武器 & 项链 -->
      <div class="divGride searchForm">
        <div class="title"><h3>武器 &amp; 项链</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>武器总伤</th><td>≥ <input class="mini" v-model="f.max_weapon_shang_hai" size="6" /></td>
              <th>武器伤害</th><td>≥ <input class="mini" v-model="f.max_weapon_damage" size="6" /></td></tr>
            <tr><th>初伤(含命中)</th><td>≥ <input class="mini" v-model="f.max_weapon_init_damage" size="6" /></td>
              <th>初伤(不含)</th><td>≥ <input class="mini" v-model="f.max_weapon_init_damage_raw" size="6" /></td></tr>
            <tr><th>项链灵力</th><td>≥ <input class="mini" v-model="f.max_necklace_ling_li" size="6" /></td>
              <th>项链初灵</th><td>≥ <input class="mini" v-model="f.max_necklace_init_wakan" size="6" /></td></tr>
          </table>
        </div>
      </div>

      <!-- 装备 -->
      <div class="divGride searchForm">
        <div class="title"><h3>装备</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>装备等级</th><td>
              ≥ <input class="mini" v-model="f.equip_level_min" size="6" /> -
              ≤ <input class="mini" v-model="f.equip_level_max" size="6" />
            </td></tr>
            <tr><th>专用装备等级</th><td>≥ <input class="mini" v-model="f.special_equip_max_level" size="6" placeholder="1" /></td></tr>
            <tr><th>套装数量</th><td>≥ <input class="mini" v-model="f.taozhuang_num" size="6" /></td></tr>
            <tr><th>套装效果</th><td>
              <select v-model="f.taozhuang_type" class="sel"><option value="">不限</option><option v-for="o in TAOZHUANG" :key="o.v" :value="o.v">{{ o.t }}</option></select>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>装备类型</th><td>
              <ul class="btnList yp-range"><li v-for="o in EQUIP_KINDS" :key="o.v" :class="{ on: equipKinds.includes(o.v) }" @click="toggleEquipKinds(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">可多选·code 待校准</span>
            </td></tr>
            <tr><th>特技</th><td>
              <ul class="btnList yp-range"><li v-for="o in TEJI" :key="o.v" :class="{ on: teji.includes(o.v) }" @click="toggleTeji(o.v)"><span>{{ o.t }}</span></li></ul>
              <label class="chk"><input type="checkbox" v-model="tejiMatchAll" /> 满足全部</label>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>特效</th><td>
              <ul class="btnList yp-range"><li v-for="o in TEXIAO" :key="o.v" :class="{ on: texiao.includes(o.v) }" @click="toggleTexiao(o.v)"><span>{{ o.t }}</span></li></ul>
              <label class="chk"><input type="checkbox" v-model="texiaoMatchAll" /> 满足全部</label>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>限量锦衣</th><td>
              <ul class="btnList yp-range"><li v-for="o in LIMIT_CLOTHES" :key="o.v" :class="{ on: limitClothes.includes(o.v) }" @click="toggleLimitClothes(o.v)"><span>{{ o.t }}</span></li></ul>
              <select v-model="limitClothesLogic" class="sel"><option value="any">满足其一</option><option value="all">满足全部</option></select>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
          </table>
        </div>
      </div>

      <!-- 灵饰 -->
      <div class="divGride searchForm">
        <div class="title"><h3>灵饰</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>灵饰等级</th><td>≥ <input class="mini" v-model="f.lingshi_min_level" size="6" /> - ≤ <input class="mini" v-model="f.lingshi_max_level" size="6" /></td></tr>
            <tr><th>灵饰锻造</th><td>≥ <input class="mini" v-model="f.lingshi_min_duanzao_level" size="6" /> - ≤ <input class="mini" v-model="f.lingshi_max_duanzao_level" size="6" /></td></tr>
            <tr><th>灵饰属性</th><td>
              <ul class="btnList yp-range">
                <li v-for="la in LINGSHI_ATTRS" :key="la.k" :class="{ on: lingshiVals[la.k] !== '' && lingshiVals[la.k] != null }" @click="lingshiVals[la.k] = lingshiVals[la.k] ? '' : '0'">
                  <span>{{ la.t }} ≥ <input type="number" v-model="lingshiVals[la.k]" @click.stop style="width:56px" /></span>
                </li>
              </ul>
              <label class="chk"><input type="checkbox" v-model="lingshiMatchAll" /> 满足全部</label>
            </td></tr>
          </table>
        </div>
      </div>

      <!-- 召唤兽 & 召唤兽装备 -->
      <div class="divGride searchForm">
        <div class="title"><h3>召唤兽</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>成品宠数量</th><td>≥ <input class="mini" v-model="f.pet_skill_num" size="6" /></td>
              <th>高级技能数</th><td>≥ <input class="mini" v-model="f.pet_advance_skill_num" size="6" /></td></tr>
            <tr><th>召唤兽类型</th><td colspan="3">
              <ul class="btnList yp-range"><li v-for="o in PET_TYPES" :key="o.v" :class="{ on: petTypes.includes(o.v) }" @click="togglePetTypes(o.v)"><span>{{ o.t }}</span></li></ul>
              <label class="chk"><input type="checkbox" v-model="petMatchAll" /> 满足全部</label>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>召唤兽装备</th><td colspan="3">
              <ul class="btnList yp-range"><li v-for="o in WIDGETS" :key="o.v" :class="{ on: widgets.includes(o.v) }" @click="toggleWidgets(o.v)"><span>{{ o.t }}</span></li></ul>
              <label class="chk"><input type="checkbox" v-model="widgetMatchAll" /> 满足全部</label>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
          </table>
        </div>
      </div>

      <!-- 神器 -->
      <div class="divGride searchForm">
        <div class="title"><h3>神器</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>神器等级</th><td>≥ <input class="mini" v-model="f.shenqi_level" size="6" placeholder="0" />
              <span class="muted" style="margin-left:8px;font-size:12px">简化字段·code 待校准</span></td></tr>
          </table>
        </div>
      </div>

      <!-- 法宝 -->
      <div class="divGride searchForm">
        <div class="title"><h3>法宝</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>总法宝数</th><td>≥ <input class="mini" v-model="f.fabao_total_cnt" size="6" /></td>
              <th>4级法宝</th><td>≥ <input class="mini" v-model="f.fabao_lv4_cnt" size="6" /></td></tr>
            <tr><th>3级法宝</th><td>≥ <input class="mini" v-model="f.fabao_lv3_cnt" size="6" /></td>
              <th>2级法宝</th><td>≥ <input class="mini" v-model="f.fabao_lv2_cnt" size="6" /></td></tr>
            <tr><th>1级法宝</th><td colspan="3">≥ <input class="mini" v-model="f.fabao_lv1_cnt" size="6" /></td></tr>
          </table>
        </div>
      </div>

      <!-- 进阶坐骑 -->
      <div class="divGride searchForm">
        <div class="title"><h3>进阶坐骑</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>等级</th><td>≥ <input class="mini" v-model="f.jinjie_rider_level" size="6" /></td>
              <th>成长</th><td>≥ <input class="mini" v-model="f.jinjie_rider_growth" size="6" step="0.0001" /></td></tr>
            <tr><th>统驭</th><td>≥ <input class="mini" v-model="f.jinjie_rider_tongyu" size="6" /></td>
              <th>技能数</th><td>≥ <input class="mini" v-model="f.jinjie_rider_skill_level_count" size="6" /></td></tr>
            <tr><th>玄灵珠等级</th><td>≥ <input class="mini" v-model="f.xuan_ling_zhu_level" size="6" /></td>
              <th>方案逻辑</th><td>
                <select v-model="f.jinjie_rider_scheme_logic" class="sel"><option value="">不限</option><option value="all">全部满足</option><option value="any">任一满足</option></select>
              </td></tr>
            <tr><th>使用方案%</th><td colspan="3"><label class="chk"><input type="checkbox" v-model="f.jinjie_rider_scheme_use_pct" /> 启用</label></td></tr>
          </table>
        </div>
      </div>

      <!-- 孩子 -->
      <div class="divGride searchForm">
        <div class="title"><h3>孩子</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>技能数</th><td>≥ <input class="mini" v-model="f.child_skill_num_min" size="6" /> - ≤ <input class="mini" v-model="f.child_skill_num_max" size="6" /></td></tr>
            <tr><th>孩子结局</th><td>
              <ul class="btnList yp-range"><li v-for="o in CHILD_ENDINGS" :key="o.v" :class="{ on: childEndings.includes(o.v) }" @click="toggleChildEndings(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">可多选·code 待校准</span>
            </td></tr>
            <tr><th>孩子门派</th><td>
              <ul class="btnList yp-range"><li v-for="o in CHILD_SCHOOLS" :key="o.v" :class="{ on: childSchools.includes(o.v) }" @click="toggleChildSchools(o.v)"><span>{{ o.t }}</span></li></ul>
              <span class="muted" style="margin-left:8px;font-size:12px">可多选·code 待校准</span>
            </td></tr>
          </table>
        </div>
      </div>

      <!-- 祥瑞 & 施法特效 -->
      <div class="divGride searchForm">
        <div class="title"><h3>祥瑞 &amp; 施法特效</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>祥瑞</th><td>
              <ul class="btnList yp-range"><li v-for="o in XIANG_RUI" :key="o.v" :class="{ on: xiangrui.includes(o.v) }" @click="toggleXiangrui(o.v)"><span>{{ o.t }}</span></li></ul>
              <label class="chk"><input type="checkbox" v-model="xiangruiMatchAll" /> 满足全部</label>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
            <tr><th>施法特效</th><td>
              <ul class="btnList yp-range"><li v-for="o in PERFORM_EFFECTS" :key="o.v" :class="{ on: performEffects.includes(o.v) }" @click="togglePerform(o.v)"><span>{{ o.t }}</span></li></ul>
              <label class="chk"><input type="checkbox" v-model="performMatchAll" /> 满足全部</label>
              <span class="muted" style="margin-left:8px;font-size:12px">code 待校准</span>
            </td></tr>
          </table>
        </div>
      </div>

      <!-- 其他 -->
      <div class="divGride searchForm">
        <div class="title"><h3>其他条件</h3></div>
        <div class="grideCont">
          <table class="searcTb"><col width="120" /><col />
            <tr><th>成就</th><td>≥ <input class="mini" v-model="f.cheng_jiu" size="6" /></td>
              <th>仙玉</th><td>≥ <input class="mini" v-model="f.xian_yu" size="6" /></td></tr>
            <tr><th>金钱</th><td>≥ <input class="mini" v-model="f.cash" size="6" /></td>
              <th>剩余灵佑</th><td>≥ <input class="mini" v-model="f.sheng_yu_ling_you" size="6" /></td></tr>
            <tr><th>婚否</th><td>
              <select v-model="f.is_married" class="sel"><option value="">不限</option><option value="1">已婚</option><option value="0">未婚</option></select>
            </td>
              <th>同袍</th><td>
                <select v-model="f.is_tongpao" class="sel"><option value="">不限</option><option value="1">是</option><option value="0">否</option></select>
              </td></tr>
          </table>
        </div>
      </div>

      <div class="role-foot">
        <button class="btn btn-blue" @click="doSearch">去搜索 ↗</button>
        <button class="btn" @click="clearRoleConditions">清空条件</button>
        <span class="muted">搜索条件自动保存到浏览器，下次打开还在。</span>
      </div>
    </div>

    <!-- 角色订阅 -->
    <div class="card card-sub role-sub">
      <h2>⏰ 角色自动采集订阅</h2>
      <p class="muted">
        把上方「去搜角色」的<strong>当前服务器 + 筛选条件</strong>存成订阅。浏览器开着且已登录藏宝阁时，
        扩展会按频率自动打开藏宝阁搜索页采集。<br />
        <strong>注意：扩展端对「角色结果页」的自动解析尚未接通，现在保存的订阅只能手动去搜；接通后即为自动。</strong>
      </p>
      <div class="sub-form">
        <input v-model="roleSubForm.name" class="sub-input" placeholder="订阅名称（如：高修高宠角色）" />
        <input v-model="roleSubForm.label" class="sub-input" placeholder="藏品标签（留空用订阅名）" />
        <select v-model="roleSubForm.interval_minutes" class="sub-select" title="采集频率">
          <option :value="15">每 15 分钟</option>
          <option :value="30">每 30 分钟</option>
          <option :value="60">每 1 小时</option>
          <option :value="120">每 2 小时</option>
          <option :value="360">每 6 小时</option>
        </select>
        <button class="btn btn-blue" @click="saveRoleSub">保存为订阅</button>
      </div>
      <p v-if="roleSubMsg" class="muted" style="color:#e0a85a">{{ roleSubMsg }}</p>
      <div v-if="roleSubs.length" class="sub-list">
        <div v-for="s in roleSubs" :key="s.id" class="sub-item" :class="{ off: !s.enabled }">
          <div class="sub-main">
            <div class="sub-title">
              <span class="sub-name">{{ s.name }}</span>
              <span class="sub-pill" :class="s.enabled ? 'on' : 'off'">{{ s.enabled ? '启用中' : '已暂停' }}</span>
            </div>
            <div class="sub-meta">
              <span>🖥 {{ s.server_name || s.server_id || '-' }}</span>
              <span>🏷 {{ s.label || '-' }}</span>
              <span>⏱ 每 {{ s.interval_minutes || 60 }} 分钟</span>
            </div>
            <div v-if="parseRoleConditions(s).length" class="sub-meta sub-cond">
              <span v-for="c in parseRoleConditions(s)" :key="c" class="cond-tag">{{ c }}</span>
            </div>
            <div class="sub-meta">
              <span>下次：{{ fmtTime(s.next_run) }} <em :class="s.next_run && Math.floor(s.next_run - Date.now()/1000) <= 0 ? 'sub-due' : 'sub-wait'">{{ subNextText(s) }}</em></span>
              <span>上次：{{ s.last_run ? fmtTime(s.last_run) : '从未' }}</span>
            </div>
            <div v-if="s.last_result" class="sub-meta"><span :style="s.last_result.indexOf('失败') >= 0 ? 'color:#e05555' : 'color:#4caf50'">{{ s.last_result }}</span></div>
          </div>
          <div class="sub-ops">
            <label class="switch" title="启用 / 暂停"><input type="checkbox" :checked="s.enabled" @change="toggleRoleSub(s)" /><span class="slider"></span></label>
            <button class="btn-mini" @click="runRoleSub(s.id)" :disabled="roleSubLoading === s.id">
              {{ roleSubLoading === s.id ? '采集中…' : '立即采集' }}
            </button>
            <button class="btn-mini btn-del" @click="delRoleSub(s.id)" :disabled="roleSubLoading === s.id">删除</button>
          </div>
        </div>
      </div>
      <p v-else class="muted">暂无角色订阅。选好服务器与条件后点「保存为订阅」即可。</p>
    </div>
  <!-- 角色藏品库 -->
    <div class="card card-sub role-collection">
      <h2>📦 已采集角色</h2>
      <div class="filter-grid">
        <input v-model="roleServer" placeholder="服务器（模糊）" />
        <input v-model="roleKw" placeholder="名称/门派/亮点关键字" />
        <input v-model="roleMinPrice" placeholder="最低价" type="number" />
        <input v-model="roleMaxPrice" placeholder="最高价" type="number" />
        <select v-model="roleSort">
          <option value="time_desc">最近采集</option>
          <option value="price_asc">价格升序</option>
          <option value="price_desc">价格降序</option>
        </select>
        <select v-model="roleStatusFilter" title="按在售状态筛选">
          <option value="">全部状态</option>
          <option value="在售">在售</option>
          <option value="已售">已售</option>
          <option value="已下架">已下架</option>
        </select>
        <select v-model="roleAgeFilter" title="按服务器开服时间筛选">
          <option value="">全部服龄</option>
          <option value="old">3年以上服</option>
          <option value="mid">1-3年服</option>
          <option value="new">1年内服</option>
        </select>
        <button class="btn" @click="resetRoleFilters">重置</button>
      </div>
      <p class="count">共 {{ filteredRoleItems.length }} 件</p>
      <div v-if="roleItems.length" style="margin: 8px 0 4px">
        <button class="btn-mini btn-del" @click="clearAllRoleItems">清空全部角色（{{ roleItems.length }}）</button>
      </div>
      <p class="muted">
        在藏宝阁「角色搜索结果页」点浏览器扩展的「采集本页全部物品」即可把角色入库。
        数据源自 <code>other_info</code> JSON，包含门派/等级/修炼/亮点等。
      </p>
      <div v-if="roleLoading" class="muted">加载中…</div>
      <table v-else-if="filteredRoleItems.length" class="role-table">
        <thead>
          <tr>
            <th>头像</th>
            <th>门派</th><th class="sortable" @click="sortByGrade" title="点击按等级排序">等级 <span class="sort-ind">{{ gradeSortInd }}</span></th><th>攻修</th><th>防修</th><th>法修</th><th>抗法</th>
            <th>攻控</th><th>防控</th><th>法控</th><th>法抗控</th>
            <th>亮点</th><th class="sortable" @click="sortByPrice" title="点击按价格排序">挂牌价 <span class="sort-ind">{{ priceSortInd }}</span></th><th>估价</th><th>服务器</th><th>状态</th><th>采集时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in filteredRoleItems" :key="it.eid"
            :class="{ clickable: !!it.detail_url }"
            :title="it.detail_url ? '点击直达藏宝阁详情' : ''"
            @click="openCbg(it)"
          >
            <td><img v-if="roleThumb(it)" :src="roleThumb(it)" class="role-thumb" alt="" /><span v-else class="muted">—</span></td>
            <td>{{ parseRoleAttrsJson(it)['门派'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['等级'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['攻修'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['防修'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['法修'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['抗法'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['攻击控制'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['防御控制'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['法术控制'] || '—' }}</td>
            <td>{{ parseRoleAttrsJson(it)['法抗控制'] || '—' }}</td>
            <td class="hl">{{ parseRoleAttrsJson(it)['亮点'] || '—' }}</td>
            <td class="price">{{ fmtPrice(it.price) }}</td>
            <td class="price" :class="estPriceClass(it)">{{ fmtEstPrice(it) }}</td>
            <td>
              <div class="server-cell">
                <span>{{ serverLabelById(it.server_id) || it.server_name || '—' }}</span>
                <span v-if="serverAgeLabel(it.server_id)" class="age-badge" :class="serverAgeClass(it.server_id)">{{ serverAgeLabel(it.server_id) }}</span>
              </div>
            </td>
            <td :class="it.status === '已售' ? 'sold' : ''">{{ it.status || '在售' }}</td>
            <td class="time">{{ fmtItemTime(it.captured_at) }}</td>
            <td><button class="btn-mini btn-del" @click="delRoleItem(it.eid)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="roleItems.length" class="muted">没有符合筛选条件的角色，点「重置」试试。</p>
      <p v-else class="muted">暂无已采集的角色。去藏宝阁搜索角色后点扩展「采集本页全部物品」即可入库。</p>
    </div>
  </div>
</template>

<style scoped>
.role-search { width: 100%; }
.role-head { display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 14px 16px; background: linear-gradient(135deg, #1b3a6b, #16335f); border: 1px solid var(--border-color); border-radius: 12px 12px 0 0; }
.role-head h2 { font-size: 16px; margin: 0; color: #eaf1ff; }
.role-head-right { display: flex; align-items: center; gap: 12px; }
.role-toggle { font-size: 12px; color: #9fb6dd; }
.role-body { border: 1px solid var(--border-color); border-top: none; border-radius: 0 0 12px 12px; padding: 0 16px; max-height: 0; overflow: hidden; transition: max-height 0.2s ease, padding 0.2s ease; }
.role-body.open { max-height: 8000px; padding: 14px 16px 18px; }
.role-intro { margin: 0 0 14px; }
.role-intro code { background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.role-foot { display: flex; align-items: center; gap: 14px; margin-top: 16px; }
.btn-blue { background: #2f6fd6; color: #fff; border: none; border-radius: 8px; padding: 10px 26px; font-size: 14px; cursor: pointer; }
.btn-blue:hover { filter: brightness(1.08); }
.btn-blue.btn-sm { padding: 6px 14px; font-size: 13px; }
.btn { background: var(--bg-card); color: var(--color-text); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 20px; font-size: 14px; cursor: pointer; }
.btn:hover { border-color: var(--border-strong); }
.role-sub { margin-top: 18px; border-radius: 12px; }
.muted { color: var(--color-text-muted); font-size: 12px; line-height: 1.5; }

/* ===== 复用藏品库分组块样式（自包含，避免依赖父组件 scoped） ===== */
.divGride { padding: 1px; border: 1px solid var(--border-color); background-color: rgba(255,255,255,0.015); margin-bottom: 9px; border-radius: 3px; }
.divGride .title { padding: 6px 12px; background-color: rgba(34,211,238,0.08); text-align: center; border-bottom: 1px solid var(--border-color); }
.divGride .title h3 { margin: 0; font-size: 13px; font-weight: 700; color: var(--color-primary); letter-spacing: 0.5px; }
.divGride.searchForm { margin-bottom: 12px; }
.grideCont { padding: 8px 12px; }
.searcTb { width: 100%; border-collapse: collapse; }
.searcTb th { white-space: nowrap; font-weight: 700; text-align: right; line-height: 28px; vertical-align: top; padding: 0 12px 0 0; width: 128px; color: var(--color-text); font-size: 14px; }
.searcTb td { font-size: 14px; padding: 8px 0; border-bottom: 1px dotted var(--border-color); text-align: left; vertical-align: top; color: var(--color-text); }
.searcTb tr:last-child td { border-bottom: none; }
.searcTb tr:nth-child(even) td { background: rgba(255,255,255,0.025); }
.searcTb select { height: 26px; line-height: 26px; vertical-align: middle; border: 1px solid var(--border-color); border-radius: 3px; padding: 0 4px; background: var(--bg-input); color: var(--color-text); }
.searcTb .mini { width: 48px; height: 26px; border: 1px solid var(--border-color); border-radius: 3px; padding: 0 4px; vertical-align: middle; background: var(--bg-input); color: var(--color-text); transition: border-color 0.12s, box-shadow 0.12s; }
.searcTb .mini:hover, .searcTb select:hover { border-color: var(--border-strong); }
.searcTb .mini:focus, .searcTb select:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(34,211,238,0.18); }
.chk { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; cursor: pointer; margin-left: 10px; color: var(--color-text); }
.seg { padding: 6px 14px; border: 1px solid var(--border-color); border-radius: 16px; background: rgba(255,255,255,0.04); cursor: pointer; font-size: 13px; color: var(--color-text-secondary, rgba(190,200,215,0.9)); transition: 0.08s linear; }
.seg:hover { color: var(--color-text); border-color: var(--border-strong); }
.seg.on { background: rgba(34,211,238,0.12); color: var(--color-primary); border-color: var(--color-primary); font-weight: 600; }
.btnList { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.btnList li { cursor: pointer; padding: 5px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: rgba(255,255,255,0.04); font-size: 13px; line-height: 1.6; color: var(--color-text-secondary, rgba(190,200,215,0.9)); transition: 0.08s linear; }
.btnList li:hover { border-color: var(--border-strong); color: var(--color-text); }
.btnList li.on { background: rgba(34,211,238,0.12); color: var(--color-primary); border-color: var(--color-primary); font-weight: 600; }

/* ===== 订阅卡片样式（自包含） ===== */
.card-sub { border-color: rgba(34,211,238,0.25); background: linear-gradient(180deg, rgba(34,211,238,0.04), rgba(34,211,238,0.01)); }
.card-sub h2 { color: var(--color-primary); margin: 0 0 4px; }
.sub-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
.sub-input { flex: 1 1 220px; min-width: 180px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 13px; }
.sub-input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(34,211,238,0.12); }
.sub-select { padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-input); color: var(--color-text); font-size: 13px; }
.sub-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.sub-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); }
.sub-item.off { opacity: 0.6; }
.sub-main { min-width: 0; }
.sub-title { display: flex; align-items: center; gap: 8px; }
.sub-name { font-weight: 700; font-size: 15px; color: var(--color-text); }
.sub-pill { font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.sub-pill.on { background: rgba(52,211,153,0.12); color: var(--color-success); border: 1px solid rgba(52,211,153,0.3); }
.sub-pill.off { background: rgba(255,255,255,0.04); color: var(--color-text-muted); border: 1px solid var(--border-color); }
.sub-meta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 4px; font-size: 12px; color: var(--color-text-muted); }
.sub-meta em { font-style: normal; margin-left: 4px; }
.sub-cond { gap: 6px; margin-top: 6px; }
.cond-tag { background: rgba(47, 111, 214, 0.15); border: 1px solid rgba(47, 111, 214, 0.35); color: #7fb0ff; border-radius: 4px; padding: 1px 8px; font-size: 12px; }
.sub-due { color: var(--color-accent); font-weight: 700; }
.sub-wait { color: var(--color-primary); }
.sub-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.btn-mini { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg-card); color: var(--color-text); }
.btn-mini:hover { border-color: var(--border-strong); }
.btn-del { color: var(--color-danger); border-color: rgba(244,63,94,0.3); }
.btn-del:hover { border-color: var(--color-danger); box-shadow: 0 0 12px rgba(244,63,94,0.2); }
/* 启用/暂停 开关 */
.switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background: var(--border-strong); border-radius: 22px; transition: 0.15s; }
.slider::before { content: ""; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.15s; }
.switch input:checked + .slider { background: var(--color-success); }
.switch input:checked + .slider::before { transform: translateX(18px); }

/* ===== 角色藏品表格 ===== */
.role-collection { margin-top: 18px; border-radius: 12px; }
.role-collection h2 { color: var(--color-primary); margin: 0 0 4px; }
.role-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
.role-table th, .role-table td { padding: 8px 10px; border: 1px solid var(--border-color); text-align: center; white-space: nowrap; }
.role-table th { background: rgba(34,211,238,0.08); font-weight: 700; color: var(--color-primary); }
.role-table th.sortable { cursor: pointer; user-select: none; transition: background .15s; }
.role-table th.sortable:hover { background: rgba(34,211,238,0.18); }
.role-table th .sort-ind { font-size: 11px; color: var(--color-accent); margin-left: 2px; }
.role-table tr:nth-child(even) td { background: rgba(255,255,255,0.025); }
.role-table tr:hover td { background: rgba(34,211,238,0.06); }
.role-table .hl { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--color-accent); }
.role-table td.time { color: var(--color-text-muted); white-space: nowrap; font-size: 12px; }
.role-table .price { font-size: 16px; font-weight: 700; color: var(--color-accent); }
.role-table .est-good { color: #22c55e; }
.role-table .est-bad { color: #ef4444; }
.btn-est { background: rgba(34,211,238,0.12); color: var(--color-primary); border: 1px solid var(--color-primary); padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; }
.btn-est:hover { background: rgba(34,211,238,0.2); }
.btn-est:disabled { opacity: 0.5; cursor: default; }
.role-table .sold { color: var(--color-text-muted); }
.role-table tr.clickable { cursor: pointer; }
.role-table tr.clickable:hover td { background: rgba(34,211,238,0.12); }
.role-thumb { width: 40px; height: 40px; border-radius: 4px; object-fit: cover; }

/* ===== 角色藏品库筛选栏（与玉魄 filter-grid 一致） ===== */
.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin: 10px 0 4px;
}
.filter-grid input, .filter-grid select {
  padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;
  background: var(--bg-input); color: var(--color-text);
}
.filter-grid input:focus, .filter-grid select:focus {
  outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.12);
}
.filter-grid .btn { padding: 8px 14px; font-size: 13px; }
.count { font-size: 12px; color: var(--color-text-muted); margin: 6px 0 0; }
.server-cell { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.age-badge { font-size: 11px; padding: 1px 6px; border-radius: 99px; line-height: 1.4; }
.age-old { color: #8fb4ff; border: 1px solid rgba(143,180,255,.4); }
.age-mid { color: #c9b8ff; border: 1px solid rgba(201,184,255,.4); }
.age-new { color: #ffd27a; border: 1px solid rgba(255,210,122,.4); }
</style>
