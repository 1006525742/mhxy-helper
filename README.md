# 梦幻西游助手 - 跨平台版

跨平台梦幻西游辅助工具，支持 Windows + macOS。包含科举答题、抓鬼助手、宝图助手。

## 功能

### 📝 科举答题 (`/mhxy/static/keju.html`)
- 屏幕共享截图 + 前端感知哈希图像匹配
- 82 条内置题库（hash-db.json），毫秒级秒答
- PP-OCRv6 文字识别兜底（后端 8001 端口）
- 用户众筹哈希数据收集（自动上报 + 合并脚本）
- 匹配结果按置信度排行，支持置信度阈值调节
- 窗口区域裁剪选择（题目区 / 选项区）

### 👻 抓鬼助手 (`/ghost`)
- 屏幕共享（`getDisplayMedia` API，跨平台）
- 模板匹配识别坐标（黄色文字提取 + 多尺度匹配）
- 抓鬼预测（象限区域标注）
- 识别历史记录

### 🗺️ 宝图助手 (`/baotu`)
- 屏幕共享
- ONNX YOLO 检测宝图（前端推理，跨平台）
- 背包格子显示（4行×5列）
- 坐标自动收集

## 运行架构

```
用户浏览器 (localhost:3000)
    │
    ├─→ Vite Dev Server (端口 3000)
    │       ├─ /mhxy/static/keju.html    科举页面
    │       ├─ /ghost                      抓鬼页面
    │       ├─ /baotu                      宝图页面
    │       ├─ /api/ocr/*         ──代理──→ OCR 后端 (端口 8001)
    │       └─ /api/hash-db/*     ──代理──→ OCR 后端 (端口 8001)
    │
    └─→ 游戏后端 (端口 8000) — main.py
            ├─ /api/recognize    模板匹配识别坐标
            ├─ /api/predict      抓鬼预测
            ├─ /api/maps         地图列表
            ├─ /api/templates    模板列表
            └─ /api/hash-db/collect  哈希众筹收集
```

**三个服务独立运行：**

| 服务 | 端口 | 进程 | 命令 |
|------|------|------|------|
| Vite 前端 | 3000 | node | `npm run dev` |
| 游戏后端 | 8000 | python | `python main.py` |
| OCR 后端 | 8001 | python (3.9) | `./start_keju.sh` |

## 启动命令

### 一键启动所有服务

OCR 后端必须在 **WorkBuddy 之外** 启动（沙箱会杀掉后台进程）。

**在 Terminal 里跑一次即可，关掉 Terminal 也不影响：**

```bash
cd /Users/zhy/mhxy-helper/backend && ./start_keju.sh
```

脚本内部用了 `nohup`，启动完就能关 Terminal。自动重启 + 重复启动检测。

停止 OCR 后端：
```bash
cat /tmp/keju_ocr.pid | xargs kill
```

### Python 版本注意事项

- **OCR 后端**：必须用 **系统 Python 3.9**（`/usr/bin/python3`），因为只有它有 rapidocr/fastapi 等依赖
- **3.13 venv** 没有安装 OCR 依赖，不能用
- 依赖列表：fastapi, uvicorn, python-multipart, opencv-python, numpy, pillow, rapidocr-onnxruntime

## API 文档

### 科举 OCR API（端口 8001）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/ocr/general` | POST | 通用 OCR 识别（PP-OCRv6） |
| `/api/ocr/options` | POST | 选项区域 OCR，返回坐标 |
| `/api/WatuOCR` | POST | WatuOCR 兼容端点 |
| `/api/hash-db/collect` | POST | 哈希库众筹收集 |

**POST /api/ocr/general**

multipart 上传图片，返回识别文本：
```json
{
  "success": true,
  "text": "识别的文字内容",
  "time_ms": 123.4
}
```

**POST /api/hash-db/collect**

用户哈希数据众筹上报：
```json
// 请求体
{
  "entries": [{
    "stemHash": "abc123...def456...ghi789...",
    "answer": "B",
    "correctOptionHashes": {}
  }]
}

// 响应
{
  "success": true,
  "added": 1,
  "total_collected": 15
}
```

- IP 限流：每 IP 每分钟最多 5 条
- 自动去重（基于 stemHash）
- 写入 `collected_hash_db.json`

### 游戏后端 API（端口 8000）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/recognize` | POST | 模板匹配识别坐标 |
| `/api/predict` | POST | 抓鬼预测 |
| `/api/maps` | GET | 地图列表 |
| `/api/templates` | GET | 模板列表 |

## 哈希库系统（科举题库）

### 数据文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `hash-db.json` | `frontend/public/mhxy/static/` | 主题库（82 条内置） |
| `collected_hash_db.json` | `frontend/public/mhxy/static/` | 众筹收集的增量数据 |
| `builtinHashes` | keju.html 内嵌 JS Set | 标记哪些是内置条目 |

### 数据流

```
用户答题成功
    │
    └─→ addToHashDB() 存 localStorage（仅增量）
            │
            └─→ fire-and-forget POST /api/hash-db/collect
                    │
                    └─→ collected_hash_db.json
                            │
                            └─→ merge_collected.py
                                    │
                                    └─→ hash-db.json
```

### 合并脚本

`outputs/merge_collected.py` — 将众筹数据合并到主题库：

