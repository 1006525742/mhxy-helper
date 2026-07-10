#!/usr/bin/env python3
"""996长安酒店 - API代理服务"""
import json
import time
from pathlib import Path
from functools import lru_cache
from typing import Optional

import httpx
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# 项目路径
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = DATA_DIR / "cache"

# 确保目录存在
for d in [STATIC_DIR, DATA_DIR, CACHE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# API配置
API_BASE_URL = "https://api.xyq2.com/index.php"
DEFAULT_PARAMS = {
    "token": "",
    "headers_provider": "weixin",
    "is_mobile": "1"
}

# 创建FastAPI应用
app = FastAPI(
    title="996长安酒店",
    description="梦幻西游辅助工具 - API代理服务",
    version="1.0.0"
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== API代理 ====================

# 缓存配置数据（有效期10分钟）
_setting_cache = {"data": None, "expire_time": 0}

async def fetch_api(module: str, action: str, extra_params: dict = None) -> dict:
    """通用API请求函数"""
    url = f"{API_BASE_URL}/{module}/{action}"
    params = DEFAULT_PARAMS.copy()
    if extra_params:
        params.update(extra_params)

    try:
        # 创建不验证SSL的客户端
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(url, params=params)
            # 确保使用UTF-8编码解析
            content = resp.content.decode('utf-8')
            return json.loads(content)
    except Exception as e:
        return {"code": 0, "msg": str(e), "data": None}


@app.get("/api/setting")
async def get_setting():
    """获取配置数据（带缓存）"""
    global _setting_cache

    # 检查缓存是否有效
    current_time = time.time()
    if _setting_cache["data"] and _setting_cache["expire_time"] > current_time:
        return _setting_cache["data"]

    # 请求新数据
    result = await fetch_api("content_font/monster", "getSetting")

    if result.get("code") == 1:
        _setting_cache["data"] = result
        _setting_cache["expire_time"] = current_time + 600  # 10分钟缓存

    return result


@app.get("/api/monster/list")
async def get_monster_list():
    """获取怪物列表（优先本地，无数据则调用远程API）"""
    local_file = DATA_DIR / "monsters.json"

    if local_file.exists():
        # 使用本地数据
        try:
            local_data = json.loads(local_file.read_text(encoding="utf-8"))
            return {"code": 1, "msg": "本地数据", "data": {
                "list": local_data.get("list", []),
                "checkpoint_list": local_data.get("checkpoint_list", {}),
                "checkpoint_data_list": local_data.get("checkpoint_data_list", [])
            }}
        except:
            pass

    # 无本地数据，调用远程API
    return await fetch_api("content_font/monster", "listall")


@app.get("/api/monster/blood")
async def get_monster_blood(number: int = Query(1, description="层数")):
    """获取指定层数的怪物气血数据"""
    return await fetch_api("content_font/monster", "listall", {"number": number})


@app.get("/api/monster/detail/{monster_id}")
async def get_monster_detail(monster_id: int):
    """获取怪物详情（优先本地）"""
    local_file = DATA_DIR / "monsters.json"

    if local_file.exists():
        try:
            local_data = json.loads(local_file.read_text(encoding="utf-8"))
            monsters_detail = local_data.get("monsters_detail", [])

            for detail in monsters_detail:
                if detail.get("info", {}).get("id") == monster_id:
                    return {"code": 1, "msg": "本地数据", "data": detail}
        except:
            pass

    # 无本地数据，调用远程API
    return await fetch_api("content_font/monster", f"detail?id={monster_id}")


@app.get("/api/proxy")
async def proxy_api(
    module: str = Query(..., description="API模块路径，如 content_font/blood"),
    action: str = Query(..., description="API动作，如 getList"),
    params: Optional[str] = Query(None, description="额外参数JSON字符串")
):
    """通用API代理接口"""
    extra_params = {}
    if params:
        try:
            extra_params = json.loads(params)
        except:
            pass

    return await fetch_api(module, action, extra_params)


@app.get("/api/module/{module_name}")
async def get_module_data(module_name: str):
    """获取指定模块的数据（尝试多个可能的接口路径）"""
    # 尝试不同的API路径组合
    paths_to_try = [
        f"content_font/{module_name}",
        f"content_font/{module_name}/getSetting",
        f"content_font/{module_name}/getList",
        f"content_font/{module_name}/index",
    ]

    for path in paths_to_try:
        try:
            result = await fetch_api(path, "")
            if result.get("code") == 1 and result.get("data"):
                return result
        except:
            continue

    # 尝试完整路径
    full_paths = [
        f"content_font/{module_name}/getSetting",
        f"content_font/{module_name}/getList",
    ]

    for path in full_paths:
        result = await fetch_api(path, "")
        if result.get("code") == 1:
            return result

    return {"code": 0, "msg": f"未找到模块 {module_name} 的数据接口", "data": None}


# ==================== 静态文件服务 ====================

@app.on_event("startup")
async def startup():
    """启动时挂载静态文件"""
    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    """首页"""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(index_path.read_text(encoding="utf-8"))

    # 临时首页（开发阶段）
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>996长安酒店</title>
        <style>
            body { background: #1a1a2e; color: #eee; font-family: sans-serif; text-align: center; padding: 50px; }
            h1 { color: #4fc3f7; }
            .tip { color: #888; margin-top: 20px; }
        </style>
    </head>
    <body>
        <h1>996长安酒店</h1>
        <p>开发中... 请将 <b>index.html</b> 放到 static/ 目录</p>
        <p class="tip">API测试: <a href="/api/setting" style="color:#4fc3f7">/api/setting</a></p>
    </body>
    </html>
    """)


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "ok", "service": "996长安酒店"}


# ==================== 运行入口 ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8766)