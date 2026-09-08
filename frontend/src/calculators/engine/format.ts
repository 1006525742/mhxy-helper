// 数值格式化工具

// 梦幻币（单位：万）→ 自适应 两/万/亿
export function fmtWan(wan: number): string {
  const w = wan
  if (!isFinite(w)) return '-'
  const abs = Math.abs(w)
  if (abs >= 10000) return (w / 10000).toFixed(2) + '亿'
  if (abs >= 1) return w.toFixed(2) + '万'
  return (w * 10000).toFixed(0) + '两'
}

// 人民币（元）→ 显示口径：
// 保留 2 位小数；≥1万 四舍五入改为「万」为单位；≥1亿 改为「亿」为单位；不带 ¥ 符号。
export function fmtRMB(yuan: number): string {
  if (!isFinite(yuan)) return '-'
  const abs = Math.abs(yuan)
  if (abs >= 1e8) return (yuan / 1e8).toFixed(2) + '亿'
  if (abs >= 10000) return (yuan / 10000).toFixed(2) + '万'
  return yuan.toFixed(2)
}

// 整数千分位
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('zh-CN')
}
