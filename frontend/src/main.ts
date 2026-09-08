import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
// 像素/终端字体本地化（@fontsource 自带 woff2，随 Vite 打包，不依赖被墙的 Google Fonts CDN）
import '@fontsource/press-start-2p'
import '@fontsource/vt323'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.use(router)
app.mount('#app')