<script setup lang="ts">
/**
 * 自动战斗监控页面（复刻 mhxyai.com/v2/jiankong4）
 * 屏幕共享 → 整屏 YOLO 检测「自动战斗框」→ 框消失（挂机异常/掉线）播放预警 + 可选邮件提醒
 * 视觉对齐原站「暖金古韵」主题 + 沿用 jiankong1 配色。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { ScreenCapture } from '@/services/screenCapture'
import { Jk4Engine, type Jk4Config, type Jk4NormDet } from '@/services/jiankong4Logic'
import { loadJk4Model, clearJk4ModelCache, getJk4ModelSource } from '@/services/jiankong4Yolo'
import { playAlarm, initAudio, previewTone, SOUND_OPTIONS, type AlertSoundType } from '@/services/jiankongLogic'
import { pushWecom, isValidWecomWebhook, pushPushPlus, isValidPushPlusToken, pushQqMail, isValidQqNumber, type PushResult } from '@/services/jiankong4Notify'
import RegionPicker from '@/components/jiankong/RegionPicker.vue'
import { useJk4Store } from '@/stores/jiankong4Store'

const store = useJk4Store()
const sc = new ScreenCapture()
const regionPickerRef = ref<InstanceType<typeof RegionPicker> | null>(null)
const previewSrc = ref('')
const auditioning = ref(false)
/** 当前帧 YOLO 检测框（归一化全屏坐标，供画面叠加） */
const detDets = ref<Jk4NormDet[]>([])

let engine: Jk4Engine | null = null
let previewTimer: number | null = null

/* ---------- 模型预加载 ---------- */
async function loadModel() {
  store.setModelStatus('loading', 0)
  try {
    await loadJk4Model(
      {},
      (p) => store.setModelStatus('loading', Math.round(p * 100)),
      (s) => store.setModelStatus('loading', store.modelProgress, s)
    )
    store.setModelStatus('ready', 100, getJk4ModelSource())
  } catch (e) {
    store.setModelStatus('error', 0, null, (e as Error)?.message || '模型加载失败')
  }
}
async function reloadModel() {
  try {
    await clearJk4ModelCache()
  } catch {
    /* ignore */
  }
  await loadModel()
}

/* ---------- 预览循环 ---------- */
function startPreviewLoop() {
  previewTimer = window.setInterval(() => {
    if (!sc.isActive()) return
    const f = sc.getPreviewFrame()
    if (f) previewSrc.value = f
  }, 120)
}
function stopPreviewLoop() {
  if (previewTimer !== null) {
    clearInterval(previewTimer)
    previewTimer = null
  }
}

/* ---------- 屏幕共享 ---------- */
async function startShare() {
  const ok = await sc.start()
  if (ok) {
    store.setSharing(true)
    startPreviewLoop()
    store.setStatus('游戏窗口共享成功，请点击「开始监控」开启自动战斗框检测', '#2c8a3a')
  } else {
    store.setStatus('屏幕共享失败（需 HTTPS / localhost 且浏览器支持 getDisplayMedia）', '#c0392b')
  }
}
function stopShare() {
  stopMonitor()
  stopPreviewLoop()
  sc.stop()
  store.setSharing(false)
  previewSrc.value = ''
  store.setStatus('共享已停止', '#6b5744')
}

/* ---------- 把相对比例换算成视频实际分辨率坐标 ---------- */
function buildRegion() {
  // 未开启「限定监控区域」时整屏检测，红框不生效
  if (!store.config.limitRegion) return null
  const size = sc.getVideoSize()
  const r = regionPickerRef.value?.getRegionRatio()
  if (!size || !r) return null
  if (r.w < 0.02 || r.h < 0.02) return null
  return {
    x: Math.floor(r.x * size.width),
    y: Math.floor(r.y * size.height),
    width: Math.floor(r.w * size.width),
    height: Math.floor(r.h * size.height)
  }
}

