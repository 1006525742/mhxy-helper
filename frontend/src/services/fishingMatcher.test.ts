// 直接用 Node 跑：node --experimental-strip-types fishingMatcher.test.ts
import { readFileSync } from 'node:fs'
import { FishingMatcher, normalize, similarity, lineMatch, isRoundEnd, type FishingRulesFile } from './fishingMatcher.ts'

const data = JSON.parse(readFileSync(new URL('../data/fishingRules.json', import.meta.url), 'utf8')) as FishingRulesFile
const m = new FishingMatcher()
m.load(data)

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name} ${extra}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

console.log('\n=== 1. 归一化 & 相似度 ===')
check('好像→好象', normalize('水面上好像有动静') === '水面上好象有动静')
check('竿→杆', normalize('鱼竿开始下弯') === '鱼杆开始下弯')
check('上下起浮 与 上起下浮 不再互通', normalize('鱼漂上下起浮') !== normalize('鱼漂上起下浮'))
check('相似度: 同串=1', similarity('鱼漂微微动了一下', '鱼漂微微动了一下') === 1)
check('相似度: OCR 小错仍高', similarity('鱼漂突然沉了下', '鱼漂突然沉了下去') >= 0.7)

console.log('\n=== 2. 单行模糊匹配（阈值 0.72）===')
check('子串命中', lineMatch('xxx鱼漂微微动了一下yyy', '鱼漂微微动了一下'))
check('OCR 缺字仍命中', lineMatch('鱼漂微微动了', '鱼漂微微动了一下'))

console.log('\n=== 3. 沙丁鱼(傲来国) 逐步喂入，观察槽位锁定 ===')
const sha = ['好象有鱼出现了', '鱼漂微微动了一下', '水面微波荡漾', '鱼钩好象碰到了什么', '鱼竿开始下弯']
const m1 = new FishingMatcher(); m1.load(data)
for (let i = 1; i <= sha.length; i++) {
  const r = m1.feed('傲来国', [sha[i - 1]])
  const lock = Object.entries(r.lockedSlots).map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(`  第${i}步 锁定[${lock || '无'}] best=${r.best?.fish ?? '-'} determined=${r.determined}`)
}
const rSha = m1.feed('傲来国', []) // 再分析一次
check('沙丁鱼 终局唯一确定', rSha.determined && rSha.best?.fish === '沙丁鱼', `best=${rSha.best?.fish}`)
check('沙丁鱼 三槽全锁=小力/直竿/快速', rSha.lockedSlots['力度'] === '小力' && rSha.lockedSlots['角度'] === '直竿' && rSha.lockedSlots['速度'] === '快速')

console.log('\n=== 4. 海星(傲来国) 首事件过于常见，不应早期锁定 ===')
const m2 = new FishingMatcher(); m2.load(data)
const rHai1 = m2.feed('傲来国', ['鱼钩好象被什么咬住了'])
console.log('  首事件后锁定:', JSON.stringify(rHai1.lockedSlots), '候选数=', rHai1.candidates.length)
check('海星首事件未提前锁定(该事件在多条鱼中为中间事件)', Object.keys(rHai1.lockedSlots).length === 0)
check('海星首事件仍在候选', rHai1.candidates.some((c) => c.fish === '海星'))
const hai = ['鱼钩好象被什么咬住了', '水面溅起浪花', '鱼竿开始晃动', '鱼漂上下起浮', '鱼竿开始下弯']
const m2b = new FishingMatcher(); m2b.load(data)
for (const e of hai) m2b.feed('傲来国', [e])
const rHai = m2b.analyze('傲来国')
check('海星 终局唯一确定', rHai.determined && rHai.best?.fish === '海星')

console.log('\n=== 5. 珍品B(傲来国) 多值 action 展平 ===')
const m3 = new FishingMatcher(); m3.load(data)
m3.feed('傲来国', ['鱼竿突然发出了奇异的亮光'])
const rRare = m3.analyze('傲来国')
const rareB = rRare.candidates.find((c) => c.fish === '随机2-3级鱼(珍品B)')
check('珍品B 角度展平为 直竿/斜竿', rareB?.action[1] === '直竿/斜竿', `got=${rareB?.action[1]}`)
check('珍品B 首事件锁定 力度=大力', rRare.lockedSlots['力度'] === '大力')
check('珍品B 首事件锁定 速度=迂回', rRare.lockedSlots['速度'] === '迂回')

console.log('\n=== 6. 事件去重（刷屏不重复累积）===')
const m4 = new FishingMatcher(); m4.load(data)
m4.feed('傲来国', ['好象有鱼出现了'])
m4.feed('傲来国', ['好象有鱼出现了']) // 重复
m4.feed('傲来国', ['好象有鱼出现了']) // 重复（OCR 轻微抖动）
check('重复行只保留 1 条', m4.getObserved('傲来国').length === 1, `len=${m4.getObserved('傲来国').length}`)
m4.feed('傲来国', ['鱼漂微微动了一下'])
check('不同行正常追加', m4.getObserved('傲来国').length === 2)

console.log('\n=== 7. 回合结束检测 ===')
check('脱钩 → 结束', isRoundEnd('鱼儿脱钩了'))
check('很遗憾 → 结束', isRoundEnd('很遗撼，鱼儿跑掉了'))
check('收获 → 结束', isRoundEnd('收获了一条鱼'))
check('普通事件 → 未结束', !isRoundEnd('鱼漂微微动了一下'))

console.log('\n=== 8. 复现槽位锁定统计（傲来国 逐事件）===')
const rules = data.places['傲来国']
for (let k = 1; k <= 5; k++) {
  let lockCount: Record<string, number> = { 力度: 0, 角度: 0, 速度: 0 }
  let detCount = 0
  for (const rule of rules) {
    const mm = new FishingMatcher(); mm.load(data)
    mm.feed('傲来国', rule.events.slice(0, k))
    const res = mm.analyze('傲来国')
    for (const s of ['力度', '角度', '速度']) if (res.lockedSlots[s as '力度']) lockCount[s]++
    if (res.determined) detCount++
  }
  console.log(`  前${k}步: 力度锁 ${lockCount['力度']}/${rules.length}  角度锁 ${lockCount['角度']}/${rules.length}  速度锁 ${lockCount['速度']}/${rules.length}  鱼种唯一 ${detCount}/${rules.length}`)
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
