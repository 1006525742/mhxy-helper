/**
 * 答题助手 · 本地图标匹配器（175dt 式：纯前端，无后端识别依赖）
 *
 * 题库以 sprite 图形式内置在前端（/dati/templates.png + bank.json），
 * 识别全程在浏览器本地完成：裁图 -> 归一化 -> NCC 模板匹配 -> 输出 Top5。
 *
 * 预处理必须与后端 backend_dati.prepare_icon 完全一致，否则两端基准不同会全错。
 */
export interface DatiCandidate {
  name: string
  school: string
  /** 模板匹配分 0-100（主判据） */
  mtScore: number
  /** 感知哈希分 0-100（参考） */
  hashScore: number
  icon: string
}

export interface DatiBankMeta {
  version: number
  count: number
  tile: number
  cols: number
  rows: number
}

const TS = 64 // 模板边长
const HASH = 8 // aHash 网格

let meta: DatiBankMeta | null = null
let bank: { name: string; school: string; icon: string }[] = []
/** 每个模板的 64x64 灰度（已减均值并归一化，可直算 NCC） */
let tplVec: Float32Array[] = []
let tplHash: string[] = []
let ready = false
let loading = false

export function isBankReady() { return ready }
export function bankSize() { return bank.length }

/** 加载本地题库（幂等） */
export async function initDatiBank(): Promise<boolean> {
  if (ready) return true
  if (loading) return false
  loading = true
  try {
    const [metaRes, bankRes] = await Promise.all([
      fetch('/dati/meta.json', { cache: 'force-cache' }),
      fetch('/dati/bank.json', { cache: 'force-cache' }),
    ])
    meta = await metaRes.json()
    bank = await bankRes.json()

    // 加载 sprite 并切成模板
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('templates.png 加载失败'))
      img.src = (meta as DatiBankMeta).count ? '/dati/templates.png' : '/dati/templates.png'
    })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data

    const cols = (meta as DatiBankMeta).cols
    tplVec = []
    tplHash = []
    for (let i = 0; i < bank.length; i++) {
      const r = Math.floor(i / cols)
      const col = i % cols
      const ox = col * TS
      const oy = r * TS
      const g = new Float32Array(TS * TS)
      for (let y = 0; y < TS; y++) {
        for (let x = 0; x < TS; x++) {
          const si = ((oy + y) * c.width + (ox + x)) * 4
          // 灰度化（sprite 本身是灰度图，三通道相同）
          g[y * TS + x] = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114
        }
      }
      tplVec.push(normalize(g))
      tplHash.push(aHashFromGray(g))
    }
    ready = true
    console.log(`[dati] 本地题库已加载: ${bank.length} 条`)
    return true
  } catch (e) {
    console.error('[dati] 本地题库加载失败', e)
    return false
  } finally {
    loading = false
  }
}

/** 零均值 + 单位范数，使点积即 NCC */
function normalize(v: Float32Array): Float32Array {
  const n = v.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += v[i]
  mean /= n
  let sq = 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const d = v[i] - mean
    out[i] = d
    sq += d * d
  }
  const norm = Math.sqrt(sq)
  if (norm > 1e-6) for (let i = 0; i < n; i++) out[i] /= norm
  return out
}

/** 归一化互相关（等价于 OpenCV TM_CCOEFF_NORMED） */
function ncc(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** 从 64x64 灰度算 8x8 aHash（与后端同基准：均值阈值） */
function aHashFromGray(g: Float32Array): string {
  const cells = new Float32Array(HASH * HASH)
  const step = TS / HASH
  for (let hy = 0; hy < HASH; hy++) {
    for (let hx = 0; hx < HASH; hx++) {
      let sum = 0
      const x0 = Math.floor(hx * step)
      const y0 = Math.floor(hy * step)
      const x1 = Math.floor((hx + 1) * step)
      const y1 = Math.floor((hy + 1) * step)
      let cnt = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += g[y * TS + x]
          cnt++
        }
      }
      cells[hy * HASH + hx] = cnt ? sum / cnt : 0
    }
  }
  let mean = 0
  for (let i = 0; i < cells.length; i++) mean += cells[i]
  mean /= cells.length
  let bits = ''
  for (let i = 0; i < cells.length; i++) bits += cells[i] > mean ? '1' : '0'
  return bits
}

function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) d++
  return d
}