/* ---------- 监控控制 ---------- */
function startMonitor() {
  if (!sc.isActive()) {
    store.setStatus('请先开始屏幕共享', '#c0392b')
    return
  }
  if (!isJk4Ready()) {
    store.setStatus('模型尚未就绪，请等待模型加载完成', '#c0392b')
    return
  }
  // 在点击手势内预热音频上下文，避免报警音被浏览器自动播放策略拦截
  initAudio()
  const cfg: Jk4Config = { ...store.config }
  engine = new Jk4Engine(sc, cfg, {
    onStatus: (t, c) => store.setStatus(t, c),
    onAlert: () => store.incAlert(),
    onNotify: (reason) => {
      void pushToSelected('自动战斗监控告警', reason).then((err) => {
        if (err) store.setStatus(`推送失败 → ${err}`, '#c0392b')
      })
    },
    onDetect: (normDets, abCount, fpCount) => {
      detDets.value = normDets
      store.setCounts(abCount, fpCount)
    },
    onError: (m) => store.setStatus(m, '#c0392b')
  })
  engine.start(buildRegion())
  store.setMonitoring(true)
  store.setStatus('已开启自动战斗框检测，框消失时将播放预警', '#2c8a3a')
}

function stopMonitor() {
  if (engine) {
    engine.stop()
    engine = null
  }
  detDets.value = []
  store.setCounts(0, 0)
  store.setMonitoring(false)
  store.setStatus('已停止监控，不再播放预警', '#6b5744')
}

/* ---------- 点击音色即选中并试听（替代原「预警音色」下拉框） ---------- */
function selectTone(type: AlertSoundType) {
  store.config.soundType = type
  previewTone(type)
}

/* ---------- 消息推送：按选中的单一渠道推送 ---------- */
async function pushToSelected(title: string, body: string): Promise<string | null> {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false })
  const ch = store.config.pushChannel
  let r: PushResult
  if (ch === 'wecom') {
    const url = store.config.wecom.webhook.trim()
    if (!isValidWecomWebhook(url)) return '企业微信：webhook 地址不合法（需 qyapi.weixin.qq.com 且含 key=）'
    r = await pushWecom(url, `【${title}】\n${body}\n时间：${ts}`)
  } else if (ch === 'pushplus') {
    const token = store.config.pushplus.token.trim()
    if (!isValidPushPlusToken(token)) return 'PushPlus：token 为空'
    r = await pushPushPlus(token, title, `【${title}】<br/>${body}<br/>时间：${ts}`)
  } else {
    const qq = store.config.qqmail.qq.trim()
    if (!isValidQqNumber(qq)) return 'QQ 邮箱：QQ 号不合法（5~12 位纯数字）'
    r = await pushQqMail(qq, title, `${body}\n时间：${ts}`, store.config.qqmail.mailApi)
  }
  if (r.ok) {
    store.incPush()
    return null
  }
  return r.err || '未知错误'
}

/* ---------- 消息推送：测试推送（发给选中的渠道） ---------- */
const pushTesting = ref(false)
async function testPush() {
  pushTesting.value = true
  try {
    const err = await pushToSelected('自动战斗监控·测试', '这是一条测试推送，收到说明配置正确。')
    if (err) store.setStatus(`推送失败 → ${err}`, '#c0392b')
    else store.setStatus('✅ 测试消息已发送，请查收（企业微信为 no-cors，以实际收到为准）', '#2c8a3a')
  } finally {
    pushTesting.value = false
  }
}

/* ---------- 试听预警音（手势内触发，兼预热音频上下文） ---------- */
function previewSound() {
  initAudio()
  auditioning.value = true
  playAlarm(store.config.soundType, store.config.playTimes)
  store.setStatus('🔊 试听播放中，请检查音量', '#2c8a3a')
  // mp3 提示音约 1~3 秒，按连播次数估算试听按钮复位时间
  const secsPerPlay = store.config.soundType === 'beep' ? 0.25 : 2.5
  window.setTimeout(() => {
    auditioning.value = false
  }, Math.max(1500, store.config.playTimes * secsPerPlay * 1000))
}

function isJk4Ready() {
  return store.modelStatus === 'ready'
}

/* 标签页重新可见时补一帧 */
function onVisible() {
  if (!document.hidden && store.isMonitoring) engine?.poke()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  void loadModel()
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
  stopMonitor()
  stopPreviewLoop()
  sc.stop()
})
</script>

