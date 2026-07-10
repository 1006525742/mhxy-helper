<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <h1>🏔️ 996长安酒店</h1>
      </div>
      <nav class="nav">
        <RouterLink to="/">抓鬼助手</RouterLink>
        <RouterLink to="/baotu">宝图助手</RouterLink>
      </nav>
    </header>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: #16213e;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid var(--border-color);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header h1 {
  font-size: 18px;
  color: var(--color-primary);
}

.nav {
  display: flex;
  gap: 15px;
}

.nav a {
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 4px;
  transition: all 0.2s;
  text-decoration: none;
}

.nav a:hover {
  color: var(--color-text);
  background: var(--bg-card);
}

.nav a.router-link-active {
  color: var(--color-secondary);
  background: var(--bg-card);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>