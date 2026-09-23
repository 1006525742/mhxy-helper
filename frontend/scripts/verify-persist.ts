// 页面级输入持久化（localStorage）回归验证
// 运行：cd frontend && ./node_modules/.bin/esbuild scripts/verify-persist.ts --bundle --platform=node --format=esm --outfile=/tmp/verify-persist.mjs && node /tmp/verify-persist.mjs
// 目的：CalcView / AnimalSetView / FixedDamageView / FdWeaponView / SpeedChaosView
//       用同一套 calcPersist 工具做持久化，这里验证 load/watch/remove 往返正确。

// ===== 内存版 localStorage（node 环境没有浏览器 API）=====
const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => {
    mem.set(k, v)
  },
  removeItem: (k: string) => {
    mem.delete(k)
  },
  clear: () => mem.clear(),
}

import { ref, nextTick } from 'vue'
import { loadPersist, removePersist, watchPersist } from '../src/calculators/services/calcPersist'

let pass = 0
let fail = 0
function assert(name: string, ok: boolean, got?: unknown, want?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  }
}

// watchPersist 有 250ms 防抖，等待落盘
const settle = async () => {
  await nextTick()
  await new Promise((r) => setTimeout(r, 320))
}

async function main() {
  console.log('=== 持久化工具基础往返 ===')

  // 1. 无存档 → null
  assert('loadPersist 无存档返回 null', loadPersist('nope_key') === null, loadPersist('nope_key'), null)

  // 2. 首次注册不落盘（未改过的值不写，避免为每个页面存一堆等于默认值的存档）
  interface Simple {
    matPrice: number
  }
  const price = ref(10)
  watchPersist('t_simple', [price], () => ({ matPrice: price.value }))
  await settle()
  assert('未变更 → 不写存档', loadPersist<Simple>('t_simple') === null, loadPersist('t_simple'), null)

  // 3. 用户改动 → 触发落盘
  price.value = 10.5
  await settle()
  const s3 = loadPersist<Simple>('t_simple')
  assert('改值后落盘 matPrice=10.5', s3?.matPrice === 10.5, s3?.matPrice, 10.5)

  // 4. 恢复到默认值场景（等价 clearSave 后再次写入）
  removePersist('t_simple')
  assert('removePersist 后读不到', loadPersist('t_simple') === null, loadPersist('t_simple'), null)
  price.value = 7
  await settle()
  assert('remove 后再次写入生效', loadPersist<Simple>('t_simple')?.matPrice === 7, loadPersist<Simple>('t_simple')?.matPrice, 7)

  // 5. version 不符 → 丢弃旧存档（结构变更保护）
  mem.set('t_old', JSON.stringify({ version: 999, matPrice: 123 }))
  assert('version 不匹配 → 返回 null', loadPersist<Simple>('t_old') === null, loadPersist('t_old'), null)

  // 6. 脏 JSON → 不抛异常
  mem.set('t_bad', '{not json')
  let threw = false
  try {
    loadPersist('t_bad')
  } catch {
    threw = true
  }
  assert('损坏 JSON 不抛异常', !threw && loadPersist('t_bad') === null, loadPersist('t_bad'), null)

  // ===== 7. 对象/数组 deep 监听（FdWeaponView 武器列表）=====
  console.log('=== 数组 deep 监听（固伤武器列表）===')
  interface Weapon {
    damage: number
    agility: number
    price: number
  }
  interface FwSave {
    sectId: string
    weapons: Weapon[]
  }
  const sectId = ref('wdd')
  const weapons = ref<Weapon[]>([{ damage: 490, agility: 0, price: 10 }])
  watchPersist('t_weapons', [sectId, weapons], () => ({
    sectId: sectId.value,
    weapons: weapons.value,
  }))
  await settle()
  // deep：直接改数组元素内部字段（视图里 v-model.number="w.damage" 就是这么改的）
  weapons.value[0].damage = 500
  await settle()
  const w7 = loadPersist<FwSave>('t_weapons')
  assert('数组内部字段变更被捕获 (damage=500)', w7?.weapons?.[0]?.damage === 500, w7?.weapons?.[0]?.damage, 500)
  // 增删武器
  weapons.value.push({ damage: 467, agility: 19, price: 333 })
  await settle()
  const w8 = loadPersist<FwSave>('t_weapons')
  assert('新增武器后落盘 2 条', w8?.weapons?.length === 2, w8?.weapons?.length, 2)
  weapons.value.splice(0, 1)
  await settle()
  const w9 = loadPersist<FwSave>('t_weapons')
  assert('删除武器后落盘 1 条', w9?.weapons?.length === 1, w9?.weapons?.length, 1)
  assert('剩余武器为第二条 (damage=467)', w9?.weapons?.[0]?.damage === 467, w9?.weapons?.[0]?.damage, 467)

  // ===== 8. 布尔 false 必须被保留（SpeedChaosView 天阵开关）=====
  console.log('=== 布尔 false 保留（乱敏天阵开关）===')
  const tianArray = ref(true)
  watchPersist('t_tian', [tianArray], () => ({ tianArray: tianArray.value }))
  tianArray.value = false
  await settle()
  const t8 = loadPersist<{ tianArray: boolean }>('t_tian')
  assert('false 不被 ?? 默认值吞掉', t8?.tianArray === false, t8?.tianArray, false)

  // ===== 9. 动态 key（CalcView 按计算器 id 隔离）=====
  console.log('=== 动态 key（各计算器 id 隔离）===')
  const curId = ref('')
  const matPrice = ref(0)
  watchPersist(
    () => (curId.value ? `t_calc_${curId.value}` : ''),
    [() => curId.value, matPrice],
    () => ({ matPrice: matPrice.value }),
  )
  // 用户进钟灵石页把单价从默认 5 改成 10
  curId.value = 'spirit'
  matPrice.value = 10
  await settle()
  assert('钟灵石存档 matPrice=10', loadPersist<Simple>('t_calc_spirit')?.matPrice === 10, loadPersist<Simple>('t_calc_spirit')?.matPrice, 10)
  // 切到宝石：应写 gem 而不是覆盖 spirit
  curId.value = 'gem'
  matPrice.value = 22
  await settle()
  const gem = loadPersist<Simple>('t_calc_gem')
  const spirit = loadPersist<Simple>('t_calc_spirit')
  assert('切到宝石后写入 t_calc_gem=22', gem?.matPrice === 22, gem?.matPrice, 22)
  assert('钟灵石存档保持 10 未被污染', spirit?.matPrice === 10, spirit?.matPrice, 10)

  // ===== 10. key 返回空串 → 跳过写入（CalcView 未找到计算器时）=====
  const emptyId = ref('')
  watchPersist(
    () => (emptyId.value ? `t_e_${emptyId.value}` : ''),
    [() => emptyId.value, matPrice],
    () => ({ matPrice: matPrice.value }),
  )
  mem.clear()
  await settle()
  assert('key 为空串时不写入任何存档', mem.size === 0, mem.size, 0)

  console.log('')
  console.log(fail === 0 ? `ALL PASS (${pass} 条)` : `FAILED: ${fail} 条失败 / 共 ${pass + fail} 条`)
  if (fail > 0) process.exit(1)
}

main()
