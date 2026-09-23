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
    },
    {
      path: '/fentu',
      name: 'fentu',
      component: () => import('@/views/FentuView.vue')
    },
    {
      path: '/watu',
      name: 'watu',
      component: () => import('@/views/WatuView.vue')
    },
    {
      path: '/jiankong',
      name: 'jiankong',
      component: () => import('@/views/JiankongView.vue')
    },
    {
      path: '/jiankong4',
      name: 'jiankong4',
      component: () => import('@/views/Jiankong4View.vue')
    },
    {
      path: '/cixin',
      name: 'cixin',
      component: () => import('@/views/CixinView.vue')
    },
    {
      path: '/fishing',
      name: 'fishing',
      component: () => import('@/views/FishingView.vue')
    },
    {
      path: '/cbg',
      name: 'cbg',
      component: () => import('@/views/CbgView.vue')
    },
    {
      path: '/cbg-library',
      name: 'cbg-library',
      component: () => import('@/views/CollectionView.vue')
    },
    {
      path: '/gold',
      name: 'gold',
      component: () => import('@/views/GoldView.vue')
    },
    {
      path: '/assets',
      name: 'assets',
      component: () => import('@/views/AssetView.vue')
    },
    {
      path: '/tiandikang',
      name: 'tiandikang',
      component: () => import('@/views/TiandikangView.vue')
    },
    {
      path: '/calc',
      name: 'calc',
      component: () => import('@/calculators/views/CalculatorHome.vue')
    },
    {
      path: '/calc/:id',
      name: 'calc-detail',
      component: () => import('@/calculators/views/CalcView.vue')
    },
    {
      path: '/calc-data/:id',
      name: 'calc-data',
      component: () => import('@/calculators/views/DataEntryView.vue')
    },
    {
      path: '/harvest',
      name: 'harvest',
      component: () => import('@/views/HarvestView.vue')
    },
    {
      path: '/chess',
      name: 'chess',
      component: () => import('@/views/ChessCoordView.vue')
    },
    {
      path: '/scammer',
      name: 'scammer',
      component: () => import('@/views/ScammerView.vue')
    },
    {
      path: '/dati',
      name: 'dati',
      component: () => import('@/views/DatiView.vue')
    },
    {
      path: '/admin/wechat',
      name: 'admin-wechat',
      component: () => import('@/views/WechatReceiversView.vue')
    },
    {
      path: '/paoshang',
      name: 'paoshang',
      component: () => import('@/views/PaoshangView.vue')
    }
  ]
})

export default router