<script setup lang="ts">
import { ref, onMounted } from 'vue'

// 本管理页为内部使用，直连本机 backend_notify(8011)。
// 如需从其他机器访问，可改此处地址（需后端已开启 CORS）。
const API_BASE = 'http://127.0.0.1:8011'

function setStatus(msg: string, color = '#333') {
  status.value = msg
  statusColor.value = color
}

const status = ref('')
const statusColor = ref('#333')

interface Receiver { name: string; openid: string }
const receivers = ref<Receiver[]>([])
const followers = ref<string[]>([])
const loadingFollowers = ref(false)

// 新增表单
const newName = ref('')
const newOpenid = ref('')
// 每个关注者对应的备注名输入
const followNameMap = ref<Record<string, string>>({})
// 测试发送
const testing = ref(false)

async function loadReceivers() {
  try {
    const resp = await fetch(API_BASE + '/api/wechat/receivers/detail')
    const data = await resp.json().catch(() => null)
    if (data && data.success) {
      receivers.value = data.receivers || []
    } else {
      setStatus('加载接收人失败 → ' + (data?.msg || '未知错误'), '#c0392b')
    }
  } catch (e) {
    setStatus('加载接收人失败 → ' + ((e as Error)?.message || 'network error'), '#c0392b')
  }
}

async function addReceiver(name: string, openid: string) {
  name = (name || '').trim()
  openid = (openid || '').trim()
  if (!name || !openid) {
    setStatus('备注名与 openid 均不能为空', '#c0392b')
    return
  }
  try {
    const resp = await fetch(API_BASE + '/api/wechat/receiver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, openid })
    })
    const data = await resp.json().catch(() => null)
    if (data && data.success) {
      setStatus(`已登记接收人「${name}」`, '#2c8a3a')
      newName.value = ''
      newOpenid.value = ''
      await loadReceivers()
    } else {
      setStatus('登记失败 → ' + (data?.msg || '未知错误'), '#c0392b')
    }
  } catch (e) {
    setStatus('登记失败 → ' + ((e as Error)?.message || 'network error'), '#c0392b')
  }
}

async function delReceiver(name: string) {
  try {
    const resp = await fetch(API_BASE + '/api/wechat/receiver?name=' + encodeURIComponent(name), {
      method: 'DELETE'
    })
    const data = await resp.json().catch(() => null)
    if (data && data.success) {
      setStatus(`已删除接收人「${name}」`, '#2c8a3a')
      await loadReceivers()
    } else {
      setStatus('删除失败 → ' + (data?.msg || '未知错误'), '#c0392b')
    }
  } catch (e) {
    setStatus('删除失败 → ' + ((e as Error)?.message || 'network error'), '#c0392b')
  }
}

async function refreshFollowers() {
  loadingFollowers.value = true
  try {
    const resp = await fetch(API_BASE + '/api/wechat/followers')
    const data = await resp.json().catch(() => null)
    if (data && data.success) {
      followers.value = data.openids || []
      // 初始化备注名输入（默认区服-xxxxxx 提示由 placeholder 提供）
      const m: Record<string, string> = {}
      for (const oid of followers.value) m[oid] = followNameMap.value[oid] || ''
      followNameMap.value = m
      if (followers.value.length === 0) {
        setStatus('当前没有已关注的微信用户，请对方先扫描测试号二维码关注', '#c0392b')
      } else {
        setStatus(`已拉取 ${followers.value.length} 个关注者，为未登记的填写备注名后点添加`, '#2c8a3a')
      }
    } else {
      setStatus('拉取关注列表失败 → ' + (data?.msg || '未知错误'), '#c0392b')
    }
  } catch (e) {
    setStatus('拉取关注列表失败 → ' + ((e as Error)?.message || 'network error'), '#c0392b')
  } finally {
    loadingFollowers.value = false
  }
}

async function testSend(name: string) {
  const n = (name || '').trim()
  if (!n) {
    setStatus('请填写要测试的接收人备注名', '#c0392b')
    return
  }
  testing.value = true
  try {
    const resp = await fetch(API_BASE + '/api/notify/wechat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiver: n, title: '自动战斗监控告警', content: '这是一条管理页测试消息', time: new Date().toLocaleString('zh-CN') })
    })
    const data = await resp.json().catch(() => null)
    if (data && data.success) {
      setStatus(`测试发送成功 → 已送达「${n}」（msgid: ${data.msgid}）`, '#2c8a3a')
    } else {
      setStatus('测试发送失败 → ' + (data?.msg || '未知错误'), '#c0392b')
    }
  } catch (e) {
    setStatus('测试发送失败 → ' + ((e as Error)?.message || 'network error'), '#c0392b')
  } finally {
    testing.value = false
  }
}

