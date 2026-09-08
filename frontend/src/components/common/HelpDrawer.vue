<template>
  <div>
    <button class="help-fab" @click="toggle" title="使用说明">
      <img src="/mhxy/static/help-btn.png" alt="使用说明" />
      <span class="help-fab-text">使用说明</span>
    </button>
    <div class="help-panel" :class="{ open }">
      <div class="help-header">
        <h3>{{ data.title }}</h3>
        <button class="help-close" @click="open = false" title="关闭">×</button>
      </div>
      <div class="help-body">
        <h4>简介</h4>
        <p>{{ data.intro }}</p>
        <h4>使用步骤</h4>
        <ol>
          <li v-for="(s, i) in data.steps" :key="i">{{ s }}</li>
        </ol>
        <h4>注意事项</h4>
        <p v-for="(t, i) in data.tips" :key="i" class="help-tip">{{ t }}</p>
        <div v-for="(t, ti) in data.tables || []" :key="ti" class="help-section">
          <h4>{{ t.title }}</h4>
          <table class="help-tbl">
            <thead>
              <tr><th v-for="(h, hi) in t.head" :key="hi">{{ h }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, ri) in t.rows" :key="ri">
                <td v-for="(c, ci) in r" :key="ci">{{ c }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'HelpDrawer',
  props: {
    moduleKey: { type: String, required: true }
  },
  data() {
    return { open: false };
  },
  computed: {
    data() {
      return (window.HELP_DATA && window.HELP_DATA[this.moduleKey]) || {};
    }
  },
  methods: {
    toggle() {
      this.open = !this.open;
    }
  }
};
</script>

<style scoped>
.help-fab{position:fixed;right:22px;bottom:22px;z-index:80;display:flex;align-items:center;gap:6px;padding:9px 14px;border-radius:22px;border:1px solid rgba(124,77,255,.5);background:rgba(22,18,40,.94);color:#efeaff;font-size:14px;font-weight:600;letter-spacing:1px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .2s,background .2s;backdrop-filter:blur(4px)}
.help-fab:hover{transform:scale(1.05);background:rgba(124,77,255,.18)}
.help-fab img{width:22px;height:22px;display:block;object-fit:contain}
.help-fab .help-fab-text{white-space:nowrap}
.help-panel{position:fixed;right:0;top:0;bottom:0;z-index:90;width:360px;max-width:92vw;height:100vh;background:#1a1530;border-left:2px solid #7c4dff;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s ease;box-shadow:-10px 0 40px rgba(0,0,0,.4);color:#e6e9f0}
.help-panel.open{transform:translateX(0)}
.help-header{display:flex;align-items:center;gap:8px;padding:14px 16px;background:#2a1f4a;border-bottom:1px solid #1a1530}
.help-header h3{margin:0;font-size:15px;color:#fff;font-weight:500}
.help-close{margin-left:auto;background:none;border:none;color:#cfc6ee;font-size:22px;line-height:1;cursor:pointer}
.help-body{padding:16px;overflow:auto}
.help-body h4{margin:18px 0 8px;color:#b69cff;font-size:13px;letter-spacing:1px}
.help-body p{margin:0 0 10px;line-height:1.7;font-size:13px;color:#d7d2ea}
.help-body ol{margin:0;padding-left:20px}
.help-body li{margin:0 0 8px;line-height:1.7;font-size:13px}
.help-tip{background:rgba(124,77,255,.08);border-left:3px solid #7c4dff;padding:8px 12px;border-radius:6px}
.help-section{margin-top:14px}
.help-tbl{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:12px}
.help-tbl th,.help-tbl td{border:1px solid #3a2f5a;padding:5px 8px;text-align:left;color:#d7d2ea}
.help-tbl th{background:#2a1f4a;color:#b69cff;font-weight:600}
</style>
