#!/usr/bin/env python3
"""OCR 微服务 - 独立进程运行 RapidOCR (PP-OCRv6)
主服务通过 HTTP 调用此服务，隔离 ONNX 崩溃风险
"""
import sys
import os
import io
import base64
import logging
import numpy as np
from pathlib import Path

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('ocr-service')

app = Flask(__name__)

# 全局 OCR 引擎
_ocr_engine = None


def get_engine():
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


def do_ocr(img_bgr):
    """执行 OCR 识别"""
    engine = get_engine()
    result = engine(img_bgr)

    if result is None:
        return ""

    texts = []
    if hasattr(result, 'txts') and result.txts:
        for t in result.txts:
            if t and isinstance(t, str) and t.strip():
                texts.append(t.strip())

    return ' '.join(texts)


@app.route('/health')
def health():
    return jsonify({"status": "ok"})


@app.route('/ocr', methods=['POST'])
def ocr():
    """OCR 识别端点"""
    import time
    t0 = time.time()

    try:
        data = request.get_json(force=True)
        img_b64 = data.get('img', '')

        if not img_b64:
            return jsonify({"success": False, "error": "缺少 img 参数"}), 400

        # 解码图片
        img_bytes = base64.b64decode(img_b64)
        from PIL import Image
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        arr = np.array(img)[:, :, ::-1].copy()  # RGB -> BGR

        # OCR 识别
        text = do_ocr(arr)
        elapsed = (time.time() - t0) * 1000

        logger.info(f"OCR: '{text[:100]}' ({elapsed:.1f}ms)")
        return jsonify({"success": True, "text": text, "time_ms": round(elapsed, 1)})

    except Exception as e:
        logger.error(f"OCR异常: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    logger.info(f"OCR微服务启动在 :{port}")
    app.run(host='127.0.0.1', port=port, threaded=True)
