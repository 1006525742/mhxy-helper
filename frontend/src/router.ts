import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue')
    },
    {
      path: '/ghost',
      name: 'ghost',
      component: () => import('@/views/GhostView.vue')
    },
    {
      path: '/baotu',
      name: 'baotu',
      component: () => import('@/views/BaotuView.vue')
    }
  ]
})

export default router