#!/usr/bin/env node
/**
 * 跑商助手 · 商品图标缺失检查
 *
 * 用法：node scripts/check-paoshang-icons.mjs
 *
 * 检查 public/static/icons/paoshang/ 下是否存在 20 个商品的图片，
 * 输出缺失清单，方便逐个补图。
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'public/static/icons/paoshang')

const GOODS = [
  ['棉布', '长安'], ['佛珠', '长安'], ['纸扇', '长安'], ['武器', '长安'],
  ['木材', '长寿'], ['面粉', '长寿'], ['鹿茸', '长寿'], ['符', '长寿'],
  ['珍珠', '地府'], ['首饰', '地府'], ['纸钱', '地府'], ['夜明珠', '地府'],
  ['衣甲', '北俱'], ['人参', '北俱'], ['香油', '北俱'], ['铜铃', '北俱'],
  ['盐', '傲来'], ['布帽', '傲来'], ['酒', '傲来'], ['蜡烛', '傲来']
]

const EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

if (!existsSync(dir)) {
  console.log(`目录不存在：${dir}`)
  console.log('请先创建 public/static/icons/paoshang/')
  process.exit(0)
}

const files = readdirSync(dir)
const lower = new Set(files.map(f => f.toLowerCase()))

const missing = []
for (const [name, addr] of GOODS) {
  const hit = EXTS.some(ext => lower.has((name + ext).toLowerCase()))
  if (!hit) missing.push([name, addr])
}

console.log(`已配图 ${GOODS.length - missing.length}/${GOODS.length}`)
if (missing.length === 0) {
  console.log('全部齐全 ✅')
} else {
  console.log('\n缺图清单（放进 public/static/icons/paoshang/）：')
  for (const [name, addr] of missing) {
    console.log(`  ${name.padEnd(4, '　')} (${addr})  →  ${name}.png`)
  }
}

const extra = files.filter(f => {
  const base = f.replace(/\.[^.]+$/, '')
  return !GOODS.some(([n]) => n === base)
})
if (extra.length) console.log(`\n目录里的其他文件（不会被用到）：${extra.join(', ')}`)
