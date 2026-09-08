# 梦幻藏宝阁助手（Chrome 扩展）

在藏宝阁（`https://xyq.cbg.163.com/`）页面自动记录装备/角色的价格与成交历史，按用户隔离存储。
配套后端：`../backend/backend_cbg.py`（端口 **8009**，纯存储，按 `user_token` 隔离）。

## 它能做什么
- 浏览装备/角色**详情页** → 自动写入一条价格快照（现价 / 同类全服最低 / 状态），形成历史曲线。
- 在详情页点 **订阅本装备** → 加入盯价清单，可填目标价；弹窗里随时查看现价、同类最低、成交笔数与最低成交价，并能删除。
- 打开 **我的装备**（`act=my_equips`）→ 批量导入 listings 到清单。
- 成交记录区域若已渲染 → 抓取历史成交价。

## 安全模型（方案 B：用户各自授权）
1. 扩展**绝不**存储任何藏宝阁 cookie / 密码；登录态由用户在官网自己登录产生，cookie 留在浏览器里。
2. 每位用户一个随机 `user_token`（存于扩展 `chrome.storage.local`，本机隔离）。
3. 抓取只在用户浏览器内读取**已渲染 DOM**，结构化数据 POST 给 8009 后端落库；后端被攻破也拿不到任何凭证。
4. 不同 `user_token` 的数据在后端按 `user_token` 过滤，**互不可见**（已 curl 实测验证）。

## 加载步骤（开发者模式）
1. Chrome 打开 `chrome://extensions`，右上角打开 **开发者模式**。
2. 点 **加载已解压的扩展程序**，选择本目录 `cbg-extension/`。
3. 固定扩展图标到工具栏，方便点开弹窗。

## 启动后端
```bash
bash cbg-extension/start_cbg.sh
# 或
cd backend && python3 backend_cbg.py
```
依赖：`fastapi uvicorn pydantic`（系统 Python 已具备；缺则 `pip install fastapi uvicorn pydantic`）。
后端监听 `http://127.0.0.1:8009`。

## 使用流程
1. 在藏宝阁官网登录（扫码或账号，随你）。
2. 点开扩展弹窗：状态显示「已登录」即代表识别到登录态。
3. 随便逛一件装备详情页 → 弹窗里出现 **订阅本装备**；点一下即加入盯价。
4. 打开「我的装备」页面 → 自动批量导入你的 listings。
5. 弹窗「我的订阅」实时显示现价 / 同类最低 / 成交最低，可删。

## 校准 DOM 选择器（重要）
`content.js` 里的选择器（`#equip_name`、`.price`、`.num`、成交表格等）是按经验预设的，**需对照真实页面微调**：
1. 在藏宝阁页面按 `F12` → Console。
2. 输入 `__cbgDebug()` 重新提取并打印当前页识别到的字段（`ordersn` / 名称 / 现价 / 同类最低 / 成交）。
3. 打开 Network / Elements 核对真实 class / id，回来改 `content.js` 顶部对应选择器数组，刷新扩展即可。
4. 每次扫描也会在 Console 打印 `[CBG] scan {...}`，含 `window.__cbgLastScan` 可随时查看。

## 已知限制
- **签名占位**：藏宝阁部分 `act=ajax_*` 接口需 `verify`/`timestamp` 验签（163 混淆算法）。当前主链路走 DOM 抓取，**无需签名**；如需主动拉取接口，在 `bridge.js` 的 `sign()` 里复用页面自带签名对象（DevTools 里找 `window.NetEase.sign` 之类）。
- **URL 形态已兼容新旧两种**：老式详情页 `cgi-bin/equip.py?act=view&ordersn=&server_id=` 与**新版** `/equip?s=&eid=` 均已支持（商品 ID 取 `ordersn||eid`，服务器取 `server_id||s`）。
- **选择器待实测**：如上，真实 DOM 结构与预设可能不一致，首次使用请按上面步骤校准。
- **只有已渲染内容**：页面未渲染（懒加载/未展开）的数据抓不到，可点「扫描当前页」补扫或等 1.5s 自动补扫。

## 目录结构
```
cbg-extension/
├── manifest.json      MV3 声明（权限/注入/弹窗）
├── background.js      service worker：token 管理 + 中转上报 8009
├── content.js         页面上下文：登录检测 + DOM 抓取 + 上报 + 调试
├── bridge.js          注入页面的同源抓取器（postMessage 通信）
├── popup.html / popup.js  弹窗 UI：状态 / 扫描 / 订阅 / 清单
├── start_cbg.sh       一键启动 8009 后端
└── README.md          本文件
```