```bash
cd /Users/zhy/WorkBuddy/2026-07-10-23-51-12/outputs
python3 merge_collected.py --dry-run    # 预览将要添加的条目
python3 merge_collected.py --review     # 逐条审核
python3 merge_collected.py              # 直接合并
```

## 排错指南

### OCR 识别不显示 / 500 错误

**根因**：OCR 后端（8001 端口）未运行。

**检查**：
```bash
lsof -i :8001     # 查看是否有 Python 进程在监听
```

**修复**：
```bash
# 在 Terminal 中运行（不是 WorkBuddy！）
cd /Users/zhy/mhxy-helper/backend
./start_keju.sh
```

**为什么会挂**：WorkBuddy 沙箱会在命令结束后 ~15 秒杀掉所有子进程。因此 OCR 后端必须在 WorkBuddy 外的 Terminal 中用守护脚本启动。

### Vite 代理 500 但 OCR 后端正常

检查 Vite 代理配置（`frontend/vite.config.ts`）：
```ts
proxy: {
  '/api/ocr': 'http://localhost:8001',
  '/api/hash-db': 'http://localhost:8001',
}
```

### Python 模块找不到

确认使用系统 Python 3.9：
```bash
/usr/bin/python3 -c "import rapidocr; print('ok')"
```

如果 3.13 报错 `ModuleNotFoundError`，切换到 `/usr/bin/python3`。

## 目录结构

```
mhxy-helper/
├── frontend/                    # Vue 3 前端
│   ├── src/
│   │   ├── views/              # 页面组件
│   │   ├── components/         # 公共组件
│   │   ├── services/           # API 服务
│   │   ├── stores/             # Pinia 状态管理
│   │   └── router.ts           # 路由
│   ├── public/
│   │   ├── mhxy/static/        # 科举页面 + 题库
│   │   │   ├── keju.html       # 科举答题主页面
│   │   │   ├── hash-db.json    # 主题库（82条）
│   │   │   └── collected_hash_db.json  # 众筹数据
│   │   ├── models/             # ONNX 模型
│   │   └── templates/          # 模板图片
│   ├── vite.config.ts          # Vite 配置（含代理规则）
│   └── package.json
│
├── backend/                     # Python 后端
│   ├── backend_keju.py         # OCR 后端（端口 8001, PP-OCRv6）
│   ├── main.py                 # 游戏后端（端口 8000）
│   ├── start_keju.sh           # OCR 守护启动脚本
│   ├── routers/                # API 路由
│   ├── services/               # 核心算法
│   ├── data/                   # 模板 + 地图
│   └── requirements.txt
│
└── shared/                      # 共享资源
    ├── templates/
    └── maps/
```

## 使用流程

### 科举答题
1. 确保 OCR 后端在 Terminal 中运行（`./start_keju.sh`）
2. 确保前端在运行（`npm run dev`）
3. 打开 `http://localhost:3000/mhxy/static/keju.html`
4. 点击「开始屏幕共享」选择游戏窗口
5. 设置题目区域和选项区域的裁剪框
6. 点击「开始识别」自动匹配答题
7. 匹配结果自动显示题目 + 答案

### 抓鬼助手
1. 打开 `http://localhost:3000/ghost`
2. 点击「开始屏幕共享」选择游戏窗口
3. 设置截图区域（小鬼名字显示位置）
4. 点击「开始监控」自动识别
5. 识别成功后显示预测区域

### 宝图助手
1. 打开 `http://localhost:3000/baotu`
2. 点击「开始屏幕共享」选择游戏窗口
3. 点击「加载 ONNX 模型」
4. 点击「开始监控」自动检测宝图
5. 鼠标悬停宝图触发坐标弹窗

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript + Vite |
| YOLO 检测 | ONNX Runtime Web（前端推理） |
| 科举 OCR | RapidOCR + ONNX Runtime (PP-OCRv6 SMALL) |
| 感知哈希 | 前端 pHash + 汉明距离匹配 |
| 通信 | REST API |
| OCR 后端 | FastAPI + Uvicorn (Python 3.9) |
| 游戏后端 | FastAPI（模板匹配 + 抓鬼预测） |

## 与旧项目对比

| 功能 | 旧项目 | 新项目 |
|------|--------|--------|
| 窗口枚举 | Windows API (`ctypes.windll`) | `getDisplayMedia`（跨平台） |
| 窗口截图 | `PrintWindow` API | Canvas 截图（跨平台） |
| YOLO 检测 | 后端运行 | 前端 ONNX（跨平台） |
| 科举答题 | 无 | 感知哈希 + OCR 兜底 |
| 前端框架 | HTML + JS | Vue 3 + TypeScript |
| 通信方式 | WebSocket | REST API |

## 注意事项

1. **屏幕共享**：需要浏览器支持 `getDisplayMedia` API（Chrome/Edge/Safari）
2. **OCR 后端必须独立启动**：WorkBuddy 沙箱会杀死后台进程，请在 Terminal 中运行 `start_keju.sh`
3. **OCR 后端必须用 Python 3.9**：`/usr/bin/python3`，3.13 未安装 rapidocr 等依赖
4. **ONNX 模型**：宝图检测需要自行导出 YOLOv8 ONNX 模型
5. **游戏窗口**：选择"应用窗口"而非"整个屏幕"效果更好
