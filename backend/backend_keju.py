#!/usr/bin/env python3
"""梦幻西游助手 - 科举答题后端 (PP-OCRv6)

独立进程，端口 8001。
提供通用 OCR 文字识别，供前端科举答题页面使用。
"""
import io
import json
import logging
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# ============ 日志配置 (TimedRotatingFileHandler, 保留30天) ============
LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "keju-ocr.log"

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

logger = logging.getLogger('keju')


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

# ============ OCR 引擎 ============
_ocr_engine = None
ocr_lock = threading.Lock()  # ONNXRuntime 非线程安全，加锁


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
    with ocr_lock:  # ONNXRuntime 非线程安全
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "keju"}


@app.post("/api/ocr/general")
async def ocr_general(img: UploadFile = File(...)):
    """通用文字识别 (PP-OCRv6)

    接收 multipart 图片，返回识别到的文本。
    """
    try:
        t_start = time.time()
        contents = await img.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')
        arr = np.array(image)[:, :, ::-1].copy()  # RGB -> BGR
        text = do_ocr(arr)
        t_ms = (time.time() - t_start) * 1000
        logger.info(f"OCR: '{text[:80]}' ({t_ms:.1f}ms)")
        return {"success": True, "text": text, "time_ms": round(t_ms, 1)}
    except Exception as e:
        logger.error(f"OCR识别失败: {e}")
        return {"success": False, "error": f"OCR识别失败: {str(e)}"}


@app.post("/api/ocr/batch")
async def ocr_batch(imgs: List[UploadFile] = File(...)):
    """批量文字识别：一次请求处理多张图片，消除多次 HTTP 往返开销。

    接收 multipart 多张图片（字段名 imgs），返回每张图片的 OCR 文本。
    """
    t_start = time.time()
    results = []
    for img_file in imgs:
        try:
            contents = await img_file.read()
            image = Image.open(io.BytesIO(contents)).convert('RGB')
            arr = np.array(image)[:, :, ::-1].copy()
            text = do_ocr(arr)
            results.append({"success": True, "text": text})
        except Exception as e:
            logger.error(f"batch OCR 单张失败: {e}")
            results.append({"success": False, "text": "", "error": str(e)})
    t_ms = (time.time() - t_start) * 1000
    # 只记一条汇总日志，不逐张打
    texts_preview = [r.get("text", "")[:30] for r in results]
    logger.info(f"Batch OCR: {len(results)}张 [{texts_preview}] ({t_ms:.1f}ms)")
    return {"success": True, "results": results, "time_ms": round(t_ms, 1)}


@app.post("/api/WatuOCR")
async def watu_ocr(img: UploadFile = File(...)):
    """WatuOCR 兼容端点 (同 /api/ocr/general)"""
    return await ocr_general(img)


@app.post("/api/ocr/options")
async def ocr_options(img: UploadFile = File(...)):
    """选项区域 OCR，返回带坐标的文字块

    前端把 A/B/C/D 四个选项区域一起 crop 成一张图发过来，
    后端返回每条文字的坐标和内容，前端匹配答案文本确定选项字母。
    """
    try:
        t_start = time.time()
        contents = await img.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')
        arr = np.array(image)[:, :, ::-1].copy()  # RGB -> BGR

        engine = get_ocr_engine()
        with ocr_lock:
            result = engine(arr)

        blocks = []
        if result is not None and hasattr(result, 'boxes') and result.boxes is not None:
            for box, txt, score in zip(result.boxes, result.txts, result.scores):
                if txt and txt.strip():
                    # box: [(x1,y1), (x2,y2), (x3,y3), (x4,y4)]
                    xs = [p[0] for p in box]
                    ys = [p[1] for p in box]
                    blocks.append({
                        "text": txt.strip(),
                        "x": int(min(xs)),
                        "y": int(min(ys)),
                        "w": int(max(xs) - min(xs)),
                        "h": int(max(ys) - min(ys)),
                        "score": float(score)
                    })

        t_ms = (time.time() - t_start) * 1000
        texts = [b["text"] for b in blocks]
        logger.info(f"Options OCR: {texts} ({t_ms:.1f}ms)")
        return {"success": True, "blocks": blocks, "time_ms": round(t_ms, 1)}
    except Exception as e:
        logger.error(f"Options OCR失败: {e}")
        return {"success": False, "error": str(e)}


