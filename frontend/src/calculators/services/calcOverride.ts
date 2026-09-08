// 本地录入覆盖层：默认 calcs.ts 数据不变，用户在校对页录入的表存 localStorage，
// 运行时通过 resolveCalc 覆盖默认 rows。无需账号、纯前端。
import type { CalcDef, SynthesisRow } from '../engine/types'

const KEY_PREFIX = 'mhxy_calc_override_'

export function getOverride(id: string): SynthesisRow[] | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + id)
    if (!raw) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr as SynthesisRow[]
  } catch {
    return null
  }
}

export function setOverride(id: string, rows: SynthesisRow[]): void {
  localStorage.setItem(KEY_PREFIX + id, JSON.stringify(rows))
}

export function clearOverride(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id)
}

export function hasOverride(id: string): boolean {
  return getOverride(id) !== null
}

// 合成类：若存在本地录入，则覆盖默认 rows 并标注为已录入
export function resolveCalc(def: CalcDef): CalcDef {
  if (def.type === 'synthesis') {
    const ov = getOverride(def.id)
    if (ov && ov.length) {
      return {
        ...def,
        rows: ov,
        meta: {
          ...def.meta,
          verified: true,
          note: (def.meta.note || '') + ' ［已本地录入并覆盖默认数据，来源：用户在校对页填写］',
        },
      }
    }
  }
  return def
}
