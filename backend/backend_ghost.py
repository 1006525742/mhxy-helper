#!/usr/bin/env python3
"""梦幻西游助手 - 抓鬼后端

独立进程，端口 8000。
提供坐标识别 + 抓鬼预测功能。
"""
import base64
import io
import json
import logging
import os
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============ 日志配置 (TimedRotatingFileHandler, 保留30天, UTF-8) ============
LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "backend.log"

from logging.handlers import TimedRotatingFileHandler  # noqa: E402

# 统一的日志格式
LOG_FORMAT = '%(asctime)s %(levelname)s %(message)s'

# 轮转文件 handler：每天午夜切分，保留30个备份，强制 UTF-8
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

# 配置根 logger（应用日志 + uvicorn 日志统一走这里，UTF-8 写入 backend.log）
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

logger = logging.getLogger('ghost')


# uvicorn 日志配置：使用同一个 UTF-8 rotating file handler
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

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MAPS_DIR = DATA_DIR / "maps"

# 导入服务
from services.rapidocr_recognizer import recognize_coord_from_image
from services.ghost_predictor import GhostPredictor

# 初始化预测器
ghost_predictor = GhostPredictor()

# ============ FastAPI 应用 ============
app = FastAPI(
    title="梦幻西游助手 - 抓鬼预测",
    description="坐标识别 + 抓鬼预测服务",
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


class PredictRequest(BaseModel):
    """抓鬼预测请求"""
    map: str
    x: int
    y: int


# ============ API 端点 ============

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ghost"}


@app.get("/api/maps")
async def get_maps():
    """获取支持的地图列表"""
    maps = ghost_predictor.get_map_list()
    return {"maps": maps}


@app.post("/api/predict")
async def predict_ghost(req: PredictRequest):
    """抓鬼预测

    接收地图名和坐标，返回预测区域和标注地图
    """
    try:
        result = ghost_predictor.predict(req.map, req.x, req.y)

        response = {
            "success": True,
            "map": result.map_name,
            "x": result.x,
            "y": result.y,
            "position_areas": result.position_areas,
            "corner_areas": result.corner_areas,
            "confidence": result.confidence
        }

        # 如果有标注图片，转换为 base64
        if result.annotated_image:
            buffer = io.BytesIO()
            result.annotated_image.save(buffer, format="PNG")
            img_bytes = buffer.getvalue()
            response["annotated_image"] = base64.b64encode(img_bytes).decode()

        return response

    except Exception as e:
        logger.error(f"预测失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/ghost/capture")
async def ghost_capture(req: RecognizeRequest):
    """组合 API：OCR识别坐标 + 预测小鬼位置"""
    try:
        # 解码图片
        image_data = base64.b64decode(req.image.split(',')[1] if ',' in req.image else req.image)
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return {"success": False, "error": "无法解码图片"}

        logger.info(f"收到截图: {img.shape}")

        # 调试：保存上传的图片
        debug_path = Path("/tmp/debug_upload.png")
        cv2.imwrite(str(debug_path), img)
        logger.info(f"调试图片已保存: {debug_path}")

        # OCR 识别坐标
        import time
        t_start = time.time()
        map_name, x, y = recognize_coord_from_image(img, use_cls=False)
        t_ms = (time.time() - t_start) * 1000
        logger.info(f"[OCR] {map_name} ({x}, {y}) - {t_ms:.1f}ms")

        if not map_name:
            return {
                "success": False,
                "error": "未识别到坐标",
                "ocr": {"map": map_name, "x": x, "y": y, "time_ms": round(t_ms, 1)}
            }

        # 自动预测
        result = ghost_predictor.predict(map_name, x, y)

        # 前端自绘地图所需元数据（底图文件 + 逻辑坐标边界）
        map_file = map_width = map_height = None
        if result.map_info:
            map_file = os.path.basename(result.map_info.image_path)
            map_width = result.map_info.width
            map_height = result.map_info.height

        response = {
            "success": True,
            "map": result.map_name,
            "map_file": map_file,
            "map_width": map_width,
            "map_height": map_height,
            "x": result.x,
            "y": result.y,
            "position_areas": result.position_areas,
            "corner_areas": result.corner_areas,
            "confidence": result.confidence,
            "ocr": {
                "map": map_name,
                "x": x,
                "y": y,
                "time_ms": round(t_ms, 1)
            }
        }

        return response

    except Exception as e:
        logger.error(f"抓鬼识别失败: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/monster/list")
async def get_monster_list():
    """获取怪物列表（本地数据）"""
    monster_file = DATA_DIR / "monsters.json"
    if not monster_file.exists():
        return {"code": 0, "msg": "怪物数据文件不存在", "data": None}
    try:
        local_data = json.loads(monster_file.read_text(encoding="utf-8"))
        return {
            "code": 1,
            "msg": "ok",
            "data": {
                "list": local_data.get("list", []),
                "checkpoint_list": local_data.get("checkpoint_list", {}),
                "checkpoint_data_list": local_data.get("checkpoint_data_list", [])
            }
        }
    except Exception as e:
        return {"code": 0, "msg": str(e), "data": None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_config=_build_uvicorn_log_config())