# ============ 哈希库众筹收集 ============

# 收集文件路径：和 hash-db.json 同目录
_COLLECTED_PATH = Path(__file__).resolve().parent.parent / "frontend" / "public" / "mhxy" / "static" / "collected_hash_db.json"
_collected_lock = threading.Lock()

# 简单的 IP 限流：每个 IP 每分钟最多 5 条
_rate_limits: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 60  # 秒


def _load_collected() -> list[dict]:
    """加载已收集的哈希条目"""
    if _COLLECTED_PATH.exists():
        try:
            with open(_COLLECTED_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_collected(entries: list[dict]):
    """保存收集的哈希条目"""
    _COLLECTED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_COLLECTED_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


def _validate_hash_entry(entry: dict) -> Optional[str]:
    """校验哈希条目格式，返回错误信息或 None（通过）"""
    if not isinstance(entry, dict):
        return "entry 必须是对象"
    if not entry.get("stemHash") or not isinstance(entry["stemHash"], str):
        return "缺少 stemHash 字段"
    if not entry.get("answer") or not isinstance(entry["answer"], str):
        return "缺少 answer 字段"
    if not entry.get("correctOptionHashes") or not isinstance(entry["correctOptionHashes"], dict):
        return "缺少 correctOptionHashes 字段"
    # 校验 stemHash 格式: "gridHash:rowHash:columnHash"
    parts = entry["stemHash"].split(":")
    if len(parts) != 3:
        return "stemHash 格式错误，应为 gridHash:rowHash:columnHash"
    if any(len(p) != 32 or not all(c in "0123456789abcdef" for c in p.lower()) for p in parts):
        return "stemHash 各段应为 32 位十六进制字符串"
    return None


@app.post("/api/hash-db/collect")
async def collect_hash_entry(request: Request):
    """接收用户上传的哈希条目（众筹）

    请求体: {"entries": [...]} 或单个 entry 对象
    校验后去重追加到 collected_hash_db.json。
    限制: 每个 IP 每分钟最多 5 条。
    """
    # --- IP 限流 ---
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    times = _rate_limits[client_ip]
    # 清理过期记录
    times = [t for t in times if now - t < _RATE_LIMIT_WINDOW]
    _rate_limits[client_ip] = times
    if len(times) >= _RATE_LIMIT_MAX:
        return {"success": False, "error": "请求过于频繁，每分钟最多 5 条"}

    try:
        body = await request.json()
    except Exception:
        return {"success": False, "error": "请求体不是有效的 JSON"}

    # 支持单个 entry 或数组
    if isinstance(body, dict):
        entries = [body]
    elif isinstance(body, list):
        entries = body
    else:
        return {"success": False, "error": "请求体应为 entry 对象或 entries 数组"}

    # 校验
    for i, entry in enumerate(entries):
        err = _validate_hash_entry(entry)
        if err:
            return {"success": False, "error": f"第 {i + 1} 条: {err}"}

    # 加载现有 + 去重追加
    with _collected_lock:
        collected = _load_collected()
        existing_hashes = {e["stemHash"] for e in collected}
        added = 0
        for entry in entries:
            if entry["stemHash"] not in existing_hashes:
                collected.append(entry)
                existing_hashes.add(entry["stemHash"])
                added += 1
        if added > 0:
            _save_collected(collected)
            logger.info(f"哈希库收集: +{added} 条 (来自 {client_ip}), 累计 {len(collected)}")

    # 记录限流
    times.append(now)
    _rate_limits[client_ip] = times

    return {"success": True, "added": added, "total_collected": len(collected)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_config=_build_uvicorn_log_config())
