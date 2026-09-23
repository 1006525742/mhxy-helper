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
from fastapi import FastAPI, File, Form, Request, UploadFile
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


def do_ocr_detailed(img_bgr: np.ndarray):
    """单次 OCR，返回每个文字框的文本与 x 中心坐标 [{text, cx}]（供前端拼图映射回 A/B/C/D）"""
    engine = get_ocr_engine()
    with ocr_lock:
        result = engine(img_bgr)
    if result is None:
        return []
    try:
        txts = getattr(result, 'txts', None)
        txts = list(txts) if txts is not None else []
        boxes = getattr(result, 'boxes', None)
        boxes = np.asarray(boxes, dtype=float) if boxes is not None else np.empty((0, 4, 2), dtype=float)
        out = []
        for i, t in enumerate(txts):
            if t is None:
                continue
            s = t if isinstance(t, str) else str(t)
            s = s.strip()
            if len(s) == 0:
                continue
            cx = 0.0
            if i < len(boxes):
                b = np.asarray(boxes[i], dtype=float)
                if b.size >= 2:
                    xs = b[:, 0] if b.ndim == 2 else np.array([b[0]], dtype=float)
                    if xs.size > 0:
                        cx = float(xs.min() + xs.max()) / 2.0
            out.append({"text": s, "cx": round(cx, 1)})
        return out
    except Exception as e:
        import traceback as _tb
        logger.error(f"do_ocr_detailed异常: {e}\n{_tb.format_exc()}")
        return []


@app.post("/api/ocr/options-strip")
async def ocr_options_strip(img: UploadFile = File(...)):
    """拼图单次 OCR：接收横向拼合的选项长图，返回每个文字框文本 + x 中心坐标。

    前端把 4 个选项裁图拼成 1 条，单次推理（替代 4 张串行），按 cx 映射回 A/B/C/D。
    """
    t_start = time.time()
    try:
        contents = await img.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')
        arr = np.array(image)[:, :, ::-1].copy()
        dets = do_ocr_detailed(arr)
        t_ms = (time.time() - t_start) * 1000
        logger.info(f"OptionsStrip OCR: {len(dets)}框 ({t_ms:.1f}ms)")
        return {"success": True, "dets": dets, "time_ms": round(t_ms, 1)}
    except Exception as e:
        logger.error(f"OptionsStrip OCR失败: {e}")
        return {"success": False, "error": str(e), "dets": []}


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


# ============ 识别错误截图收集 ============
# 标记答案错误时，把当前截图落地到项目路径，供后续批量纠错
_WRONG_CAPTURE_DIR = Path(__file__).resolve().parent / "keju_wrong_captures"
_WRONG_CAPTURE_DIR.mkdir(exist_ok=True)
_WRONG_INDEX_FILE = _WRONG_CAPTURE_DIR / "index.jsonl"
_WRONG_LOCK = threading.Lock()


