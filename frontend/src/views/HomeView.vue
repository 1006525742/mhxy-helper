<script setup lang="ts">
// 首页嵌入静态 HTML
</script>

<template>
  <div class="home-wrapper">
    <iframe
      src="/mhxy/static/index.html"
      class="home-iframe"
      title="泰迪熊工具箱"
      frameborder="0"
    ></iframe>
  </div>
</template>

<style scoped>
.home-wrapper {
  width: 100%;
  height: calc(100vh - 56px);
  overflow: hidden;
}

.home-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>