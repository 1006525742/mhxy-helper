# 梦幻西游助手 - 跨平台版

跨平台梦幻西游抓鬼/宝图助手，支持 Windows + macOS。

## 功能

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

## 技术架构

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite |
| YOLO | ONNX Runtime Web（前端） |
| 通信 | REST API |
| 后端 | FastAPI（模板匹配 + 抓鬼预测） |

## 目录结构

```
mhxy-helper/
├── frontend/                # Vue 3 前端
│   ├── src/
│   │   ├── views/          # 页面
│   │   ├── components/     # 组件（common/ghost/baotu）
│   │   ├── services/       # 服务（api/screenCapture/onnxYolo）
│   │   ├── stores/         # Pinia 状态管理
│   │   ├── router.ts       # 路由
│   │   └── style.css       # 全局样式
│   ├── public/
│   │   ├── models/         # ONNX 模型（需用户提供）
│   │   └── templates/      # 模板图片
│   └── package.json
│
├── backend/                 # FastAPI 后端
│   ├── main.py             # API 入口
│   ├── routers/            # API 路由
│   ├── services/           # 核心算法
│   │   ├── template_matcher.py  # 模板匹配
│   │   ├── ghost_predictor.py   # 抓鬼预测
│   ├── data/
│   │   ├── templates/      # 模板图片
│   │   ├── maps/           # 地图图片
│   └── requirements.txt
│
└── shared/                  # 共享资源
    ├── templates/           # 模板图片源头
    └── maps/                # 地图图片源头
```

## 安装与运行

### 1. 安装依赖

**前端：**
```bash
cd frontend
npm install
```

**后端：**
```bash
cd backend
pip install -r requirements.txt
```

### 2. 准备模型文件

**宝图检测模型**（需自行导出）：
```bash
# 从旧项目 YOLOv8 导出 ONNX
cd /Users/zhy/mh-996cajd/mhxy_web
yolo export model=models/baotu_detect.pt format=onnx

# 复制到新项目
cp models/baotu_detect.onnx /Users/zhy/mhxy-helper/frontend/public/models/
```

### 3. 启动服务

**后端：**
```bash
cd backend
python main.py
# 访问 http://localhost:8000/docs 查看 API 文档
```

**前端：**
```bash
cd frontend
npm run dev
# 访问 http://localhost:3000
```

## API 文档

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/recognize` | POST | 模板匹配识别坐标 |
| `/api/predict` | POST | 抓鬼预测 |
| `/api/maps` | GET | 地图列表 |
| `/api/templates` | GET | 模板列表 |

### POST /api/recognize

请求：
```json
{
  "image": "data:image/jpeg;base64,..."
}
```

响应：
```json
{
  "success": true,
  "map": "傲来国",
  "x": 123,
  "y": 45
}
```

### POST /api/predict

请求：
```json
{
  "map": "傲来国",
  "x": 123,
  "y": 45
}
```

响应：
```json
{
  "success": true,
  "map": "傲来国",
  "x": 123,
  "y": 45,
  "position_areas": ["左上", "右下"],
  "corner_areas": ["角落A"],
  "confidence": 0.85,
  "annotated_image": "base64..."
}
```

## 使用流程

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

## 与旧项目对比

| 功能 | 旧项目 | 新项目 |
|------|--------|--------|
| 窗口枚举 | Windows API (`ctypes.windll`) | `getDisplayMedia`（跨平台） |
| 窗口截图 | `PrintWindow` API | Canvas 截图（跨平台） |
| YOLO 检测 | 后端运行 | 前端 ONNX（跨平台） |
| 前端框架 | HTML + JS | Vue 3 + TypeScript |
| 通信方式 | WebSocket | REST API |

## 注意事项

1. **屏幕共享**：需要浏览器支持 `getDisplayMedia` API（Chrome/Edge/Safari）
2. **ONNX 模型**：需要自行导出 YOLOv8 ONNX 模型
3. **地图图片**：目前使用占位图，可替换为真实地图截图
4. **游戏窗口**：选择"应用窗口"而非"整个屏幕"效果更好