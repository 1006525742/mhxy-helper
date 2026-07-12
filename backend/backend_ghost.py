#!/usr/bin/env python3
"""梦幻西游助手 - 抓鬼后端

独立进程，端口 8000。
提供坐标识别 + 抓鬼预测功能。
"""
import base64
import io
import json
import logging
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)
logger = logging.getLogger('ghost')

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
        map_name, x, y = recognize_coord_from_image(img)
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

        response = {
            "success": True,
            "map": result.map_name,
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

        # 标注地图图片
        if result.annotated_image:
            buffer = io.BytesIO()
            result.annotated_image.save(buffer, format="PNG")
            img_bytes = buffer.getvalue()
            response["annotated_image"] = base64.b64encode(img_bytes).decode()

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
    uvicorn.run(app, host="0.0.0.0", port=8000)
