import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { trackEvent } from './services/analytics'
// 像素/终端字体本地化（@fontsource 自带 woff2，随 Vite 打包，不依赖被墙的 Google Fonts CDN）
import '@fontsource/press-start-2p'
import '@fontsource/vt323'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.use(router)

// 访问统计埋点：每次路由切换上报一次模块访问（失败静默，不影响业务）
router.afterEach((to) => {
  // 路由没配 name 时（如已删除的旧链接 /muyu）用路径兜底，避免上报成 unknown
  const name =
    typeof to.name === 'string'
      ? to.name
      : to.name
        ? String(to.name)
        : to.path && to.path !== '/'
          ? to.path.replace(/^\//, '')
          : 'unknown'
  trackEvent(name, to.fullPath)
})

app.mount('#app')