/**
 * 统一基准预处理：任意图 -> 64x64 白底、前景居中
 * 对齐 backend_dati.prepare_icon：
 *  - 有透明通道：按 alpha 求前景包围盒
 *  - 不透明（屏幕截图）：取四角 10x10 平均色为背景，欧氏距离 >40 判为前景
 */
export function prepareIcon(src: HTMLCanvasElement | HTMLImageElement): Float32Array {
  // 取像素
  let w: number, h: number, data: Uint8ClampedArray
  const c = document.createElement('canvas')
  if (src instanceof HTMLCanvasElement) {
    w = src.width
    h = src.height
  } else {
    w = src.naturalWidth
    h = src.naturalHeight
  }
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(src as CanvasImageSource, 0, 0)
  data = ctx.getImageData(0, 0, w, h).data

  // 判断是否含透明
  let minA = 255
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < minA) minA = data[i]
    if (minA < 250) break
  }

  let bx0 = 0, by0 = 0, bx1 = w, by1 = h
  if (minA < 250) {
    // 按 alpha 求包围盒
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x > x1) x1 = x
          if (y > y1) y1 = y
        }
      }
    }
    if (x1 >= 0) { bx0 = x0; by0 = y0; bx1 = x1 + 1; by1 = y1 + 1 }
  } else {
    // 四角取背景色
    const m = Math.min(10, Math.floor(w / 2), Math.floor(h / 2))
    let br = 0, bg = 0, bb = 0, cnt = 0
    const grab = (sx: number, sy: number) => {
      for (let y = sy; y < sy + m; y++) {
        for (let x = sx; x < sx + m; x++) {
          const i = (y * w + x) * 4
          br += data[i]; bg += data[i + 1]; bb += data[i + 2]; cnt++
        }
      }
    }
    grab(0, 0)
    grab(w - m, 0)
    grab(0, h - m)
    grab(w - m, h - m)
    br /= cnt; bg /= cnt; bb /= cnt

    // 阈值分离前景
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb
        if (Math.sqrt(dr * dr + dg * dg + db * db) > 40) {
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x > x1) x1 = x
          if (y > y1) y1 = y
        }
      }
    }
    if (x1 >= 0) { bx0 = x0; by0 = y0; bx1 = x1 + 1; by1 = y1 + 1 }
  }

  const fw = Math.max(1, bx1 - bx0)
  const fh = Math.max(1, by1 - by0)
  const s = TS / Math.max(fw, fh)
  const nw = Math.max(1, Math.round(fw * s))
  const nh = Math.max(1, Math.round(fh * s))

  // 缩放前景到 64x64 白底居中
  const tmp = document.createElement('canvas')
  tmp.width = nw
  tmp.height = nh
  const tctx = tmp.getContext('2d')!
  tctx.drawImage(c, bx0, by0, fw, fh, 0, 0, nw, nh)
  const td = tctx.getImageData(0, 0, nw, nh).data

  const out = new Float32Array(TS * TS).fill(255)
  const ox = Math.floor((TS - nw) / 2)
  const oy = Math.floor((TS - nh) / 2)
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const i = (y * nw + x) * 4
      const a = td[i + 3] / 255
      const g = td[i] * 0.299 + td[i + 1] * 0.587 + td[i + 2] * 0.114
      const dx = ox + x, dy = oy + y
      if (dx < 0 || dy < 0 || dx >= TS || dy >= TS) continue
      // 白底 (255) 与前景按 alpha 合成
      out[dy * TS + dx] = g * a + 255 * (1 - a)
    }
  }
  return out
}

/** 本地匹配：传入裁出的图标 canvas，返回 Top N */
export function matchIconLocal(canvas: HTMLCanvasElement, topN = 5): DatiCandidate[] {
  if (!ready) return []
  const g = prepareIcon(canvas)
  const v = normalize(g)
  const h = aHashFromGray(g)

  const list = bank.map((b, i) => {
    const mt = ncc(v, tplVec[i])
    const hd = hamming(h, tplHash[i])
    return {
      name: b.name,
      school: b.school,
      mtScore: Math.round(Math.max(0, mt) * 1000) / 10, // -1~1 -> 百分比一位小数
      hashScore: Math.round((1 - hd / (HASH * HASH)) * 1000) / 10,
      icon: b.icon,
      _mt: mt,
    }
  })
  list.sort((a, b) => b._mt - a._mt)
  return list.slice(0, topN).map((x) => ({
    name: x.name, school: x.school, mtScore: x.mtScore, hashScore: x.hashScore, icon: x.icon,
  }))
}