<template>
  <div class="jiankong4-page">
    <header class="jk-header">
      <h1>🥊 自动战斗监控</h1>
      <p class="jk-desc">实时检测游戏画面中的自动战斗框，消失时播放预警；推送支持企业微信 / PushPlus / QQ邮箱，单选其一、配置自动记忆</p>
      <p class="jk-warn">⚠️ 不能最小化运行！挂机时自动战斗框消失（掉线/战斗结束/卡死）会立即提醒</p>
    </header>

    <div class="jk-main">
      <!-- 左：画面 + 选框（通用监控红框） -->
      <div class="jk-left">
        <div class="game-video-container">
          <RegionPicker :preview-src="previewSrc" :dets="detDets" :show-boxes="store.config.showBoxes" ref="regionPickerRef" />
        </div>
        <p class="jk-hint">
          默认整屏检测「自动战斗框」无需框选；勾选「限定监控区域」后，红框内即为检测范围（聚焦游戏窗口、更快更准）。红框同时仍可用于「通用监控」的像素变化报警。
        </p>
        <div class="legend" v-if="store.config.showBoxes">
          <span><i class="dot ab"></i>自动战斗</span>
          <span><i class="dot fp"></i>四小人</span>
          <span><i class="dot other"></i>其它（回合等）</span>
        </div>
      </div>

      <!-- 右：控制面板 -->
      <aside class="jk-right param-setting">
        <h3>🎛 监控设置</h3>

        <!-- 模型状态条 -->
        <div class="model-status-wrap" :class="store.modelStatus">
          <template v-if="store.modelStatus === 'loading'">
            <span class="ms-dot loading"></span>
            <span>模型加载中… {{ store.modelProgress }}%</span>
            <span class="ms-bar"><i :style="{ width: store.modelProgress + '%' }"></i></span>
          </template>
          <template v-else-if="store.modelStatus === 'ready'">
            <span class="ms-dot ok"></span>
            <span>模型已就绪（{{ store.modelSource === 'cache' ? '浏览器缓存' : '本次下载' }}）</span>
          </template>
          <template v-else-if="store.modelStatus === 'error'">
            <span class="ms-dot err"></span>
            <span>模型加载失败：{{ store.modelError }}</span>
            <button class="ms-reload" @click="reloadModel">重新加载模型</button>
          </template>
          <template v-else>
            <span class="ms-dot"></span>
            <span>模型未加载</span>
          </template>
        </div>

        <div class="param-item">
          <label>自动战斗框消失报警</label>
          <input type="checkbox" v-model="store.config.enableAlert" class="switch" />
        </div>
        <div class="param-item">
          <label>四小人出现报警（负面）</label>
          <input type="checkbox" v-model="store.config.enableFourPeopleAlert" class="switch" />
        </div>
        <p class="ctrl-hint">四小人是负面信号：与「自动战斗框消失才报警」相反，只要 YOLO 检测到四小人框就视为异常，连续「判定帧数」帧出现即播放预警音。</p>
        <div class="param-item">
          <label>播放次数</label>
          <input type="number" v-model.number="store.config.playTimes" min="1" max="10" step="1" />
        </div>
        <div class="param-item param-col">
          <label>预警音色（点击下方音色即可选中并试听）</label>
          <div class="tone-row">
            <button
              v-for="o in SOUND_OPTIONS"
              :key="o.value"
              class="tone-btn"
              :class="{ active: store.config.soundType === o.value }"
              @click="selectTone(o.value)"
            >
              {{ o.label.replace(/（.*）/, '') }}
            </button>
          </div>
          <span class="ctrl-hint">配对已按实测试听确认：①少女 / ②秘书 / ③老表(广西口音) / ④铃声(原站默认) / ⑤铃声。点亮即选中，报警时直接播放该音色。</span>
        </div>
        <div class="param-item param-col">
          <button class="btn btn-ghost audition-btn" :class="{ playing: auditioning }" @click="previewSound">
            🔊 {{ auditioning ? '试听播放中…' : '试听预警音' }}
          </button>
          <span class="ctrl-hint">点击即播放当前所选音色（也用于验证声音是否正常）</span>
        </div>

        <div class="divider"></div>

        <div class="param-item">
          <label>显示 YOLO 检测框</label>
          <input type="checkbox" v-model="store.config.showBoxes" class="switch" />
        </div>
        <div class="param-item">
          <label>自动战斗框数量监控</label>
          <input type="checkbox" v-model="store.config.enableCountAlert" class="switch" />
        </div>
        <div class="param-item" v-if="store.config.enableCountAlert">
          <label>目标数量（少于才报警）</label>
          <input type="number" v-model.number="store.config.targetAutoBattleCount" min="0" max="20" step="1" />
        </div>
        <div class="param-item">
          <label>自动战斗框置信度</label>
          <input type="number" v-model.number="store.config.autoBattleConf" min="0.1" max="0.99" step="0.05" />
        </div>
        <div class="param-item">
          <label>四小人置信度</label>
          <input type="number" v-model.number="store.config.fourPeopleConf" min="0.1" max="0.99" step="0.05" />
        </div>
        <div class="param-item">
          <label>判定帧数</label>
          <input type="number" v-model.number="store.config.missFrames" min="1" max="60" step="1" />
        </div>
        <p class="ctrl-hint">阈值越高越严格；「判定帧数」= 连续多少帧异常才报警（防抖）。全屏多窗口挂机时关闭「限定监控区域」即可整屏计数。</p>

        <div class="divider"></div>

        <div class="param-item">
          <label>限定监控区域</label>
          <input type="checkbox" v-model="store.config.limitRegion" class="switch" />
        </div>
        <p class="ctrl-hint">开启后仅检测左侧红框内（聚焦游戏窗口、更快更准）；默认整屏检测</p>

        <div class="divider"></div>

        <div class="param-item">
          <label>开启通用监控</label>
          <input type="checkbox" v-model="store.config.enableGeneric" class="switch" />
        </div>
        <div class="param-item" v-if="store.config.enableGeneric">
          <label>变化阈值 (%)</label>
          <input type="number" v-model.number="store.config.genericThreshold" min="0" max="100" step="1" />
        </div>

        <div class="divider"></div>

        <p class="push-title">📢 消息推送（选择一个渠道）</p>

        <div class="param-item">
          <label>开启消息推送</label>
          <input type="checkbox" v-model="store.config.enablePush" class="switch" />
        </div>

        <div class="param-item param-col" v-if="store.config.enablePush">
          <label>推送渠道</label>
          <div class="channel-radios">
            <label class="radio-item">
              <input type="radio" value="wecom" v-model="store.config.pushChannel" /> 企业微信群机器人
            </label>
            <label class="radio-item">
              <input type="radio" value="pushplus" v-model="store.config.pushChannel" /> PushPlus（个人微信）
            </label>
            <label class="radio-item">
              <input type="radio" value="qqmail" v-model="store.config.pushChannel" /> QQ 邮箱
            </label>
          </div>
          <span class="ctrl-hint">
            三种渠道凭据各自独立保存，切换不会丢失；报警时只推送到你选中的那一个。配置自动记在本机，下次打开无需重填。
          </span>
        </div>

        <div class="param-item param-col" v-if="store.config.enablePush && store.config.pushChannel === 'wecom'">
          <label>群机器人 Webhook 地址</label>
          <input type="text" v-model="store.config.wecom.webhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx" />
          <span class="ctrl-hint">企业微信「群聊 → 添加群机器人」复制 Webhook 粘贴此处。免费、无条数限制，消息进「企业微信」App。</span>
        </div>

        <div class="param-item param-col" v-if="store.config.enablePush && store.config.pushChannel === 'pushplus'">
          <label>PushPlus Token</label>
          <input type="text" v-model="store.config.pushplus.token" placeholder="pushplus.plus 个人中心复制的 token" />
          <span class="ctrl-hint">注册 pushplus.plus → 实名认证 → 个人中心复制 token。消息进微信公众号，个人微信直接收（免费实名每天 200 条）。</span>
        </div>

        <div class="param-item param-col" v-if="store.config.enablePush && store.config.pushChannel === 'qqmail'">
          <label>接收提醒的 QQ 号</label>
          <input type="text" v-model="store.config.qqmail.qq" placeholder="例如 123456789" maxlength="12" />
          <span class="ctrl-hint">只需填 QQ 号，邮件发往「QQ号@qq.com」（与原站一致）。发件邮箱与授权码只配在后端，浏览器不接触邮箱密码。</span>
        </div>

        <div class="param-item param-col" v-if="store.config.enablePush">
          <button class="btn btn-ghost wecom-test" :class="{ playing: pushTesting }" :disabled="pushTesting" @click="testPush">
            {{ pushTesting ? '发送中…' : '🔔 发送测试消息（发给选中的渠道）' }}
          </button>
        </div>

        <div class="btn-group">
          <button v-if="!store.isSharing" class="btn btn-primary" @click="startShare">▶ 开始屏幕共享</button>
          <template v-else>
            <button v-if="!store.isMonitoring" class="btn btn-success" @click="startMonitor">▶ 开始监控</button>
            <button v-else class="btn btn-danger" @click="stopMonitor">⏸ 停止监控</button>
            <button class="btn btn-ghost" @click="stopShare">⏹ 停止共享</button>
          </template>
        </div>

        <div class="status-box">
          <div class="status-tip" :style="{ color: store.statusColor }">{{ store.statusText }}</div>
        </div>

        <div class="counts" v-if="store.isMonitoring">
          当前检测：<span class="c-ab">🟢 自动战斗 <b>{{ store.autoBattleCount }}</b></span>
          · <span class="c-fp">🟠 四小人 <b>{{ store.fourPeopleCount }}</b></span>
          <span v-if="store.config.enableCountAlert">（目标 {{ store.config.targetAutoBattleCount }}）</span>
        </div>

        <div class="rate" v-if="store.isMonitoring">
          累计报警 <b>{{ store.alertCount }}</b> 次
          <span v-if="store.config.enablePush && store.pushSentCount > 0" class="email-tip">
            · 已推送 <b>{{ store.pushSentCount }}</b> 次
          </span>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.jiankong4-page {
  --site-primary: #b8860b;
  --site-primary-hover: #96700a;
  --site-bg: #f0ebe1;
  --site-surface: #fffdf7;
  --site-surface-alt: #f5ede0;
  --site-text: #2c1810;
  --site-text-secondary: #5c4033;
  --site-text-muted: #6b5744;
  --site-border: rgba(180, 150, 100, 0.4);
  --site-border-light: rgba(180, 150, 100, 0.28);
  --site-panel-bg: linear-gradient(165deg, #fdf8ef 0%, #f5ede0 42%, #ede6d8 100%);
  --site-panel-shadow: rgba(100, 70, 20, 0.14);

  max-width: 1400px;
  margin: 0 auto;
  padding: 22px;
  color: var(--site-text);
  background: var(--site-bg);
  min-height: 100vh;
  font-family: 'Microsoft Yahei', Inter, system-ui, -apple-system, 'PingFang SC', sans-serif;
  box-sizing: border-box;
  /* 整个页面锁定浅色配色，避免系统深色模式下浏览器自动反色导致文字不可读 */
  color-scheme: light;
}
.jiankong4-page * {
  box-sizing: border-box;
}

.jk-header {
  margin-bottom: 18px;
}
.jk-header h1 {
  font-size: 22px;
  color: var(--site-primary);
  font-weight: 700;
  margin: 0 0 8px;
}
.jk-desc {
  font-size: 14px;
  color: var(--site-text-secondary);
  margin: 0 0 6px;
  line-height: 1.6;
}
.jk-warn {
  font-size: 13px;
  color: #c0392b;
  margin: 0;
  font-weight: 600;
}

.jk-main {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.jk-left {
  flex: 1;
  min-width: 0;
}
.game-video-container {
  border-radius: 12px;
  overflow: hidden;
}
.jk-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--site-text-muted);
  line-height: 1.6;
}
.legend {
  margin-top: 8px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--site-text-secondary);
  align-items: center;
}
.legend .dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: middle;
}
.legend .dot.ab {
  background: #42b983;
}
.legend .dot.fp {
  background: #ff9800;
}
.legend .dot.other {
  background: #3aa0ff;
}

