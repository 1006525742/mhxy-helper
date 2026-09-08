<script setup lang="ts">
import { computed } from 'vue'
import { CALCS } from '@/calculators/data/calcs'
import type { CalcDef } from '@/calculators/engine/types'

const groups = computed(() => {
  const m: Record<string, CalcDef[]> = {}
  for (const c of CALCS) {
    ;(m[c.category] ??= []).push(c)
  }
  return Object.entries(m)
})

function typeTag(c: CalcDef): string {
  if (c.type === 'synthesis') return '合成'
  if (c.type === 'animalset') return '套装'
  if (c.type === 'fixeddamage') return '固伤'
  if (c.type === 'fdweapon') return '武器'
  if (c.type === 'speedchaos') return '乱敏'
  if (c.type === 'vitality') return '体活'
  return '养成'
}

function subText(c: CalcDef): string {
  if (c.type === 'synthesis') return `1~${c.maxLevel} 级合成`
  if (c.type === 'animalset') return '输入等级推荐套装'
  if (c.type === 'fixeddamage') return '门派 + 加伤项 → 主秒/副秒'
  if (c.type === 'fdweapon') return '武器副秒性价比对比'
  if (c.type === 'speedchaos') return '须弥面板 → 乱敏范围 + 梯队要求'
  if (c.type === 'vitality') return '恢复时间 + 方案收益对比'
  return `${c.minLevel}~${c.maxLevel} 级`
}
</script>

<template>
  <div class="calc-home">
    <header class="ch-header">
      <h1>🧮 数值计算器</h1>
    </header>

    <section v-for="[cat, items] in groups" :key="cat" class="ch-group">
      <h2 class="ch-group-title">{{ cat }}</h2>
      <div class="ch-grid">
        <RouterLink
          v-for="c in items"
          :key="c.id"
          :to="`/calc/${c.id}`"
          class="ch-card"
          :class="c.type"
        >
          <div class="ch-card-top">
            <span class="ch-type" :class="c.type">{{ typeTag(c) }}</span>
          </div>
          <div class="ch-card-name">{{ c.name }}</div>
          <div class="ch-card-sub">
            {{ subText(c) }}
          </div>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.calc-home {
  width: 100%;
  margin: 0 auto;
  padding: 28px 28px 44px;
}
.ch-header {
  margin-bottom: 6px;
}
.ch-header h1 {
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: 0.5px;
}
.ch-group {
  margin-top: 32px;
}
.ch-group-title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-secondary);
  margin-bottom: 14px;
}
.ch-group-title::before {
  content: '';
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--color-secondary);
}
.ch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
  gap: 16px;
}
.ch-card {
  position: relative;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(167, 139, 250, 0.2);
  border-radius: 14px;
  padding: 18px 18px 16px;
  text-decoration: none;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.ch-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--color-secondary);
  opacity: 0.85;
}
.ch-card.synthesis::before {
  background: #b388ff;
}
.ch-card.levelcost::before {
  background: #43a047;
}
.ch-card.fixeddamage::before {
  background: #c77d00;
}
.ch-card.fdweapon::before {
  background: #c77d00;
}
.ch-card.speedchaos::before {
  background: #1e88e5;
}
.ch-card.vitality::before {
  background: #00897b;
}
.ch-card:hover {
  transform: translateY(-4px);
  border-color: var(--color-primary);
  box-shadow: 0 12px 26px rgba(233, 69, 96, 0.2);
}
.ch-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.ch-type {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 3px 10px;
  border-radius: 999px;
  color: #fff;
}
.ch-type.synthesis {
  background: #7c4dff;
}
.ch-type.levelcost {
  background: #2e7d32;
}
.ch-type.fixeddamage {
  background: #c77d00;
}
.ch-type.fdweapon {
  background: #c77d00;
}
.ch-type.speedchaos {
  background: #1e88e5;
}
.ch-type.vitality {
  background: #00897b;
}
.ch-card-name {
  font-size: 19px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text);
}
.ch-card-sub {
  font-size: 13.5px;
  line-height: 1.5;
  color: #93a1b3;
  margin-top: 8px;
}
</style>
