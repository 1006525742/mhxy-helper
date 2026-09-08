# 996长安酒店

梦幻西游辅助工具网页版 - 基于原API代理转发

## 项目结构

```
mhxy_dahu/
├── app.py              # FastAPI主服务
├── requirements.txt    # Python依赖
├── run.bat            # Windows启动脚本
├── static/
│   ├── index.html     # 首页
│   ├── css/
│   │   └── style.css  # 现代化样式
│   └── js/
│       └── app.js     # 前端逻辑
└── data/
    └── cache/         # 缓存目录
```

## 快速启动

### 方式1：双击启动
```
双击 run.bat
```

### 方式2：命令行启动
```bash
cd mhxy_dahu
pip install -r requirements.txt
python app.py
```

启动后访问：**http://localhost:8766**

## 功能列表

根据配置接口，已解析出以下功能模块：

| 模块 | 功能名称 | 类型 |
|------|---------|------|
| blood | 山河画境怪物气血查询 | 查询工具 |
| danceBaby | 夜舞倾城伤害计算 | 计算器 |
| monster | 山河画境怪物底细 | 数据查询 |
| huajing | 山河画境攻略 | 攻略展示 |
| digong | 单人地宫攻略 | 攻略展示 |
| qibao | 柒柒成就攻略 | 成就攻略 |
| children | 孩子数据 | 数据查询 |
| skill | 流派技能攻略 | 攻略展示 |
| soul | 山河画境新手攻略 | 攻略展示 |

## API接口

### 获取配置
```
GET /api/setting
```

### 通用代理
```
GET /api/proxy?module=xxx&action=xxx
```

### 模块数据
```
GET /api/module/{module_name}
```

## 技术栈

- **后端**: Python 3.9 + FastAPI + httpx
- **前端**: HTML5 + CSS3 + JavaScript (原生)
- **样式**: 现代化卡片布局、渐变色、响应式设计

## 注意事项

1. 部分功能模块可能需要更多API支持（计算器、数据查询）
2. 图片资源来自阿里云OSS，直接引用原URL
3. 仅供学习研究使用

## 下一步开发

如需完善更多功能：
1. 用浏览器访问原网站
2. F12打开开发者工具 → Network标签
3. 操作各功能，找到对应的API调用
4. 补充到项目中

---

**端口**: 8766  
**数据来源**: api.xyq2.com  
**开发者**: 996长安酒店