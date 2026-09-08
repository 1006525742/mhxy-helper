#!/usr/bin/env python3
"""梦幻西游助手 - 挖图（挖图助手）后端

独立进程，端口 8003（8000=抓鬼，8001=科举，8002=宝图分图，8003=挖图）。
提供藏宝图坐标 OCR 识别功能（挖图助手专属，与分图解耦）。
日志写入 backend/logs/watu-ocr.log（TimedRotatingFileHandler，每天午夜轮转，保留30天）。
"""
import base64
import io
import logging
import os
import time
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============ 日志配置 (TimedRotatingFileHandler, 保留30天) ============
LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "watu-ocr.log"

from logging.handlers import TimedRotatingFileHandler  # noqa: E402

# 统一的日志格式
LOG_FORMAT = '%(asctime)s %(levelname)s %(message)s'

# 轮转文件 handler：每天午夜切分，保留30个备份
file_handler = TimedRotatingFileHandler(
    str(LOG_FILE),
    when="midnight",
    interval=1,
    backupCount=30,
    encoding="utf-8"
)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT))

# 控制台 handler（调试用）
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter(LOG_FORMAT))

# 配置根 logger（应用日志 + uvicorn 日志统一走这里）
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

logger = logging.getLogger('watu')


# uvicorn 日志配置：使用同一个 rotating file handler
def _build_uvicorn_log_config():
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {"format": LOG_FORMAT},
            "access": {"format": LOG_FORMAT},
        },
        "handlers": {
            "rotating_file": {
                "class": "logging.handlers.TimedRotatingFileHandler",
                "filename": str(LOG_FILE),
                "when": "midnight",
                "interval": 1,
                "backupCount": 30,
                "encoding": "utf-8",
                "formatter": "default",
            },
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["rotating_file", "console"], "level": "INFO", "propagate": False},
            "uvicorn.error": {"handlers": ["rotating_file", "console"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["rotating_file", "console"], "level": "WARNING", "propagate": False},
        },
    }

# 导入服务
from services import rapidocr_recognizer
from services.rapidocr_recognizer import recognize_coord_from_image
from services.baotu_predictor import MAP_CONFIGS

# 挖图助手专有地图名清单（16 张，排除宝象国/长寿村/西凉女国等非挖图地图）
WATU_CANONICAL_NAMES = {
    '东海湾', '五庄观', '傲来国', '北俱芦洲', '墨家村',
    '大唐国境', '大唐境外', '狮驼岭', '女儿村', '建邺城',
    '普陀山', '朱紫国', '麒麟山', '花果山', '江南野外', '长寿郊外'
}
WATU_MAP_NAMES: list = []
WATU_MAP_NAME_NORMALIZE: dict = {}
for _canonical, _cfg in MAP_CONFIGS.items():
    if _canonical not in WATU_CANONICAL_NAMES:
        continue
    for _nm in _cfg['names']:
        WATU_MAP_NAME_NORMALIZE[_nm] = _canonical
        if len(_nm) >= 2:  # 排除单字别名，避免误匹配
            WATU_MAP_NAMES.append(_nm)

# 挖图专属 OCR 变体：OCR 易误识的别名 -> 标准地图名
# （仅用于挖图 OCR 归一化，不污染共享的 baotu_predictor 配置）
WATU_OCR_VARIANTS = {
    '五户观': '五庄观',  # "五庄观" 易被 OCR 误识为 "五户观"
    '普陀': '普陀山',    # "普陀山" 末字"山"易被漏识，只剩"普陀"
    '普吧山': '普陀山',  # "普陀山" 易被 OCR 误识为 "普吧山"（吧/陀 形近）
}
for _alias, _canon in WATU_OCR_VARIANTS.items():
    if _canon in WATU_CANONICAL_NAMES:
        WATU_MAP_NAME_NORMALIZE[_alias] = _canon
        if len(_alias) >= 2:
            WATU_MAP_NAMES.append(_alias)

WATU_FALLBACK_MAPS = list(WATU_CANONICAL_NAMES)
logger.info(f"挖图 OCR 地图名清单: {len(WATU_MAP_NAMES)} 个关键词, "
            f"{len(WATU_FALLBACK_MAPS)} 个标准地图")


# ============ FastAPI 应用 ============
app = FastAPI(
    title="梦幻西游助手 - 挖图",
    description="藏宝图坐标 OCR 识别服务（独立进程，端口 8003）",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ 请求模型 ============
class RecognizeRequest(BaseModel):
    """坐标识别请求"""
    image: str  # base64 编码的图片


# ============ API 端点 ============
@app.get("/health")
@app.get("/api/watu/health")
async def health():
    return {"status": "ok", "service": "watu"}


@app.post("/api/watu/capture")
async def watu_capture(req: RecognizeRequest):
    """挖图助手：OCR 识别藏宝图坐标（独立后端，端口 8003）

    复用项目自有的 RapidOCR（PP-OCRv6 SMALL）引擎，
    使用挖图助手专属的 16 张地图名清单，
    排除宝象国/长寿村/西凉女国等非挖图地图，提高识别精度。
    """
    try:
        image_data = base64.b64decode(req.image.split(',')[1] if ',' in req.image else req.image)
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return {"success": False, "error": "无法解码图片"}

        t_start = time.time()
        map_name, x, y = recognize_coord_from_image(
            img,
            map_names=WATU_MAP_NAMES,
            map_name_normalize=WATU_MAP_NAME_NORMALIZE,
            fallback_maps=WATU_FALLBACK_MAPS,
            use_cls=False,  # 宝图文字永远正放，关闭方向分类器(CLS)避免误判
        )
        t_ms = (time.time() - t_start) * 1000
        _dbg = rapidocr_recognizer._last_recognize_debug or {}
        _raw = _dbg.get('raw_text', '')
        _kw = _dbg.get('matched_keyword', '')
        logger.info(
            f"[Watu OCR] 地图={map_name} 坐标=({x},{y}) 耗时={t_ms:.1f}ms | "
            f"OCR原文='{_raw}' 命中关键词='{_kw}'"
        )

        if not map_name:
            return {
                "success": False,
                "error": "未识别到地图名",
                "ocr": {"map": map_name, "x": x, "y": y, "time_ms": round(t_ms, 1)}
            }

        if not (x and y):
            logger.info(f"[Watu] 坐标未识别，仅返回地图名: '{map_name}'")

        return {
            "success": True,
            "map": map_name,
            "x": x,
            "y": y,
            "time_ms": round(t_ms, 1)
        }

    except Exception as e:
        logger.error(f"[Watu] 识别失败: {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003, log_config=_build_uvicorn_log_config())
