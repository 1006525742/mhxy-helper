<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { goodsEmoji, goodsIconSrc } from '@/services/paoshangLogic'

const props = defineProps<{
  name: string
  size?: number
}>()

/** 图片加载失败（文件还没配）时降级为 emoji */
const failed = ref(false)
watch(
  () => props.name,
  () => (failed.value = false)
)

const src = computed(() => (props.name ? goodsIconSrc(props.name) : ''))
const emoji = computed(() => goodsEmoji(props.name))
const px = computed(() => `${props.size ?? 22}px`)
</script>

<template>
  <span class="goods-icon" :style="{ width: px, height: px, fontSize: px }" :title="name">
    <img v-if="!failed && name" :src="src" :alt="name" @error="failed = true" />
    <span v-else class="emoji">{{ emoji }}</span>
  </span>
</template>

<style scoped>
.goods-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  line-height: 1;
  overflow: hidden;
}
.goods-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto;
}
.emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  filter: saturate(0.9);
}
</style>
