#!/usr/bin/env python3
"""梦幻精灵 Relay 后端

把网易官方「梦幻精灵」问答接口 (xyq.gm.163.com/cgi-bin/csa/csa_sprite.py)
做一层服务端转发，供 mhxy-helper 首页「梦幻精灵」卡片调用。

为什么必须过后端转发：
  网易接口没有 Access-Control-Allow-Origin 头，浏览器前端直连会被 CORS 拦死。
  服务端转发绕过该限制，同时我们可以统一加 Referer / 超时 / 日志。

端口：8004（功能模块端口连续：抓鬼8000/科举8001/宝图8002/挖图8003/精灵8004/日志8005/物价8006）
运行：/usr/bin/python3 -m uvicorn backend_sprite:app --host 0.0.0.0 --port 8004
"""

import json
import logging
import ssl
import urllib.parse
import urllib.request

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

# 网易官方精灵源接口
NETEASE_SPRITE_URL = "https://xyq.gm.163.com/cgi-bin/csa/csa_sprite.py"
NETEASE_REFERER = "http://xyq.gm.163.com/sprite.html"

# 强制走系统证书（macOS 系统 Python 自带 CA 证书，不要像沙箱那样关校验）
SSL_CTX = ssl.create_default_context()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("sprite")

app = FastAPI(title="梦幻精灵 Relay", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _fetch_netease(question: str, product_name: str) -> dict:
    """服务端转发到网易官方精灵接口，返回解析后的 dict。"""
    params = {
        "act": "ask",
        "question": question,
        "product_name": product_name or "xyq",
    }
    url = NETEASE_SPRITE_URL + "?" + urllib.parse.urlencode(params)
    logger.info("[sprite] -> %s", url)

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": NETEASE_REFERER,
    })
    # 绕过本机系统代理，直连网易；SSL 上下文通过 HTTPSHandler 注入
    handler = urllib.request.HTTPSHandler(context=SSL_CTX)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), handler)

    with opener.open(req, timeout=20) as resp:
        raw = resp.read()
        # 网易接口实测返回 UTF-8；个别情况下可能是 GB2312，做一次回退
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("gb2312", errors="ignore")
    return json.loads(text)


@app.get("/api/sprite")
async def sprite_ask(
    question: str = Query(..., min_length=1, description="用户提问"),
    product_name: str = Query("xyq", description="游戏产品标识，默认 xyq(梦幻西游)"),
):
    """梦幻精灵问答转发。

    请求: GET /api/sprite?question=如何加点快捷
    响应: 原样透传网易结构 {"answer":"...HTML...", "result":"success", "raw_answer":"..."}
    """
    try:
        data = _fetch_netease(question, product_name)
        return data
    except Exception as e:  # noqa: BLE001
        logger.error("[sprite] 调用网易接口失败: %s", e)
        return {
            "result": "error",
            "answer": "",
            "raw_answer": "",
            "error": f"精灵服务暂不可用: {e}",
        }


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8004)
