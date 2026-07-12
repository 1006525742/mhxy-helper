import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '0.0.0.0',  // 允许局域网访问
    port: 3000,
    allowedHosts: ['mhxy.mhwk.cloud'],
    proxy: {
      // 抓鬼 → ghost 后端 (8000)
      '/api/maps': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/api/predict': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/api/ghost': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/api/monster': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      // 科举答题 OCR → keju 后端 (8001)
      '/api/ocr': {
        target: 'http://localhost:8001',
        changeOrigin: true
      },
      '/api/WatuOCR': {
        target: 'http://localhost:8001',
        changeOrigin: true
      },
      // 兜底 /api → ghost (8000)
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})