#!/usr/bin/env python3
"""梦幻西游助手 - 科举答题后端 (PP-OCRv6)

独立进程，端口 8000。
提供通用 OCR 文字识别，供前端科举答题页面使用。
"""
import base64
import io
import json
import logging
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)
logger = logging.getLogger('keju')

# ============ OCR 引擎 ============
_ocr_engine = None


def get_ocr_engine():
    """延迟加载 OCR 引擎 (PP-OCRv6 SMALL)"""
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR
        _ocr_engine = RapidOCR(params={
            "Det.ocr_version": OCRVersion.PPOCRV6,
            "Det.model_type": ModelType.SMALL,
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": LangDet.CH,
            "Rec.ocr_version": OCRVersion.PPOCRV6,
            "Rec.model_type": ModelType.SMALL,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.CH,
        })
        logger.info("OCR引擎初始化完成 (PP-OCRv6 SMALL)")
    return _ocr_engine


def do_ocr(img_bgr: np.ndarray) -> str:
    """对 BGR 图像执行 OCR 识别，返回文本"""
    engine = get_ocr_engine()
    result = engine(img_bgr)

    if result is None:
        return ""

    texts = []
    if hasattr(result, 'txts') and result.txts:
        for t in result.txts:
            if t and isinstance(t, str) and t.strip():
                texts.append(t.strip())

    return ' '.join(texts)


# ============ FastAPI 应用 ============
app = FastAPI(
    title="梦幻西游助手 - 科举答题",
    description="PP-OCRv6 通用文字识别服务",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OCRRequest(BaseModel):
    """通用 OCR 请求"""
    img: str  # base64 编码的图片 (纯base64，不含 data:image 前缀)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "keju"}


@app.post("/api/ocr/general")
async def ocr_general(req: OCRRequest):
    """通用文字识别 (PP-OCRv6)

    接收 base64 编码的图片，返回识别到的文本。
    """
    try:
        t_start = time.time()

        if not req.img:
            return {"success": False, "error": "缺少 img 参数"}

        # 解码图片
        img_bytes = base64.b64decode(req.img)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        arr = np.array(img)[:, :, ::-1].copy()  # RGB -> BGR

        # OCR 识别
        text = do_ocr(arr)
        t_ms = (time.time() - t_start) * 1000

        logger.info(f"OCR: '{text[:80]}' ({t_ms:.1f}ms)")
        return {"success": True, "text": text, "time_ms": round(t_ms, 1)}

    except Exception as e:
        logger.error(f"OCR识别失败: {e}")
        return {"success": False, "error": f"OCR识别失败: {str(e)}"}


@app.post("/api/WatuOCR")
async def watu_ocr(req: OCRRequest):
    """WatuOCR 兼容端点 (同 /api/ocr/general)"""
    return await ocr_general(req)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