onMounted(loadReceivers)
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>微信推送接收人管理</h1>
      <p class="sub">本页仅供管理员本地维护「备注名 → openid」映射。外网用户只需在监控页填写自己的备注名，看不到 openid。</p>
    </header>

    <div class="status" :style="{ color: statusColor }" v-if="status">{{ status }}</div>

    <!-- 已登记接收人 -->
    <section class="card">
      <h2>已登记接收人</h2>
      <table v-if="receivers.length">
        <thead>
          <tr><th>备注名</th><th>openid</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in receivers" :key="r.name">
            <td>{{ r.name }}</td>
            <td class="oid">{{ r.openid }}</td>
            <td class="ops">
              <button class="btn small" @click="testSend(r.name)" :disabled="testing">测试</button>
              <button class="btn small danger" @click="delReceiver(r.name)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无接收人。请在下方添加，或从关注列表导入。</p>
    </section>

    <!-- 手动新增 -->
    <section class="card">
      <h2>新增接收人</h2>
      <div class="form-row">
        <input type="text" v-model="newName" placeholder="备注名，如 区服-123456" />
        <input type="text" v-model="newOpenid" placeholder="openid（关注测试号后由 /api/wechat/followers 获取）" />
        <button class="btn primary" @click="addReceiver(newName, newOpenid)">添加</button>
      </div>
      <p class="hint">备注名建议格式：<code>区服-xxxxxx</code>，方便外网用户识别并填写。</p>
    </section>

    <!-- 从关注列表导入 -->
    <section class="card">
      <h2>从关注列表导入</h2>
      <button class="btn ghost" @click="refreshFollowers" :disabled="loadingFollowers">
        {{ loadingFollowers ? '拉取中…' : '🔄 刷新关注列表' }}
      </button>
      <div v-if="followers.length" class="followers">
        <div class="follower" v-for="oid in followers" :key="oid">
          <span class="oid">{{ oid }}</span>
          <input type="text" v-model="followNameMap[oid]" placeholder="备注名，如 区服-123456" />
          <button class="btn small primary" @click="addReceiver(followNameMap[oid], oid)">添加</button>
        </div>
      </div>
      <p v-else-if="!loadingFollowers" class="hint">点「刷新关注列表」可拉取当前已关注测试号的用户 openid，逐个填写备注名后添加。</p>
    </section>

    <footer class="foot">
      模板 ID 固定写于后端（无需前端填写）。告警文案首行展示标题+内容+时间，多余字段微信自动忽略。
    </footer>
  </div>
</template>

<style scoped>
.page { max-width: 920px; margin: 0 auto; padding: 24px 18px 60px; color: #1d2129; }
.head h1 { font-size: 22px; margin: 0 0 6px; }
.sub { color: #6b7280; font-size: 13px; margin: 0; }
.status { margin: 14px 0; padding: 10px 12px; background: #f3f4f6; border-radius: 8px; font-size: 14px; }
.card { background: #fff; border: 1px solid #eceef0; border-radius: 12px; padding: 16px 18px; margin-top: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.card h2 { font-size: 16px; margin: 0 0 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #f0f0f0; }
.oid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #374151; word-break: break-all; }
.ops { white-space: nowrap; }
.empty, .hint { color: #8a9099; font-size: 13px; }
.form-row { display: flex; gap: 10px; flex-wrap: wrap; }
.form-row input { flex: 1; min-width: 220px; }
input[type='text'] {
  padding: 9px 11px; border: 1px solid #d9dde2; border-radius: 8px; font-size: 14px;
  color: #1d2129; background: #fff; outline: none;
}
input[type='text']:focus { border-color: #e6a23c; }
.btn {
  border: 1px solid #d9dde2; background: #fff; color: #1d2129; border-radius: 8px;
  padding: 9px 16px; font-size: 14px; cursor: pointer;
}
.btn:disabled { opacity: .6; cursor: default; }
.btn.primary { background: #e6a23c; border-color: #e6a23c; color: #fff; }
.btn.danger { background: #fff; border-color: #f56c6c; color: #f56c6c; }
.btn.ghost { background: #f7f8fa; }
.btn.small { padding: 5px 10px; font-size: 12px; }
.btn.small + .btn.small { margin-left: 6px; }
.followers { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.follower { display: flex; gap: 10px; align-items: center; }
.follower .oid { flex: 0 0 280px; }
.follower input { flex: 1; }
.foot { margin-top: 20px; color: #a0a6ad; font-size: 12px; }
</style>
