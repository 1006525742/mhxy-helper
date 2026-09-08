<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <h1>🏔️ <span class="brand-mark">泰迪熊</span>工具箱</h1>
        <nav class="nav">
          <RouterLink to="/">⬅ 返回首页</RouterLink>
        </nav>
      </div>
    </header>
    <main class="main">
      <RouterView />
    </main>
    <footer class="beian-footer">
      <a href="http://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">闽ICP备2026011900号</a>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: #0a0e18;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid var(--border-color);
  position: relative;
}
/* 顶栏底部马赛克斜纹 */
.header::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: -2px;
  height: 2px;
  background: repeating-linear-gradient(
    90deg,
    rgba(34, 211, 238, 0.5) 0,
    rgba(34, 211, 238, 0.5) 4px,
    transparent 4px,
    transparent 8px
  );
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header h1 {
  font-family: var(--font-pixel);
  font-size: 14px;
  color: var(--color-primary);
  letter-spacing: 0.5px;
  text-shadow: 0 0 30px rgba(34, 211, 238, 0.25);
}
.brand-mark {
  color: var(--color-accent);
  text-shadow: 0 0 30px rgba(255, 215, 0, 0.3);
}

.nav {
  display: flex;
  gap: 15px;
}

.nav a {
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  font-size: 15px;
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  transition: all 0.08s linear;
  text-decoration: none;
}

.nav a:hover {
  color: var(--color-primary);
  background: var(--bg-card);
  border-color: var(--border-color);
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.12);
}

.nav a.router-link-active {
  color: var(--color-primary);
  background: var(--bg-card);
  border-color: rgba(34, 211, 238, 0.2);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.beian-footer {
  margin-top: auto;
  padding: 12px 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--color-text-muted);
  border-top: 1px solid var(--border-color);
}

.beian-footer a {
  color: var(--color-text-muted);
  text-decoration: none;
}

.beian-footer a:hover {
  color: var(--color-primary);
  text-decoration: underline;
}
</style>
