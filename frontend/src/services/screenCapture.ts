/**
 * 屏幕截图服务
 * 使用 getDisplayMedia API 实现跨平台屏幕共享
 */

export interface ScreenCaptureOptions {
  x?: number
  y?: number
  width?: number
  height?: number
}

export class ScreenCapture {
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null

  /**
   * 开始屏幕共享
   * 必须由用户手势触发（按钮点击）
   */
  async start(): Promise<boolean> {
    try {
      // 检查 API 是否可用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        console.error('浏览器不支持屏幕共享（需要 HTTPS 或 localhost）')
        return false
      }

      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as MediaTrackConstraints,
        audio: false
      })

      this.video = document.createElement('video')
      // 关键：muted 才能自动播放
      this.video.muted = true
      this.video.srcObject = this.stream
      await this.video.play()

      // 等待视频元数据加载（确保 videoWidth/Height 可用）
      await this.waitForVideoReady()

      this.canvas = document.createElement('canvas')

      // 监听停止事件
      this.stream.getVideoTracks()[0].onended = () => {
        this.stop()
      }

      return true
    } catch (e) {
      console.error('屏幕共享失败:', e)
      this.stop()
      return false
    }
  }

  /**
   * 等待视频就绪
   */
  private waitForVideoReady(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.video) {
        resolve()
        return
      }
      if (this.video.videoWidth > 0) {
        resolve()
        return
      }
      const check = () => {
        if (this.video && this.video.videoWidth > 0) {
          resolve()
        } else {
          requestAnimationFrame(check)
        }
      }
      check()
    })
  }

  /**
   * 停止屏幕共享
   */
  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    this.video = null
    this.canvas = null
  }

  /**
   * 获取视频尺寸
   */
  getVideoSize(): { width: number; height: number } | null {
    if (!this.video) return null
    return {
      width: this.video.videoWidth,
      height: this.video.videoHeight
    }
  }

  /**
   * 截取全屏
   */
  captureFull(): string | null {
    if (!this.video || !this.canvas) return null

    const width = this.video.videoWidth
    const height = this.video.videoHeight

    if (width === 0 || height === 0) return null

    this.canvas.width = width
    this.canvas.height = height

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(this.video, 0, 0)
    return this.canvas.toDataURL('image/jpeg', 0.8)
  }

  /**
   * 截取指定区域
   */
  captureRegion(options: ScreenCaptureOptions): string | null {
    if (!this.video || !this.canvas) return null

    const fullWidth = this.video.videoWidth
    const fullHeight = this.video.videoHeight

    if (fullWidth === 0 || fullHeight === 0) return null

    const x = options.x || 0
    const y = options.y || 0
    const width = options.width || fullWidth
    const height = options.height || fullHeight

    this.canvas.width = fullWidth
    this.canvas.height = fullHeight

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(this.video, 0, 0)

    // 裁剪区域
    const regionCanvas = document.createElement('canvas')
    regionCanvas.width = width
    regionCanvas.height = height
    const regionCtx = regionCanvas.getContext('2d')
    if (!regionCtx) return null

    regionCtx.drawImage(this.canvas, x, y, width, height, 0, 0, width, height)

    return regionCanvas.toDataURL('image/jpeg', 0.8)
  }

  /**
   * 获取实时预览帧（用于本地显示）
   */
  getPreviewFrame(): string | null {
    if (!this.video || !this.canvas) return null

    const width = this.video.videoWidth
    const height = this.video.videoHeight

    if (width === 0 || height === 0) return null

    this.canvas.width = width
    this.canvas.height = height

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(this.video, 0, 0)
    return this.canvas.toDataURL('image/jpeg', 0.5)
  }

  /**
   * 是否正在共享
   */
  isActive(): boolean {
    return this.stream !== null && this.video !== null
  }
}