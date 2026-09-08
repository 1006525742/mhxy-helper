// 梦幻币 ↔ 人民币 换算引擎
// goldPrice: 人民币元 / 3000万梦幻币（即金价，手动输入）
// discount: 折扣（1 = 无折扣，0.9 = 9折）

export function wanToRMB(mhxyWan: number, goldPrice: number, discount = 1): number {
  if (!goldPrice || goldPrice <= 0) return 0
  return (mhxyWan / 3000) * goldPrice * discount
}

// 万梦幻币 → 元（带折扣）
export function rmbFromWan(mhxyWan: number, goldPrice: number, discount = 1): number {
  return wanToRMB(mhxyWan, goldPrice, discount)
}
