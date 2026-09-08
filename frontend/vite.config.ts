import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { statSync, createReadStream } from 'fs'
import http from 'http'
import type { IncomingMessage, ServerResponse } from 'http'

// Vite dev server 在大文件（>1MB）传输时会出 ERR_CONTENT_LENGTH_MISMATCH
// 用自定义中间件绕过 Vite 管线，直接流式传输大文件
function largeFileMiddleware() {
  // 需要直传的大文件路径模式
  const LARGE_FILE_PATTERNS = [
    /\.bin$/,
    /model\.json$/,
    /question_bank\.json$/,
    /hash-db\.json$/,
  ]

  const PUBLIC_DIR = resolve(__dirname, 'public')

  function findFile(urlPath: string): string | null {
    // 尝试在 public 目录下定位文件
    const candidates = [
      resolve(PUBLIC_DIR, urlPath.replace(/^\//, '')),
      resolve(PUBLIC_DIR, 'mhxy/static', urlPath.replace(/^\//, '').replace(/^mhxy\/static\//, '')),
    ]
    for (const p of candidates) {
      try {
        const st = statSync(p)
        if (st.isFile()) return p
      } catch {}
    }
    return null
  }

  return function viteLargeFileMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ) {
    const url = req.url || ''
    // 只拦截 GET/HEAD，让 Vite 处理其他方法（如 HMR websocket）
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()

    const isLarge = LARGE_FILE_PATTERNS.some(p => p.test(url))
    if (!isLarge) return next()

    const filePath = findFile(url)
    if (!filePath) return next()

    try {
      const stat = statSync(filePath)
      const fileSize = stat.size

      // 小文件让 Vite 正常处理（Vite 对 <1MB 文件没问题）
      if (fileSize < 1024 * 1024) return next()

      // 设置响应头
      const ext = url.split('.').pop() || ''
      const mimeMap: Record<string, string> = {
        'bin': 'application/octet-stream',
        'json': 'application/json',
        'wasm': 'application/wasm',
      }
      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
      res.setHeader('Content-Length', fileSize)
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.setHeader('Accept-Ranges', 'bytes')
      res.statusCode = 200

      if (req.method === 'HEAD') {
        res.end()
        return
      }

      // 流式传输，避免一次性读入内存
      const stream = createReadStream(filePath, { highWaterMark: 256 * 1024 })
      stream.pipe(res)
      stream.on('error', (err) => {
        console.error('[large-file] 流传输错误:', filePath, err.message)
        if (!res.headersSent) {
          res.statusCode = 500
          res.end()
        }
      })
    } catch (err: any) {
      console.error('[large-file] 文件错误:', url, err.message)
      next()
    }
  }
}

export default defineConfig({
  plugins: [
    {
      // 拦截外部扫描器对系统绝对路径（/home /var /etc /app /usr /C: 等）的探测请求，
      // 直接返回 404，避免 @vitejs/plugin-vue 的 load 钩子去 readFileSync 这些不存在的文件，
      // 从而触发 500 / Vite 错误遮罩。
      // 背景：dev server 经 frpc(3000→8080) 与 Cloudflare Tunnel 暴露公网后会被持续扫描，
      // 扫描器用常见凭证/rc 文件路径（含 /@fs 前缀的 Windows 路径）打 Vite，而 plugin-vue
      // 会把任何带 ?vue 的请求当 .vue 文件读取并抛 ENOENT。本中间件在请求早期拦截，
      // 完全正常的应用请求（/src/*、/@vite/*、/@fs 在项目根内、/api/* 等）不受影响。
      name: 'vite-block-scanner',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const raw = req.url || ''
          let pathname = raw.split('?', 1)[0]
          try { pathname = decodeURIComponent(pathname) } catch { /* ignore */ }

          // 1) 系统级绝对路径扫描（/home /var /etc /app /usr /opt /C: 等常见凭证与 rc 文件），
          //    非本应用合法请求
          if (/^\/(home|var|etc|root|run|app|usr|opt|srv|sys|proc|boot|mnt|media|Users|C:)(\/|\\|$)/i.test(pathname)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('Not Found')
            return
          }

          // 2) 带 ?vue 的请求：合法的 Vue 模块路径只可能是 /src /node_modules /@vite /@fs/ 开头，
          //    其余带 ?vue 的绝对路径（扫描器构造，目录可任意变换）一律 404，
          //    避免 plugin-vue 去 readFileSync 不存在的文件。这是最稳的一道闸。
          if (/[?&]vue\b/.test(raw)) {
            const okPrefix = /^\/(src|node_modules|@vite|@fs\/)/.test(pathname)
            if (!okPrefix) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Not Found')
              return
            }
          }

          // 3) 畸形的 /@fs<drive>: 扫描变体（正常 Vite 用 /@fs/ 且需经 server.fs.allow 校验）
          if (/^\/@fs(?![\/])/.test(pathname)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('Not Found')
            return
          }

          next()
        })
      },
    },
    vue(),
    {
      name: 'vite-large-file-middleware',
      configureServer(server) {
        // 在 Vite 内部中间件之前插入，优先级最高
        server.middlewares.use(largeFileMiddleware())
      },
    },
    {
      // 按路径把 /api/* 分发到对应后端（纯 Node http 转发，零依赖、不受 vite 前缀排序影响）
      name: 'vite-api-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || ''
          const host = '127.0.0.1'

          // 统一转发 helper（874 行转发目标端口）
          function forward(port: number, pathOverride?: string) {
            const options: http.RequestOptions = {
              host,
              port,
              path: pathOverride ?? url,
              method: req.method,
              headers: { ...req.headers, host: `${host}:${port}` },
            }
            console.error('[api-proxy] dispatch', url, '->', `http://${host}:${port}`)
            const proxyReq = http.request(options, (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
              proxyRes.pipe(res)
            })
            proxyReq.on('error', (e) => {
              console.error('[api-proxy] 转发失败', port, url, e.message)
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
              }
              // 返回 JSON 而非纯文本，避免前端 r.json() 抛 Unexpected token
              res.end(JSON.stringify({
                result: 'error',
                answer: '',
                raw_answer: '',
                error: 'api proxy error: ' + e.message,
              }))
            })
            req.pipe(proxyReq)
          }

          // 物价宝鉴整页入口（首页 iframe 内 /wuji/ 整页加载 8767 根，去掉 /wuji 前缀）
          if (url === '/wuji' || url.startsWith('/wuji/')) {
            return forward(8767, url.replace(/^\/wuji/, '') || '/')
          }
          // 物价图标（jizhang.html 用绝对路径 /static/icons/*）
          if (url.startsWith('/static/icons')) {
            return forward(8767, url)
          }

          if (!url.startsWith('/api')) return next()

          // 分发规则：挖图(8003) / 宝图分图(8002) / 科举(8001) / 精灵(8004) / 物价(8767) / 其余抓鬼(8000)
          let port = 8000
          if (url.startsWith('/api/watu')) {
            port = 8003
          } else if (url.startsWith('/api/fentu') || url.startsWith('/api/baotu')) {
            port = 8002
          } else if (
            url.startsWith('/api/ocr') ||
            url.startsWith('/api/WatuOCR') ||
            url.startsWith('/api/hash-db')
          ) {
            port = 8001
          } else if (url.startsWith('/api/sprite')) {
            port = 8004
          } else if (url.startsWith('/api/othello')) {
            port = 8005
          } else if (
            url.startsWith('/api/data') || url.startsWith('/api/item') ||
            url.startsWith('/api/server') || url.startsWith('/api/icons') ||
            url.startsWith('/api/sync') || url.startsWith('/api/market') ||
            url.startsWith('/api/trends')
          ) {
            port = 8767
          } else if (url.startsWith('/api/cbg')) {
            port = 8006
          } else if (url.startsWith('/api/gold')) {
            port = 8010
          } else if (url.startsWith('/api/asset')) {
            port = 8012
          } else if (url.startsWith('/api/harvest')) {
            port = 8007
          }
          forward(port)
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  // onnxruntime-web 内部会用运行时字符串动态 import() 自托管的 wasm jsep 模块
  // （public/ort-wasm/ort-wasm-simd-threaded.jsep.mjs）。若被 Vite 预打包，该 import 会被
  // 改写成 .mjs?import 后在 dev server 解析失败，报 "no available backend found /
  // Failed to fetch dynamically imported module"。排除预打包，让浏览器直接按 public 路径加载。
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    host: '0.0.0.0',  // 允许局域网访问
    port: 3000,
    // 只允许 /@fs 读取项目根目录内的文件，避免公网扫描器借 /@fs 越权读取系统文件
    fs: {
      allow: [resolve(__dirname)],
    },
    allowedHosts: ['mhxy.mhwk.cloud', 'yjmhxy.top', '117.72.108.169', 'localhost'],
    // 注意：vite 原生 proxy 的多前缀 key 会被「兜底 /api」吞掉，且 router 选项不生效，
    // 因此 /api 分发改用下方 vite-api-proxy 插件（纯 Node http 转发，按路径分发到各后端）。
    // 例外：/static/icons 必须用原生 proxy，因为 Vite 内置 public 静态中间件会抢先处理 /static，
    // 原生 proxy 注册时机早于该内置中间件，可正确转发到物价后端 8767。
    proxy: {
      '/static/icons': {
        target: 'http://127.0.0.1:8767',
        changeOrigin: true,
      },
    },
  }
})
