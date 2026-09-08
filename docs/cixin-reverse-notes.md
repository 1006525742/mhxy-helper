# 抓鬼的画中画就可以

## 结论

对方网站是 **「浏览器前端识别 + 后端只做 Othello 求解」** 架构。屏幕共享捕获游戏画面，浏览器端纯 Canvas CV 识别 8×8 棋盘，仅把 `board` 数组 POST 给后端 AI 求解；**后端不接收任何图片**。

这与本项目的移植版（mhxy-helper 慈心模块）架构完全一致。

---

## 1. 屏幕共享（ScreenSharePanel）

- 屏幕共享：`navigator.mediaDevices.getDisplayMedia({video:{width:{ideal},height:{ideal},frameRate:{ideal:15}},audio:false})`
- 摄像头模式（备用）：`navigator.mediaDevices.getUserMedia({video:{...},audio:false})`
- 抓帧：`ImageCapture.grabFrame()` 或 `drawImage` 到离屏 `<canvas>`；流挂到 `<video>.srcObject`
- 支持画中画（Picture-in-Picture）浮窗显示

## 2. 前端识别（CixinOthelloView，纯 Canvas CV，无模型）

- 视频帧 `drawImage` → `getImageData`
- 多尺度候选矩形搜索棋盘区域（暖色占比过滤），逐格分类成 `board[64]`（-1/0/1）
- 暖色判定阈值（**与我们 `cixinDetect.ts` 移植的一模一样**）：
  ```js
  function A(e, t, n) { return e > 90 && e > t * 1.07 && t > n * 1.08 && n < 185 }
  ```
- 输出 `board` 数组，前端小棋盘实时预览
- **手动校准**：overlay canvas 上拖拽框选 8×8（`overlay-canvas--calibrating` + `onPointerdown`），说明自动识别也可能不稳，提供人工校正

## 3. 传输给后端（othelloGame.js）

```js
// 仅发送 board 数组，不发图片
function n(t, n = {}) { return e.post(`/api/othello/move`, t, {signal: n.signal, timeout: 12e4}) }
function t(t = {}) { return e.get(`/api/othello/status`, {signal: t.signal, timeout: 15e3}) }
```

- base：`https://mhxyai.com/v2`（`apiBaseUrl`）
- 强度档（前端拼参传给后端）：
  ```js
  strong: { timeMs: 1200, maxDepth: 10 }
  ultra:  { timeMs: 1500, maxDepth: 12 }
  ```

## 4. 后端返回 → 地图标点

- 后端返回落点 `action` → 前端 `ge(action)` 查 `he` 坐标表（12 张地图 8×8，与本项目 `coordinate_map.py` 同构）
- 地图标红点 marker（来自 `zhuaguiMapDraw`，`markerRadius: 12`），预览图 `r.toDataURL('image/jpeg', .9)`

---

## 与我们移植版（mhxy-helper 慈心）对比

| 环节 | mhxyai 原站                        | 本项目移植版                   |
| -- | -------------------------------- | ------------------------ |
| 共享 | getDisplayMedia / getUserMedia   | 前端屏幕共享（同）                |
| 识别 | 前端 Canvas CV，暖色阈值                | `cixinDetect.ts` 移植同款阈值  |
| 传输 | POST board → `/api/othello/move` | 同（端口 8005）               |
| 求解 | 后端 alpha-beta + 权重               | `solver.py` 同构（加残局穷举）    |
| 坐标 | `he` + `ge()`                    | `coordinate_map.py` 逆向同表 |
| 校准 | 手动拖框 + 画中画                       | 暂无（强度滑块代替）               |

## 关于「视觉小模型识别」话术

首页声明「技术基于视觉小模型识别」，但**慈心模块实际是无模型纯阈值 CV**。该话术应指其 OCR 类模块（如抓鬼 `POST /api/ZhuaguiOCR` 后端 OCR）。慈心与本移植版均不依赖 AI 模型。
