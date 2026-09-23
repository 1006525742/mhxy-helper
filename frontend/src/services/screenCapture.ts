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
  /** 承载 video 的隐藏容器：video 必须挂在 DOM 上，浏览器才会持续解码屏幕共享帧
   * （否则页面被遮挡/切后台时 video 帧冻结，captureFull 永远抓到旧画面）。 */
  private holder: HTMLElement | null = null

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

      // 采集分辨率对齐原站 mhxyai.com/v2/fentu：ideal 1280×960。
      // 原站的格子判定基于「采集后物品栏约 250×200px + 固定 cellSize 50/55」，
      // 若用原生高分辨率（如 2560×1440）采集，物品栏框会远大于 250px，
      // 固定格尺寸就会整体错位。这里统一降采集分辨率来保证几何一致。
      // 捕获源约束（关键）：引导/优先选「窗口」而不是「整个屏幕」。
      // 选屏幕 = 把盖在游戏上的浏览器窗口一起拍进去（遮挡 → 识别乱七八糟）；
      // 选窗口 = 走 OS 窗口合成，即使被浏览器完全盖住，拿到的仍是窗口自身内容。
      // 下列 Chrome 扩展选项在 Safari/Firefox 会被忽略，不影响兼容性。
      const opts: Record<string, unknown> = {
        video: {
          cursor: 'always',
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 15 },
          displaySurface: 'window'          // 提示选择器默认高亮「窗口」页签
        } as MediaTrackConstraints,
        audio: false,
        preferCurrentTab: false,            // 别默认选中本页
        selfBrowserSurface: 'exclude',      // 排除本浏览器自身（避免选到自己网页）
        systemAudio: 'exclude',
        surfaceSwitching: 'include'         // 仍允许在弹窗里切换到「屏幕」
      }
      this.stream = await navigator.mediaDevices.getDisplayMedia(
        opts as unknown as DisplayMediaStreamOptions
      )

      this.video = document.createElement('video')
      // 关键：muted 才能自动播放
      this.video.muted = true
      this.video.srcObject = this.stream
      await this.video.play()

      // 把 video 挂到 DOM（视觉隐藏但非 display:none）：浏览器需有渲染目标才能
      // 在页面被遮挡 / 切后台时持续解码屏幕共享帧，否则 captureFull 会永远抓到旧画面。
      this.holder = document.createElement('div')
      this.holder.style.cssText =
        'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden;'
      this.holder.appendChild(this.video)
      document.body.appendChild(this.holder)

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
   * 确保 video 处于播放状态（页面被遮挡/切后台后浏览器可能暂停 video，
   * 用 fire-and-forget 方式重新 play 以恢复帧解码）。
   */
  ensurePlaying(): void {
    if (this.video && this.video.paused) {
      this.video.play().catch(() => {})
    }
  }

  /**
   * 停止屏幕共享
   */
  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    if (this.holder && this.holder.parentNode) {
      this.holder.parentNode.removeChild(this.holder)
    }
    this.holder = null
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
    this.ensurePlaying()
    if (!this.video || !this.canvas) return null

    const width = this.video.videoWidth
    const height = this.video.videoHeight

    if (width === 0 || height === 0) return null

    // 同理：只在尺寸变化时重设，避免每次截图都重新分配画布
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(this.video, 0, 0)
    return this.canvas.toDataURL('image/jpeg', 0.8)
  }

  /**
   * 截取指定区域
   */
  captureRegion(options: ScreenCaptureOptions): string | null {
    this.ensurePlaying()
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
    this.ensurePlaying()
    if (!this.video || !this.canvas) return null

    const width = this.video.videoWidth
    const height = this.video.videoHeight

    if (width === 0 || height === 0) return null

    // 只在尺寸真的变了才重设：给 canvas.width 赋「相同的值」也会清空画布并重新分配后备存储，
    // 预览循环里每帧重设 = 每帧重新分配数 MB 内存，是崩溃诱因之一。
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(this.video, 0, 0)
    return this.canvas.toDataURL('image/jpeg', 0.5)
  }

  /**
   * 暴露内部 video 元素。前端本地推理（YOLO 等）需要直接 drawImage 取原始帧，
   * 走 captureFull() 的 dataURL→Image 链路会多一次 JPEG 编解码，白白丢精度又慢。
   * 只读用途：不要改 srcObject / 不要调 play/pause。
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.video
  }

  /**
   * 是否正在共享
   */
  isActive(): boolean {
    return this.stream !== null && this.video !== null
  }

  /**
   * 暴露原始媒体流，供页面其它 <video> 做可见预览
   */
  getStream(): MediaStream | null {
    return this.stream
  }
}