@app.post("/api/keju/mark-wrong")
async def mark_wrong(
    img: UploadFile = File(...),
    data: str = Form("{}"),
):
    """标记识别答案错误：保存当前截图到项目路径，供后续批量纠错。

    请求:
      - img:  当前答题截图 (PNG)
      - data: JSON 字符串，含 qText / recognizedAnswer / categoryName 等元信息
    返回: { success, file, path }
    """
    try:
        meta = json.loads(data) if data else {}
    except Exception:
        meta = {}

    ts = time.strftime("%Y%m%d_%H%M%S")
    # 文件名: 时间戳 + 题目文本短哈希 + 毫秒，避免同题多次标记覆盖
    q = (meta.get("qText") or "")[:40]
    short = f"{abs(hash(q)) % 100000:05d}"
    ms = int((time.time() % 1) * 1000)
    fname = f"{ts}_{short}_{ms:03d}.png"
    img_path = _WRONG_CAPTURE_DIR / fname

    try:
        contents = await img.read()
        with open(img_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        logger.error(f"标记错误截图保存失败: {e}")
        return {"success": False, "error": f"截图保存失败: {str(e)}"}

    record = {
        "time": ts,
        "file": fname,
        "qText": meta.get("qText", ""),
        "recognizedAnswer": meta.get("recognizedAnswer", ""),
        "categoryName": meta.get("categoryName", ""),
        "corrected": False,
        "correctAnswer": "",
    }
    try:
        with _WRONG_LOCK:
            with open(_WRONG_INDEX_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.error(f"标记错误索引写入失败: {e}")

    logger.info(f"标记错误截图已保存: {fname} (题: {q[:30]})")
    return {"success": True, "file": fname, "path": str(img_path)}


# ============ 用户纠错覆盖层 (user_corrections.json) ============
# 独立的覆盖层文件：前端加载时作为最高优先级覆盖（内置库 -> 用户覆盖层 -> localStorage）。
# 不会被“合并脚本”流程重置，可单独增删改/导出。
_USER_CORRECTIONS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "public" / "mhxy" / "static" / "user_corrections.json"
_USER_CORRECTIONS_LOCK = threading.Lock()


def _load_user_corrections():
    if not _USER_CORRECTIONS_PATH.exists():
        return []
    try:
        with open(_USER_CORRECTIONS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.error(f"加载 user_corrections 失败: {e}")
        return []


def _save_user_corrections(data):
    # 写前备份
    try:
        if _USER_CORRECTIONS_PATH.exists():
            import shutil
            ts = time.strftime("%Y%m%d_%H%M%S")
            backup = _USER_CORRECTIONS_PATH.with_suffix(f".json.bak-{ts}")
            shutil.copy2(_USER_CORRECTIONS_PATH, backup)
    except Exception as e:
        logger.warning(f"user_corrections 备份失败(可忽略): {e}")
    _USER_CORRECTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_USER_CORRECTIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.post("/api/keju/hash-db/upsert")
async def upsert_correction(request: Request):
    """增/改一条用户纠错（独立覆盖层 user_corrections.json）。

    请求体: {stemHash, questionText, normQuestion, answer, correctOptionHashes, mode}
      - mode: 'text' 文字错误(更新答案) | 'box' 框选错误(仅更新位置)
      - normQuestion: 归一化题干（前端计算），用于文字通道匹配
    去重：同 stemHash 或同 normQuestion 视为同一条，更新而非新增。
    """
    try:
        body = await request.json()
    except Exception:
        return {"success": False, "error": "请求体不是有效的 JSON"}

    stem = (body.get("stemHash") or "").strip()
    answer = (body.get("answer") or "").strip()
    if not stem or not answer:
        return {"success": False, "error": "stemHash 与 answer 均为必填"}

    rec = {
        "stemHash": stem,
        "questionText": body.get("questionText", ""),
        "normQuestion": (body.get("normQuestion") or "").strip(),
        "answer": answer,
        "correctOptionHashes": body.get("correctOptionHashes") or None,
        "mode": body.get("mode", "text"),
        "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with _USER_CORRECTIONS_LOCK:
        data = _load_user_corrections()
        found = False
        for i, e in enumerate(data):
            if (e.get("stemHash") == stem) or (rec["normQuestion"] and e.get("normQuestion") == rec["normQuestion"]):
                data[i] = rec
                found = True
                break
        if not found:
            data.append(rec)
        _save_user_corrections(data)
    logger.info(f"用户纠错已写入覆盖层: stem={stem[:20]} answer={answer} mode={rec['mode']} (累计 {len(data)})")
    return {"success": True, "total": len(data), "updated": found}


@app.post("/api/keju/hash-db/delete")
async def delete_correction(request: Request):
    """从覆盖层删除一条用户纠错（按 stemHash 或 normQuestion）。"""
    try:
        body = await request.json()
    except Exception:
        return {"success": False, "error": "请求体不是有效的 JSON"}

    stem = (body.get("stemHash") or "").strip()
    norm = (body.get("normQuestion") or "").strip()
    if not stem and not norm:
        return {"success": False, "error": "需提供 stemHash 或 normQuestion"}

    with _USER_CORRECTIONS_LOCK:
        data = _load_user_corrections()
        before = len(data)
        data = [e for e in data if not (
            (stem and e.get("stemHash") == stem) or (norm and e.get("normQuestion") == norm)
        )]
        removed = before - len(data)
        if removed:
            _save_user_corrections(data)
    logger.info(f"用户纠错已删除: stem={stem[:20]} norm={norm[:20]} removed={removed}")
    return {"success": True, "removed": removed}


@app.post("/api/keju/wrong-capture/mark-corrected")
async def mark_wrong_corrected(request: Request):
    """标记某条错题库截图已纠正（写回 index.jsonl 的 corrected/correctAnswer 字段）。"""
    try:
        body = await request.json()
    except Exception:
        return {"success": False, "error": "请求体不是有效的 JSON"}

    fname = body.get("file")
    correct_answer = body.get("correctAnswer", "")
    if not fname:
        return {"success": False, "error": "file 必填"}

    try:
        with _WRONG_LOCK:
            lines = []
            if _WRONG_INDEX_FILE.exists():
                with open(_WRONG_INDEX_FILE, encoding="utf-8") as f:
                    lines = [l for l in f if l.strip()]
            new_lines = []
            for l in lines:
                try:
                    rec = json.loads(l)
                except Exception:
                    new_lines.append(l)
                    continue
                if rec.get("file") == fname:
                    rec["corrected"] = True
                    rec["correctAnswer"] = correct_answer
                new_lines.append(json.dumps(rec, ensure_ascii=False) + "\n")
            with open(_WRONG_INDEX_FILE, "w", encoding="utf-8") as f:
                f.writelines(new_lines)
        return {"success": True}
    except Exception as e:
        logger.error(f"标记错题库已纠正失败: {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_config=_build_uvicorn_log_config())