.jk-right {
  width: 320px;
  flex-shrink: 0;
  background: var(--site-panel-bg);
  border: 1px solid rgba(180, 130, 50, 0.14);
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 8px 24px var(--site-panel-shadow);
}
.jk-right h3 {
  color: var(--site-primary);
  font-size: 16px;
  margin: 0 0 16px;
}

/* 模型状态条 */
.model-status-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 16px;
  background: var(--site-surface);
  border: 1px solid var(--site-border-light);
  color: var(--site-text-secondary);
}
.model-status-wrap.ready {
  color: #2c8a3a;
}
.model-status-wrap.error {
  color: #c0392b;
}
.model-status-wrap .ms-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #aaa;
  flex-shrink: 0;
}
.model-status-wrap .ms-dot.loading {
  background: #d9842b;
  animation: blink 1s infinite;
}
.model-status-wrap .ms-dot.ok {
  background: #2c8a3a;
}
.model-status-wrap .ms-dot.err {
  background: #c0392b;
}
.model-status-wrap .ms-bar {
  flex: 1;
  height: 4px;
  background: var(--site-border-light);
  border-radius: 2px;
  overflow: hidden;
}
.model-status-wrap .ms-bar i {
  display: block;
  height: 100%;
  background: var(--site-primary);
  transition: width 0.2s;
}
.model-status-wrap .ms-reload {
  margin-left: auto;
  border: none;
  background: var(--site-primary);
  color: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
@keyframes blink {
  50% {
    opacity: 0.3;
  }
}

.param-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}
.param-item label {
  font-size: 13px;
  color: var(--site-text-secondary);
  white-space: nowrap;
}
.param-item input[type='text'],
.param-item input[type='number'],
.param-item select {
  flex: 1;
  max-width: 160px;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  color: var(--site-text);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  /* 锁定浅色：防止浏览器自动深色模式把输入框背景反色，导致深底深字看不清 */
  color-scheme: light;
}
.param-item input[type='text']:focus,
.param-item input[type='number']:focus,
.param-item select:focus {
  outline: none;
  border-color: var(--site-primary);
}
.param-item input::placeholder {
  color: var(--site-text-muted);
  opacity: 0.8;
}
.param-col {
  flex-direction: column;
  align-items: stretch;
}
.param-col label {
  margin-bottom: 6px;
}
.param-col input {
  max-width: none;
  width: 100%;
}
.ctrl-hint {
  font-size: 11px;
  color: var(--site-text-muted);
  margin: -6px 0 14px;
  line-height: 1.4;
}
.divider {
  height: 1px;
  background: var(--site-border-light);
  margin: 6px 0 14px;
}
.push-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--site-primary);
  margin: 0 0 12px;
}
.channel-radios {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.radio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--site-text-secondary);
  white-space: nowrap;
  cursor: pointer;
}
.radio-item input[type='radio'] {
  accent-color: var(--site-primary);
  width: 16px;
  height: 16px;
}
.switch {
  width: 18px;
  height: 18px;
  accent-color: var(--site-primary);
}

.btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}
.btn-primary {
  background: var(--site-primary);
  color: #fff;
}
.btn-primary:hover {
  background: var(--site-primary-hover);
}
.btn-success {
  background: linear-gradient(135deg, #c49b2a, #b8860b);
  color: #fff;
}
.btn-success:hover {
  filter: brightness(0.95);
}
.btn-danger {
  background: #c0392b;
  color: #fff;
}
.btn-danger:hover {
  background: #a93226;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--site-border);
  color: var(--site-text-secondary);
}
.btn-ghost:hover {
  color: var(--site-text);
  border-color: var(--site-text-muted);
}
.audition-btn {
  width: 100%;
  justify-content: center;
  background: var(--site-surface);
  border: 1px solid var(--site-primary);
  color: var(--site-primary);
}
.audition-btn.playing {
  background: var(--site-primary);
  color: #fff;
}
.wecom-test {
  width: 100%;
  justify-content: center;
  margin-top: 8px;
}
.wecom-test:disabled {
  opacity: 0.6;
  cursor: default;
}
.tone-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}
.tone-btn {
  border: 1px solid var(--site-border);
  background: var(--site-surface);
  color: var(--site-text-secondary);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.tone-btn:hover {
  border-color: var(--site-primary);
  color: var(--site-primary);
}
.tone-btn.active {
  background: var(--site-primary);
  border-color: var(--site-primary);
  color: #fff;
}

.status-box {
  margin-top: 14px;
  background: var(--site-surface);
  border: 1px solid var(--site-border-light);
  border-radius: 8px;
  padding: 10px 12px;
}
.status-tip {
  font-size: 13px;
  line-height: 1.5;
}
.counts {
  margin-top: 10px;
  font-size: 13px;
  color: var(--site-text-secondary);
  line-height: 1.6;
}
.counts .c-ab b {
  color: #2c8a3a;
}
.counts .c-fp b {
  color: #d9842b;
}
.rate {
  margin-top: 10px;
  font-size: 13px;
  color: var(--site-text-muted);
}
.email-tip {
  color: #c0392b;
}

@media (max-width: 860px) {
  .jk-main {
    flex-direction: column;
  }
  .jk-right {
    width: 100%;
  }
}
</style>
