#!/usr/bin/env python3
"""梦幻西游助手 - 宝图（分图）后端

独立进程，端口 8002（8000=抓鬼，8001=科举，8002=宝图）。
提供坐标 OCR 识别 + 宝图位置预测功能。
日志独立写入 backend/logs/baotu.log，与抓鬼后端分离，便于分别观察。
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

# ============ 日志：独立文件 ============
BASE_DIR = Path(__file__).parent
LOG_FILE = BASE_DIR / "logs" / "baotu.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

baotu_logger = logging.getLogger("baotu")
baotu_logger.setLevel(logging.INFO)
if not baotu_logger.handlers:
    # 文件 handler（独立日志）
    _fh = logging.FileHandler(str(LOG_FILE), encoding="utf-8")
    _fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    baotu_logger.addHandler(_fh)
    # 控制台 handler
    _ch = logging.StreamHandler()
    _ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    baotu_logger.addHandler(_ch)
# 避免向上冒泡到 root（防止重复打印到 ghost 日志）
baotu_logger.propagate = False

# 关键：OCR 识别模块 (services.rapidocr_recognizer) 自有一套 logger，
# 默认只会冒泡到 root（控制台），不会写进 baotu.log，导致 OCR 细节在日志里不可见。
# 这里把它的 logger 也挂到 baotu.log + 控制台，并阻断冒泡，确保 OCR 每行识别/匹配细节都进日志。
_ocr_mod_logger = logging.getLogger("services.rapidocr_recognizer")
_ocr_mod_logger.setLevel(logging.INFO)
_ocr_mod_logger.propagate = False
if not _ocr_mod_logger.handlers:
    _ocr_fh = logging.FileHandler(str(LOG_FILE), encoding="utf-8")
    _ocr_fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    _ocr_mod_logger.addHandler(_ocr_fh)
    _ocr_ch = logging.StreamHandler()
    _ocr_ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    _ocr_mod_logger.addHandler(_ocr_ch)

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)
logger = baotu_logger

# 导入服务
from services import rapidocr_recognizer
from services.rapidocr_recognizer import recognize_coord_from_image
from services.baotu_predictor import get_predictor, MAP_CONFIGS

# 初始化预测器（加载 19 张宝图地图）
baotu_predictor = get_predictor()

# 由 MAP_CONFIGS 构建宝图专有的 OCR 地图名清单（含 OCR 误识别变体）
BAOTU_MAP_NAMES: list = []
BAOTU_MAP_NAME_NORMALIZE: dict = {}
for _canonical, _cfg in MAP_CONFIGS.items():
    for _nm in _cfg['names']:
        BAOTU_MAP_NAME_NORMALIZE[_nm] = _canonical
        if len(_nm) >= 2:  # 排除单字别名，避免误匹配
            BAOTU_MAP_NAMES.append(_nm)
BAOTU_FALLBACK_MAPS = list(set(BAOTU_MAP_NAME_NORMALIZE.values()))
logger.info(f"宝图 OCR 地图名清单: {len(BAOTU_MAP_NAMES)} 个关键词, "
            f"{len(BAOTU_FALLBACK_MAPS)} 个标准地图")


# ============ FastAPI 应用 ============
app = FastAPI(
    title="梦幻西游助手 - 宝图分图",
    description="藏宝图坐标 OCR 识别 + 宝图位置预测服务（独立进程，端口 8002）",
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
    """宝图位置预测请求"""
    map: str
    x: int
    y: int


# ============ API 端点 ============
@app.get("/health")
@app.get("/api/baotu/health")
async def health():
    return {"status": "ok", "service": "baotu"}


@app.get("/api/maps")
@app.get("/api/baotu/maps")
async def get_maps():
    """获取宝图支持的地图列表（19 张）"""
    maps = baotu_predictor.get_map_list()
    return {"maps": maps}


@app.post("/api/fentu/capture")
@app.post("/api/baotu/capture")
async def fentu_capture(req: RecognizeRequest):
    """分图助手：OCR 识别藏宝图坐标

    复用 RapidOCR（PP-OCRv6 SMALL）引擎，传入宝图专有 19 图地图名清单，
    使北俱芦洲/长寿郊外/大唐国境等宝图独有地图也能正确识别。
    接收裁剪后的藏宝图2 区域 PNG（base64），返回游戏内坐标 (x, y) 与地图名。
    """
    try:
        image_data = base64.b64decode(req.image.split(',')[1] if ',' in req.image else req.image)
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return {"success": False, "error": "无法解码图片"}

        import time
        t_start = time.time()
        map_name, x, y = recognize_coord_from_image(
            img,
            map_names=BAOTU_MAP_NAMES,
            map_name_normalize=BAOTU_MAP_NAME_NORMALIZE,
            fallback_maps=BAOTU_FALLBACK_MAPS,
        )
        t_ms = (time.time() - t_start) * 1000
        _dbg = rapidocr_recognizer._last_recognize_debug or {}
        _raw = _dbg.get('raw_text', '')
        _kw = _dbg.get('matched_keyword', '')
        logger.info(
            f"[Fentu OCR] 地图={map_name} 坐标=({x},{y}) 耗时={t_ms:.1f}ms | "
            f"OCR原文='{_raw}' 命中关键词='{_kw}'"
        )

        # 分图助手只需地图名即可填格子；坐标为可选项（识别到则一并返回用于定位，
        # 识别不到也照常返回地图名，不再因坐标缺失而判失败）
        if not map_name:
            return {
                "success": False,
                "error": "未识别到地图名",
                "ocr": {"map": map_name, "x": x, "y": y, "time_ms": round(t_ms, 1)}
            }

        if not (x and y):
            logger.info(f"坐标未识别，仅返回地图名: '{map_name}'")

        return {
            "success": True,
            "map": map_name,
            "x": x,
            "y": y,
            "time_ms": round(t_ms, 1)
        }

    except Exception as e:
        logger.error(f"分图识别失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/baotu/predict")
async def predict_baotu(req: PredictRequest):
    """宝图位置预测（与抓鬼 /api/predict 同级）

    接收地图名和坐标，返回预测象限、置信度，以及标注后的地图图片（base64 PNG）。
    """
    try:
        result = baotu_predictor.predict(req.map, req.x, req.y)

        response = {
            "success": True,
            "map": result.map_name,
            "x": result.x,
            "y": result.y,
            "position_areas": result.position_areas,
            "corner_areas": result.corner_areas,
            "confidence": result.confidence
        }

        if result.annotated_image:
            buffer = io.BytesIO()
            result.annotated_image.save(buffer, format="PNG")
            img_bytes = buffer.getvalue()
            response["annotated_image"] = base64.b64encode(img_bytes).decode()

        return response

    except Exception as e:
        logger.error(f"宝图预测失败: {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
