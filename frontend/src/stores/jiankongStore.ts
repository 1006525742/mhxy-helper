import { defineStore } from 'pinia'
import type { MonitorConfig } from '@/services/jiankongLogic'

/**
 * 通用监控状态管理
 * 配置项（threshold/playTimes/intervalSec/soundType）以响应式对象形式持有，
 * 会直接传给 MonitorEngine 作为引用，运行中修改即可实时生效。
 */
export const useJiankongStore = defineStore('jiankong', {
  state: () => ({
    config: {
      threshold: 5, // 变化阈值（%）
      playTimes: 3, // 连播次数
      intervalSec: 2, // 监控频率（秒）
      soundType: 'beep' as 'beep' | 'tts' | 'both',
      ttsText: '画面变化提醒',
      offlineDetect: false // 开启离线检测
    } as MonitorConfig,

    isSharing: false,
    isMonitoring: false,
    statusText: '请先通过「屏幕共享」采集画面，再启动监控',
    statusColor: '#6b5744',
    lastRate: 0,
    alertCount: 0
  }),

  actions: {
    setSharing(v: boolean) {
      this.isSharing = v
    },
    setMonitoring(v: boolean) {
      this.isMonitoring = v
    },
    setStatus(text: string, color = '#aaa') {
      this.statusText = text
      this.statusColor = color
    },
    setLastRate(v: number) {
      this.lastRate = v
    },
    incAlert() {
      this.alertCount++
    }
  }
})
