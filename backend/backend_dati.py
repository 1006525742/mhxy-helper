#!/usr/bin/env python3
"""梦幻西游助手 - 答题助手后端 (看图说话 / 技能识别)

独立进程，端口 8008。
- 复用 keju 的 30 天日志轮转规范
- 题库: data/dati/dati_bank.json (263 条技能图标<->技能名, 含 aHash)
- 识别: 前端裁剪技能图标 -> 本服务算 aHash -> 与题库哈希汉明距离匹配 -> 返回候选技能名
- 选项: 前端传入 4 个选项文字 -> 与题库技能名匹配 -> 指出正确选项字母
"""
import io
import json
import logging
import re
import time
import threading
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

try:
    import cv2
    HAS_CV2 = True
except Exception:  # noqa
    cv2 = None
    HAS_CV2 = False

try:
    import httpx
    HAS_HTTPX = True
except Exception:  # noqa
    httpx = None
    HAS_HTTPX = False


# ============ 日志配置 (TimedRotatingFileHandler, 保留30天) ============
LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "dati-ocr.log"

from logging.handlers import TimedRotatingFileHandler  # noqa: E402

LOG_FORMAT = '%(asctime)s %(levelname)s %(message)s'
file_handler = TimedRotatingFileHandler(
    str(LOG_FILE), when="midnight", interval=1, backupCount=30, encoding="utf-8"
)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT))
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)
logger = logging.getLogger('dati')


def _build_uvicorn_log_config():
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": {"format": LOG_FORMAT}, "access": {"format": LOG_FORMAT}},
        "handlers": {
            "rotating_file": {
                "class": "logging.handlers.TimedRotatingFileHandler",
                "filename": str(LOG_FILE), "when": "midnight", "interval": 1,
                "backupCount": 30, "encoding": "utf-8", "formatter": "default",
            },
            "console": {"class": "logging.StreamHandler", "formatter": "default"},
        },
        "loggers": {
            "uvicorn": {"handlers": ["rotating_file", "console"], "level": "INFO", "propagate": False},
            "uvicorn.error": {"handlers": ["rotating_file", "console"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["rotating_file", "console"], "level": "WARNING", "propagate": False},
        },
    }


# ============ 题库加载 ============
BANK_DIR = Path(__file__).resolve().parent.parent / "data" / "dati"
BANK_PATH = BANK_DIR / "dati_bank.json"
ICON_DIR = BANK_DIR / "icons"
FRONT_ICON_PREFIX = "/mhxy/static/dati/icons/"

_bank: List[dict] = []
_bank_lock = threading.Lock()


def load_bank():
    global _bank
    try:
        data = json.loads(BANK_PATH.read_text(encoding="utf-8"))
        _bank = data
        logger.info(f"题库加载完成: {len(_bank)} 条技能")
    except Exception as e:
        logger.error(f"题库加载失败: {e}")
        _bank = []


# 导入即加载（兼容 uvicorn 模块启动方式）
load_bank()


# ============ httpx 客户端复用 ============
HTTPX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Referer": "https://175dt.com/31",
    "Accept": "application/json, text/javascript, */*",
}

_httpx_client = None


def _get_httpx_client():
    global _httpx_client
    if _httpx_client is None and HAS_HTTPX:
        _httpx_client = httpx.Client(http2=True, timeout=20, headers=HTTPX_HEADERS)
    return _httpx_client


# ============ 参考模板（cv2 matchTemplate 精排）============
_ref_templates: dict = {}


def prepare_icon(img: "Image.Image") -> "Image.Image":
    """统一基准：任意图 -> 64x64 白底、图标前景居中。"""
    img = img.convert("RGBA")
    alpha = img.split()[3]
    if alpha.getextrema()[0] < 250:
        bbox = alpha.getbbox()
        if bbox:
            img = img.crop(bbox)
    else:
        arr = np.asarray(img.convert("RGB")).astype(int)
        h, w, _ = arr.shape
        corners = [arr[0:10, 0:10], arr[0:10, -10:],
                   arr[-10:, 0:10], arr[-10:, -10:]]
        bg = np.mean([c.reshape(-1, 3) for c in corners], 0).mean(0)
        diff = np.sqrt(((arr - bg) ** 2).sum(-1))
        ys, xs = np.where(diff > 40)
        if len(xs):
            img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    fw, fh = img.size
    s = 64.0 / max(fw, fh)
    nw, nh = max(1, int(fw * s)), max(1, int(fh * s))
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (64, 64), (255, 255, 255, 255))
    canvas.paste(img, ((64 - nw) // 2, (64 - nh) // 2), img.split()[3])
    return canvas.convert("RGB")


def build_ref_templates():
    """预计算题库每个图标的 64x64 灰度模板，供匹配时做像素级精排。"""
    global _ref_templates
    _ref_templates = {}
    if not HAS_CV2:
        logger.warning("未找到 cv2，图标识别降级为纯 aHash")
        return
    ok = 0
    for b in _bank:
        try:
            im = Image.open(ICON_DIR / Path(b["icon"]).name)
            im = prepare_icon(im).resize((64, 64))
            _ref_templates[b["name"]] = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
            ok += 1
        except Exception:  # noqa
            continue
    logger.info(f"参考模板构建完成: {ok}/{len(_bank)} 个")


# ============ 175dt 图标缓存 ============
_175dt_icon_dir: Path = BANK_DIR / "175dt_icons"
_175dt_map_file: Path = BANK_DIR / "175dt_icon_map.json"
_175dt_icon_map: dict = {}


def _load_175dt_map():
    global _175dt_icon_map
    if _175dt_map_file.exists():
        try:
            _175dt_icon_map = json.loads(_175dt_map_file.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"175dt 图标映射加载失败: {e}")
            _175dt_icon_map = {}


_load_175dt_map()


def _save_175dt_map():
    try:
        _175dt_map_file.write_text(json.dumps(_175dt_icon_map, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"175dt 图标映射保存失败: {e}")


def _get_175dt_icon(name: str) -> Optional[Path]:
    """获取技能名对应的 175dt 图标文件；本地没有则尝试从 175dt 拉取并缓存。"""
    _175dt_icon_dir.mkdir(parents=True, exist_ok=True)
    local = _175dt_icon_dir / (name + ".png")
    if local.exists():
        return local
    if not HAS_HTTPX:
        return None
    url = _175dt_icon_map.get(name)
    if not url:
        try:
            client = _get_httpx_client()
            if client is None:
                return None
            r = client.get(f"https://s.175dt.com/?id=31&kw={name}&c=10000")
            if r.status_code != 200:
                return None
            data = r.json()
            if data.get("status") != 200 or not data.get("hits"):
                return None
            html = data["hits"][0].get("a", "")
            m = re.search(r"src='(/img/[a-f0-9]+\.png)'", html)
            if not m:
                return None
            url = "https://175dt.com" + m.group(1)
            _175dt_icon_map[name] = url
            _save_175dt_map()
        except Exception as e:
            logger.warning(f"175dt 查询 {name} 失败: {e}")
            return None
    if not url:
        return None
    try:
        client = _get_httpx_client()
        if client is None:
            return None
        r = client.get(url)
        r.raise_for_status()
        local.write_bytes(r.content)
        return local
    except Exception as e:
        logger.warning(f"175dt 下载 {name} ({url}) 失败: {e}")
        return None


def _ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(np.float64) - a.mean()
    b = b.astype(np.float64) - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def _phash(im: Image.Image) -> int:
    """64-bit perceptual hash（DCT pHash）"""
    gray = im.convert("L").resize((32, 32), Image.LANCZOS)
    arr = np.asarray(gray, dtype=np.float64)
    N = 32
    u = np.arange(N)[:, None]
    k = np.arange(N)[None, :]
    alpha = np.sqrt(2.0 / N) * np.ones((N, 1))
    alpha[0] = np.sqrt(1.0 / N)
    C = alpha * np.cos(np.pi / N * (u + 0.5) * k)
    dct = C @ arr @ C.T
    low = dct[:8, :8]
    mean = low.mean()
    bits = low > mean
    val = 0
    for i in range(8):
        for j in range(8):
            if bits[i, j]:
                val |= 1 << (i * 8 + j)
    return val


def _hamming_int(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def ahash_bytes(img_bytes: bytes, size: int = 8) -> Optional[str]:
    try:
        img = Image.open(io.BytesIO(img_bytes))
        img = prepare_icon(img).convert("L").resize((size, size), Image.LANCZOS)
        arr = np.asarray(img, dtype=np.float64)
        mean = arr.mean()
        bits = (arr.flatten() > mean)
        h = 0
        for b in bits:
            h = (h << 1) | int(b)
        return format(h, "016x")
    except Exception as e:
        logger.error(f"aHash 失败: {e}")
        return None


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


# ============ FastAPI ============
app = FastAPI(title="梦幻西游助手 - 答题助手", description="技能图标识别与答题匹配", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "dati", "bank_size": len(_bank)}


@app.post("/api/dati/icon-match")
async def icon_match(img: UploadFile = File(...)):
    """技能图标匹配: 上传裁剪后的技能图标 -> 返回 top5 候选技能"""
    t0 = time.time()
    try:
        data = await img.read()
        qimg = Image.open(io.BytesIO(data))
        qprep = prepare_icon(qimg).resize((64, 64))
        qh = ahash_bytes(data)
        if qh is None:
            return {"success": False, "error": "图标解析失败"}

        if HAS_CV2 and _ref_templates:
            qg = cv2.cvtColor(np.asarray(qprep), cv2.COLOR_RGB2GRAY)
            scored = []
            for b in _bank:
                g = _ref_templates.get(b["name"])
                if g is None:
                    continue
                res = cv2.matchTemplate(qg, g, cv2.TM_CCOEFF_NORMED)
                scored.append((float(res[0][0]), b))
            scored.sort(key=lambda x: -x[0])
            cands = []
            for s, b in scored[:5]:
                d = hamming(qh, b["phash"])
                cands.append({
                    "name": b["name"], "school": b["school"],
                    "dist": d, "score": round((1 - d / 64.0) * 100, 1),
                    "mt_score": round(s * 100, 1),
                    "icon": FRONT_ICON_PREFIX + Path(b["icon"]).name,
                })
            low_conf = cands[0]["mt_score"] < 75
        else:
            cands = []
            for b in _bank:
                d = hamming(qh, b["phash"])
                cands.append({"name": b["name"], "school": b["school"],
                              "dist": d, "score": round((1 - d / 64.0) * 100, 1),
                              "icon": FRONT_ICON_PREFIX + Path(b["icon"]).name})
            cands.sort(key=lambda x: x["dist"])
            cands = cands[:5]
            low_conf = cands[0]["score"] < 60

        t_ms = (time.time() - t0) * 1000
        logger.info(f"icon-match: top={cands[0]['name']}(mt={cands[0].get('mt_score','-')}%) ({t_ms:.1f}ms)")
        return {"success": True, "query_hash": qh, "time_ms": round(t_ms, 1),
                "candidates": cands, "low_confidence": low_conf}
    except Exception as e:
        logger.error(f"icon-match 失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/dati/options-match")
async def options_match(req: Request):
    """选项匹配: 传入 4 个选项文字 -> 指出与题库技能名最匹配的选项字母"""
    try:
        body = await req.json()
        options = body.get("options") or []
        recognized = body.get("recognized") or ""
        norm = []
        for i, o in enumerate(options):
            txt = o.split(".", 1)[-1].strip() if "." in o[:3] else o.strip()
            norm.append(txt)
            if not recognized and txt in {b["name"] for b in _bank}:
                recognized = txt
        matched_name = ""
        if recognized:
            for b in _bank:
                if recognized == b["name"] or recognized in b["name"] or b["name"] in recognized:
                    matched_name = b["name"]
                    break
        hit_index = -1
        if matched_name:
            for i, txt in enumerate(norm):
                if txt == matched_name or matched_name in txt or txt in matched_name:
                    hit_index = i
                    break
        letter = chr(ord("A") + hit_index) if hit_index >= 0 else ""
        logger.info(f"options-match: recognized={recognized} -> {letter} ({matched_name})")
        return {"success": True, "recognized": recognized, "matched_name": matched_name,
                "option_letter": letter, "option_index": hit_index, "options": norm}
    except Exception as e:
        logger.error(f"options-match 失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/dati/search")
async def search(req: Request):
    """按技能名文本模糊搜索题库"""
    try:
        body = await req.json()
        kw = (body.get("text") or "").strip()
        if not kw:
            return {"success": True, "results": []}
        results = [{"name": b["name"], "school": b["school"],
                    "icon": FRONT_ICON_PREFIX + Path(b["icon"]).name}
                   for b in _bank if kw in b["name"] or kw in b["school"]]
        logger.info(f"search: '{kw}' -> {len(results)} 条")
        return {"success": True, "results": results[:20]}
    except Exception as e:
        logger.error(f"search 失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/dati/report")
async def report(req: Request):
    """纠错上报"""
    try:
        body = await req.json()
        name = (body.get("correct_name") or "").strip()
        note = body.get("note") or ""
        if not name:
            return {"success": False, "error": "缺少 correct_name"}
        rep_path = BANK_DIR / "dati_reports.json"
        reports = []
        if rep_path.exists():
            reports = json.loads(rep_path.read_text(encoding="utf-8"))
        reports.append({"correct_name": name, "note": note, "at": int(time.time())})
        rep_path.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"纠错上报: {name} (累计 {len(reports)})")
        return {"success": True, "total": len(reports)}
    except Exception as e:
        logger.error(f"report 失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/dati/options-icon-match")
async def options_icon_match(
    img: UploadFile = File(...),
    options: str = Form(...),
    top_n: int = Form(4),
):
    """看图说话 4 选 1 图标匹配（单图 + 选项文字）"""
    try:
        opts = [o.strip() for o in options.split(",") if o.strip()]
        if len(opts) < 2:
            return {"success": False, "error": "至少需要 2 个选项"}

        content = await img.read()
        q_img = Image.open(io.BytesIO(content)).convert("RGB")
        q_gray = np.asarray(prepare_icon(q_img).convert("L").resize((64, 64), Image.LANCZOS))

        scores = []
        fallback_hits = 0
        for opt in opts:
            icon_path = _get_175dt_icon(opt)
            if icon_path is None:
                local_icon = None
                for b in _bank:
                    if b.get("name") == opt:
                        local_icon = ICON_DIR / Path(b["icon"]).name
                        break
                if local_icon and local_icon.exists():
                    icon_path = local_icon
                    fallback_hits += 1
            if icon_path is None:
                scores.append({"name": opt, "score": -1.0, "source": "missing"})
                continue
            ref = Image.open(icon_path).convert("RGBA")
            ref_gray = np.asarray(prepare_icon(ref).convert("L").resize((64, 64), Image.LANCZOS))
            s = _ncc(q_gray, ref_gray)
            scores.append({"name": opt, "score": round(s, 4),
                           "source": "175dt" if icon_path.parent.name == "175dt_icons" else "local"})

        scores.sort(key=lambda x: x["score"], reverse=True)
        best = scores[0] if scores else {}
        logger.info(f"options-icon-match: opts={opts} best={best.get('name')} score={best.get('score')}")
        return {
            "success": True,
            "options": scores[:top_n],
            "best": best,
            "best_index": opts.index(best["name"]) if best and best.get("name") in opts else -1,
            "best_letter": chr(ord("A") + opts.index(best["name"])) if best and best.get("name") in opts else "",
        }
    except Exception as e:
        logger.error(f"options-icon-match 失败: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
#                       纯水墨投影定位（不依赖 YOLO）
# =============================================================================

CONFIG = {
    # --- 弹窗颜色分割（半透明蓝紫色底）---
    # 实测 2024-09-11：弹窗背景 H≈114-116, S≈39-58, V≈192-210
    # 范围略放宽以容忍不同分辨率/皮肤的色差
    "dialog_hsv_lo": (100, 10, 150),
    "dialog_hsv_hi": (135, 100, 230),
    "dialog_morph_kernel": 15,
    "dialog_min_area_ratio": 0.08,       # 面积下限放宽到 8%（高分辨率下弹窗占比小）

    # --- 弹窗内选项区范围（相对弹窗高度）---
    # 选项按钮位于弹窗下半部分；上半部分通常是题干/NPC 头像
    "options_y_lo": 0.50,
    "options_y_hi": 0.88,

    # --- 按钮底色 HSV 分割（方案 A，主路径）---
    # 梦幻西游答题按钮：浅蓝底色，实测 H≈95-155, S≈15-110, V≈140-240
    # 范围略宽以适应不同分辨率/色差
    "button_hsv_lo": (95, 15, 140),
    "button_hsv_hi": (155, 110, 240),
    "button_area_lo": 0.02,          # 面积下限：弹窗面积的 2%
    "button_area_hi": 0.20,          # 面积上限：弹窗面积的 20%
    "button_aspect_lo": 1.5,         # 宽高比下限（按钮明显比高）
    "button_aspect_hi": 8.0,         # 宽高比上限

    # --- 选项格向外 padding（覆盖整个按钮色块，单位像素）---
    "cell_pad_left": 30,       # 左扩多一些，包住 A/B/C/D 圆形字母
    "cell_pad_right": 15,
    "cell_pad_top": 8,
    "cell_pad_bottom": 8,

    # --- 墨水判定（dati 选项文字：深蓝紫字写在浅蓝按钮上）---
    # 均值低 + 饱和度低 = 深色文字；避免误抓彩色 NPC / 图标
    "ink_avg_max": 135,
    "ink_sat_max": 75,
    "ink_avg_min": 30,         # 方案 B 改进：排除纯黑阴影/边框

    # --- 按钮投影（浅蓝按钮底色）---
    "button_avg_min": 160,     # 按钮亮度下限（实测 median=167）
    "button_sat_max": 90,      # 按钮饱和度上限
    "button_proj_thr_ratio": 0.35,  # 按钮投影阈值比例（比文字高，排除背景噪声）

    # --- 投影参数 ---
    "row_smooth_ratio": 0.008,
    "col_smooth_ratio": 0.006,
    "row_thr_width_ratio": 0.02,
    "row_thr_peak_ratio": 0.10,
    "row_min_height_ratio": 0.012,
    "row_merge_gap_ratio": 0.02,
    "row_bottom_limit": 0.85,
    "col_thr_row_ratio": 0.05,
    "col_min_width_ratio": 0.012,

    # --- 模板匹配阈值 ---
    "tm_scales": [36, 40, 44, 48, 52, 56, 60, 64, 68, 76],
    "tm_conf": 0.60,
    "tm_floor": 0.10,
    "tm_margin": 0.04,
}


_OCR_NOISE = {
    "看图说话", "请指出下图中所对应的技能或法术名称：", "连答模式", "离开答题",
    "A", "B", "C", "D", "A.", "B.", "C.", "D.",
    "务追踪", "表没有任务", "申请加入", "真聪明，少侠获得了", "有",
}
_OCR_NOISE_RE = [
    re.compile(r"^连对\d+$"),
    re.compile(r"^\d+点看图说话积分.*$"),
    re.compile(r"^有\d+点看图说话积分.*$"),
]
_OCR_URL = "http://127.0.0.1:8001/api/ocr/options"


def _find_dialog_by_color(im: Image.Image) -> Optional[dict]:
    """颜色阈值 + 连通域，找答题弹窗矩形。

    Returns: {"x", "y", "w", "h"} 或 None
    """
    if not HAS_CV2:
        return None
    try:
        img = np.asarray(im.convert("RGB"))[:, :, ::-1].copy()  # RGB -> BGR
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        lo = np.array(CONFIG["dialog_hsv_lo"])
        hi = np.array(CONFIG["dialog_hsv_hi"])
        mask = cv2.inRange(hsv, lo, hi)

        k = CONFIG["dialog_morph_kernel"]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        cnt = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(cnt)
        total = img.shape[0] * img.shape[1]
        ratio = area / total
        if ratio < CONFIG["dialog_min_area_ratio"]:
            logger.info(f"[dialog] 面积占比 {ratio:.3f} < 阈值 {CONFIG['dialog_min_area_ratio']}")
            return None
        x, y, w, h = cv2.boundingRect(cnt)
        logger.info(f"[dialog] 弹窗 x={x} y={y} w={w} h={h} area_ratio={ratio:.3f}")
        return {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
    except Exception as e:
        logger.warning(f"[dialog] 检测失败: {e}")
        return None


def _fallback_dialog(im: Image.Image) -> dict:
    """弹窗颜色分割失败时的兜底：用固定比例。"""
    W, H = im.size
    return {"x": int(W * 0.15), "y": int(H * 0.25),
            "w": int(W * 0.70), "h": int(H * 0.50)}


def _answer_cells_by_button_color(im: Image.Image, dialog_rect: dict) -> list:
    """方案 A：HSV 分割"浅蓝按钮底色"，直接拿按钮外接矩形作 A/B/C/D 四格。

    不依赖文字/墨水，天然贴合按钮实际边界。失败返回 [] 让上层回退水墨投影。

    Returns:
        4 个 {x, y, w, h}（全图绝对像素），顺序 A/B/C/D。失败返回 []。
    """
    if not HAS_CV2:
        return []
    try:
        ox, oy = int(dialog_rect["x"]), int(dialog_rect["y"])
        ow, oh = int(dialog_rect["w"]), int(dialog_rect["h"])
        y_start = oy + int(oh * CONFIG["options_y_lo"])
        y_end = oy + int(oh * CONFIG["options_y_hi"])
        y_start = max(0, y_start)
        y_end = min(im.size[1], y_end)
        crop = im.crop((max(0, ox), y_start, min(im.size[0], ox + ow), y_end)).convert("RGB")
        cw, ch = crop.size
        if cw < 40 or ch < 40:
            return []

        crop_bgr = np.asarray(crop)[:, :, ::-1].copy()
        hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
        lo = np.array(CONFIG["button_hsv_lo"])
        hi = np.array(CONFIG["button_hsv_hi"])
        mask = cv2.inRange(hsv, lo, hi)

        # 开运算去散点噪声，闭运算补按钮内文字造成的孔洞
        k = max(3, int(min(cw, ch) * 0.012)) | 1
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        dialog_area = float(ow * oh)
        lo_area = dialog_area * CONFIG["button_area_lo"]
        hi_area = dialog_area * CONFIG["button_area_hi"]

        boxes = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if not (lo_area <= area <= hi_area):
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            if h <= 0:
                continue
            ar = w / float(h)
            if not (CONFIG["button_aspect_lo"] <= ar <= CONFIG["button_aspect_hi"]):
                continue
            # 填充率：轮廓面积/外接矩形面积，按钮应较实心
            if area / (w * h) < 0.5:
                continue
            boxes.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "area": area})

        if len(boxes) != 4:
            logger.info(f"[button] 候选按钮数 {len(boxes)} != 4 (阈值内 {lo_area:.0f}~{hi_area:.0f})")
            return []

        # 按 y 分 2 行、每行按 x 排序 -> A/B/C/D
        boxes.sort(key=lambda b: (b["y"], b["x"]))
        row_h = boxes[0]["h"]
        top = sorted([b for b in boxes if b["y"] < boxes[2]["y"] - row_h * 0.3] or boxes[:2],
                     key=lambda b: b["x"])
        bot = sorted([b for b in boxes if b not in top], key=lambda b: b["x"])
        if len(top) != 2 or len(bot) != 2:
            logger.info(f"[button] 行分组失败 top={len(top)} bot={len(bot)}")
            return []

        cells = [
            {"x": ox + top[0]["x"], "y": y_start + top[0]["y"], "w": top[0]["w"], "h": top[0]["h"]},
            {"x": ox + top[1]["x"], "y": y_start + top[1]["y"], "w": top[1]["w"], "h": top[1]["h"]},
            {"x": ox + bot[0]["x"], "y": y_start + bot[0]["y"], "w": bot[0]["w"], "h": bot[0]["h"]},
            {"x": ox + bot[1]["x"], "y": y_start + bot[1]["y"], "w": bot[1]["w"], "h": bot[1]["h"]},
        ]
        # Sanity: 高度差不应过大（同一弹窗内按钮等高）
        hs = [c["h"] for c in cells]
        if max(hs) / max(1, min(hs)) > 1.8:
            logger.info(f"[button] 按钮高度差异常 {hs}")
            return []
        logger.info(f"[button] OK cells={cells}")
        return cells
    except Exception as e:
        logger.warning(f"[button] 按钮底色分割失败: {e}")
        return []


def _ink_mask_from_crop(crop_bgr: np.ndarray) -> np.ndarray:
    """从裁出的选项区提取"深色低饱和文字"墨水图。

    dati 选项文字：深蓝紫字写在浅蓝按钮上 -> 均值低、饱和度低。
    返回 0/1 float32 数组，形状与 crop_bgr 前两维相同。
    """
    arr = crop_bgr.astype(np.int32)
    r, g, b = arr[:, :, 2], arr[:, :, 1], arr[:, :, 0]  # BGR -> RGB
    avg = (r + g + b) / 3.0
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    ink = ((avg < CONFIG["ink_avg_max"]) & (sat <= CONFIG["ink_sat_max"])
           & (avg > CONFIG["ink_avg_min"])).astype(np.float32)
    return ink


def _button_mask_from_crop(crop_bgr: np.ndarray) -> np.ndarray:
    """从裁出的选项区提取"浅蓝按钮"墨水图。

    dati 按钮：浅蓝底（V 高、S 中低），比弹窗深紫蓝底亮很多。
    返回 0/1 float32 数组。
    """
    arr = crop_bgr.astype(np.int32)
    r, g, b = arr[:, :, 2], arr[:, :, 1], arr[:, :, 0]  # BGR -> RGB
    avg = (r + g + b) / 3.0
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    # 按钮底色：亮（avg 高）、饱和度中低（排除树木绿、NPC 彩色）
    mask = ((avg > CONFIG.get("button_avg_min", 180)) & (sat < CONFIG.get("button_sat_max", 90))).astype(np.float32)

    # 调试日志：输出按钮区域的 avg/sat 中位数
    if mask.sum() > 0:
        btn_pixels = (avg * mask).sum() / mask.sum()
        btn_sat = (sat * mask).sum() / mask.sum()
        logger.info(f"[button_proj] 按钮像素 avg={btn_pixels:.1f} sat={btn_sat:.1f}")
    return mask


def _smooth(a: np.ndarray, radius: int) -> np.ndarray:
    radius = max(1, int(round(radius)))
    k = np.ones(radius * 2 + 1, dtype=np.float32) / (radius * 2 + 1)
    return np.convolve(a, k, mode="same")


def _find_segments(proj: np.ndarray, thresh: float, min_w: int, merge_gap: int) -> list:
    """在 1D 投影曲线上找连续超过阈值的波段，返回 [[start, end, peak], ...]。"""
    raw = []
    in_p = False
    start = 0
    peak = 0.0
    for i in range(len(proj)):
        if proj[i] >= thresh:
            if not in_p:
                start = i
                peak = float(proj[i])
                in_p = True
            else:
                peak = max(peak, float(proj[i]))
        elif in_p:
            raw.append([start, i, peak])
            in_p = False
            peak = 0.0
    if in_p:
        raw.append([start, len(proj), peak])
    merged = []
    for s, e, p in raw:
        if merged and s - merged[-1][1] <= merge_gap:
            merged[-1][1] = e
            merged[-1][2] = max(merged[-1][2], p)
        else:
            merged.append([s, e, p])
    return [m for m in merged if (m[1] - m[0]) >= min_w]


def _answer_cells_projection(im: Image.Image, dialog_rect: dict) -> list:
    """水墨投影重建 A/B/C/D 四格（纯图像处理）。

    流程：
    1. 弹窗下半部分（options_y_lo~hi）裁出选项区
    2. 用"深色低饱和"像素提取文字墨水图
    3. 水平投影找 2 个文字行
    4. 每行垂直投影找左/右 2 个文字列
    5. 用行/列间隙中点作分割线，向外 padding 覆盖整块按钮

    Args:
        im: PIL Image 全图
        dialog_rect: {"x", "y", "w", "h"} 弹窗坐标

    Returns:
        4 个 {x, y, w, h}（全图绝对像素），顺序 A/B/C/D。失败返回 []。
    """
    if not HAS_CV2:
        return []
    try:
        ox, oy = int(dialog_rect["x"]), int(dialog_rect["y"])
        ow, oh = int(dialog_rect["w"]), int(dialog_rect["h"])
        y_start = oy + int(oh * CONFIG["options_y_lo"])
        y_end = oy + int(oh * CONFIG["options_y_hi"])
        crop = im.crop((ox, y_start, ox + ow, y_end)).convert("RGB")
        cw, ch = crop.size
        if cw < 20 or ch < 20:
            return []

        crop_bgr = np.asarray(crop)[:, :, ::-1].copy()  # RGB -> BGR
        ink = _ink_mask_from_crop(crop_bgr)

        # ===== Step 1: 水平投影 -> 找文字行 =====
        h_proj = ink.sum(axis=1)
        h_sm = _smooth(h_proj, max(2, int(ch * CONFIG["row_smooth_ratio"])))
        h_thr = max(cw * CONFIG["row_thr_width_ratio"],
                    h_sm.max() * CONFIG["row_thr_peak_ratio"])
        h_segments = _find_segments(
            h_sm, h_thr,
            max(3, int(ch * CONFIG["row_min_height_ratio"])),
            max(5, int(ch * CONFIG["row_merge_gap_ratio"])),
        )
        # 过滤底部 UI（连答模式 / 离开答题）
        h_segments = [s for s in h_segments if s[0] < ch * CONFIG["row_bottom_limit"]]

        if len(h_segments) < 2:
            logger.info(f"[proj] 水平行簇不足: {len(h_segments)} (threshold={h_thr:.1f})")
            return _fallback_grid_cells(dialog_rect)

        # 取最上面 2 个（按 y 升序）
        top_row, bot_row = sorted(h_segments[:2], key=lambda s: s[0])

        # ===== Step 2: 每行垂直投影 -> 找左右 2 列 =====
        def find_cols_in_row(row_ink: np.ndarray, row_h: int):
            v_proj = row_ink.sum(axis=0)
            v_sm = _smooth(v_proj, max(2, int(cw * CONFIG["col_smooth_ratio"])))
            v_thr = max(row_h * CONFIG["col_thr_row_ratio"],
                        v_sm.max() * 0.05)
            v_segments = _find_segments(
                v_sm, v_thr,
                max(3, int(cw * CONFIG["col_min_width_ratio"])),
                max(3, int(cw * CONFIG["col_min_width_ratio"])),
            )
            if len(v_segments) < 2:
                return None
            v_segments.sort(key=lambda s: s[0])
            return v_segments[0], v_segments[-1]

        row_cols = []
        for row in (top_row, bot_row):
            rs, re = int(row[0]), int(row[1])
            cols = find_cols_in_row(ink[rs:re, :], re - rs)
            if cols is None:
                logger.info(f"[proj] 行 {rs}-{re} 列簇不足")
                return _fallback_grid_cells(dialog_rect)
            row_cols.append(cols)

        top_left, top_right = row_cols[0]
        bot_left, bot_right = row_cols[1]

        # ===== Step 3: 计算分割线 =====
        x_mid_candidates = []
        if top_right[0] > top_left[1]:
            x_mid_candidates.append((top_left[1] + top_right[0]) // 2)
        if bot_right[0] > bot_left[1]:
            x_mid_candidates.append((bot_left[1] + bot_right[0]) // 2)
        if not x_mid_candidates:
            logger.info(f"[proj] 左右列无间隙")
            return _fallback_grid_cells(dialog_rect)
        x_mid = int(np.median(x_mid_candidates))
        y_mid = (int(top_row[1]) + int(bot_row[0])) // 2

        # ===== Step 4: 向外 padding 覆盖按钮色块（比例自适应） =====
        # 行宽作为基准，不同分辨率自适应
        row_h_avg = (int(top_row[1] - top_row[0]) + int(bot_row[1] - bot_row[0])) // 2
        pad_left = max(5, int(row_h_avg * 0.6))    # 左扩多一些，包住 A/B/C/D 圆形字母
        pad_right = max(3, int(row_h_avg * 0.25))
        pad_top = max(2, int(row_h_avg * 0.15))
        pad_bottom = max(2, int(row_h_avg * 0.15))

        x_left = max(0, min(top_left[0], bot_left[0]) - pad_left)
        x_right = min(cw, max(top_right[1], bot_right[1]) + pad_right)
        y_top = max(0, int(top_row[0]) - pad_top)
        y_bot = min(ch, int(bot_row[1]) + pad_bottom)

        cells = [
            {"x": ox + x_left,  "y": y_start + y_top,  "w": x_mid - x_left,  "h": y_mid - y_top},   # A
            {"x": ox + x_mid,   "y": y_start + y_top,  "w": x_right - x_mid, "h": y_mid - y_top},   # B
            {"x": ox + x_left,  "y": y_start + y_mid,  "w": x_mid - x_left,  "h": y_bot - y_mid},   # C
            {"x": ox + x_mid,   "y": y_start + y_mid,  "w": x_right - x_mid, "h": y_bot - y_mid},   # D
        ]
        cells = [{k: int(v) for k, v in c.items()} for c in cells]

        # ===== Sanity: 4 格面积应接近相等 =====
        areas = [c["w"] * c["h"] for c in cells]
        if min(areas) <= 0:
            return _fallback_grid_cells(dialog_rect)
        if max(areas) / min(areas) > 2.5:
            logger.info(f"[proj] 面积比异常 {max(areas)/min(areas):.2f}")
            return _fallback_grid_cells(dialog_rect)

        logger.info(
            f"[proj] OK rows={len(h_segments)} "
            f"x=[{x_left}-{x_mid}-{x_right}] y=[{y_top}-{y_mid}-{y_bot}]"
        )
        return cells

    except Exception as e:
        logger.warning(f"[proj] 投影法失败: {e}")
        return _fallback_grid_cells(dialog_rect)


def _answer_cells_by_button_projection(im: Image.Image, dialog_rect: dict) -> list:
    """按钮投影重建 A/B/C/D 四格。

    复制 _answer_cells_projection 的流程，但用"浅蓝按钮"替代"深色文字"作墨水图。
    不做 padding（框的就是按钮边界），用相对位置分类 A/B/C/D。

    流程：
    1. 弹窗下半部分裁出选项区
    2. 用"亮低饱和"像素提取按钮墨水图
    3. 水平投影找 2 个按钮行
    4. 每行垂直投影找左/右 2 个按钮列
    5. 用相对位置（横<0.5 左、纵<0.72 上）分类 A/B/C/D
    6. 面积过滤：每格占弹窗面积应在 1.5%~22%

    Returns:
        4 个 {x, y, w, h}（全图绝对像素），顺序 A/B/C/D。失败返回 []。
    """
    if not HAS_CV2:
        return []
    try:
        ox, oy = int(dialog_rect["x"]), int(dialog_rect["y"])
        ow, oh = int(dialog_rect["w"]), int(dialog_rect["h"])
        y_start = oy + int(oh * CONFIG["options_y_lo"])
        y_end = oy + int(oh * CONFIG["options_y_hi"])
        crop = im.crop((ox, y_start, ox + ow, y_end)).convert("RGB")
        cw, ch = crop.size
        if cw < 20 or ch < 20:
            return []

        crop_bgr = np.asarray(crop)[:, :, ::-1].copy()  # RGB -> BGR
        btn_mask = _button_mask_from_crop(crop_bgr)

        # ===== Step 1: 水平投影 -> 找按钮行 =====
        h_proj = btn_mask.sum(axis=1)
        h_sm = _smooth(h_proj, max(2, int(ch * CONFIG["row_smooth_ratio"])))
        # 按钮投影阈值更高，排除背景噪声
        h_thr = h_sm.max() * CONFIG["button_proj_thr_ratio"]
        h_segments = _find_segments(
            h_sm, h_thr,
            max(3, int(ch * CONFIG["row_min_height_ratio"])),
            max(5, int(ch * CONFIG["row_merge_gap_ratio"])),
        )
        # 过滤底部 UI
        h_segments = [s for s in h_segments if s[0] < ch * CONFIG["row_bottom_limit"]]

        logger.info(f"[button_proj] h_proj max={h_proj.max():.1f} h_sm max={h_sm.max():.1f} thr={h_thr:.1f} ch={ch} segments={len(h_segments)}")

        if len(h_segments) < 2:
            logger.info(f"[button_proj] 水平行簇不足: {len(h_segments)} (threshold={h_thr:.1f})")
            return []

        # 取最上面 2 个（按 y 升序）
        top_row, bot_row = sorted(h_segments[:2], key=lambda s: s[0])

        # ===== Step 2: 每行垂直投影 -> 找左右 2 列 =====
        def find_cols_in_row(row_mask: np.ndarray, row_h: int):
            v_proj = row_mask.sum(axis=0)
            v_sm = _smooth(v_proj, max(2, int(cw * CONFIG["col_smooth_ratio"])))
            v_thr = max(row_h * CONFIG["col_thr_row_ratio"],
                        v_sm.max() * 0.05)
            v_segments = _find_segments(
                v_sm, v_thr,
                max(3, int(cw * CONFIG["col_min_width_ratio"])),
                max(3, int(cw * CONFIG["col_min_width_ratio"])),
            )
            if len(v_segments) < 2:
                return None
            v_segments.sort(key=lambda s: s[0])
            return v_segments[0], v_segments[-1]

        row_cols = []
        for row in (top_row, bot_row):
            rs, re = int(row[0]), int(row[1])
            cols = find_cols_in_row(btn_mask[rs:re, :], re - rs)
            if cols is None:
                logger.info(f"[button_proj] 行 {rs}-{re} 列簇不足")
                return []
            row_cols.append(cols)

        top_left, top_right = row_cols[0]
        bot_left, bot_right = row_cols[1]

        # ===== Step 3: 用相对位置分类 A/B/C/D（不做 padding）=====
        # 收集所有 4 个按钮框
        boxes = [
            {"x": int(top_left[0]), "y": int(top_row[0]), "w": int(top_left[1] - top_left[0]), "h": int(top_row[1] - top_row[0])},
            {"x": int(top_right[0]), "y": int(top_row[0]), "w": int(top_right[1] - top_right[0]), "h": int(top_row[1] - top_row[0])},
            {"x": int(bot_left[0]), "y": int(bot_row[0]), "w": int(bot_left[1] - bot_left[0]), "h": int(bot_row[1] - bot_row[0])},
            {"x": int(bot_right[0]), "y": int(bot_row[0]), "w": int(bot_right[1] - bot_right[0]), "h": int(bot_row[1] - bot_row[0])},
        ]

        # 用相对位置分类：横 < cw/2 左侧，纵 < ch*0.72 上侧
        x_split = cw // 2
        y_split = int(ch * 0.72)

        cells = [None] * 4  # A, B, C, D
        for box in boxes:
            cx = box["x"] + box["w"] // 2
            cy = box["y"] + box["h"] // 2
            if cx < x_split and cy < y_split:
                cells[0] = box  # A
            elif cx >= x_split and cy < y_split:
                cells[1] = box  # B
            elif cx < x_split and cy >= y_split:
                cells[2] = box  # C
            else:
                cells[3] = box  # D

        if any(c is None for c in cells):
            logger.info(f"[button_proj] 位置分类失败 cells={cells}")
            return []

        # 转为全图绝对坐标
        cells = [
            {"x": ox + cells[0]["x"], "y": y_start + cells[0]["y"], "w": cells[0]["w"], "h": cells[0]["h"]},
            {"x": ox + cells[1]["x"], "y": y_start + cells[1]["y"], "w": cells[1]["w"], "h": cells[1]["h"]},
            {"x": ox + cells[2]["x"], "y": y_start + cells[2]["y"], "w": cells[2]["w"], "h": cells[2]["h"]},
            {"x": ox + cells[3]["x"], "y": y_start + cells[3]["y"], "w": cells[3]["w"], "h": cells[3]["h"]},
        ]

        # ===== Step 4: 面积过滤 =====
        dialog_area = ow * oh
        for i, c in enumerate(cells):
            cell_area = c["w"] * c["h"]
            ratio = cell_area / dialog_area
            if not (0.015 <= ratio <= 0.22):
                logger.info(f"[button_proj] 格 {i} 面积比 {ratio:.3f} 不在 1.5%~22%")
                return []

        logger.info(
            f"[button_proj] OK rows={len(h_segments)} "
            f"boxes={[(b['x'], b['y'], b['w'], b['h']) for b in boxes]}"
        )
        return cells

    except Exception as e:
        logger.warning(f"[button_proj] 按钮投影失败: {e}")
        return []


def _fallback_grid_cells(dialog_rect: dict) -> list:
    """投影失败的兜底：弹窗下半部分硬切 2×2。"""
    ox, oy = int(dialog_rect["x"]), int(dialog_rect["y"])
    ow, oh = int(dialog_rect["w"]), int(dialog_rect["h"])
    y1 = oy + int(oh * CONFIG["options_y_lo"])
    y2 = oy + int(oh * CONFIG["options_y_hi"])
    zh = y2 - y1
    zw = ow
    rh = zh // 2
    cw_ = zw // 2
    cells = [
        {"x": ox,         "y": y1,      "w": cw_,       "h": rh},  # A
        {"x": ox + cw_,   "y": y1,      "w": zw - cw_,  "h": rh},  # B
        {"x": ox,         "y": y1 + rh, "w": cw_,       "h": zh - rh},  # C
        {"x": ox + cw_,   "y": y1 + rh, "w": zw - cw_,  "h": zh - rh},  # D
    ]
    logger.info(f"[fallback] 2×2 网格: {cells}")
    return cells


def _ocr_extract_options_in_dialog(im: Image.Image, dialog_rect: dict,
                                    answer_cells: list = None,
                                    debug: bool = False):
    """在弹窗内调 OCR 识别选项文字。

    - 若传入 answer_cells，则按"block 中心落在哪个格 -> 归到哪个字母"分配
    - 否则回退到"按 y 分行每行取前 2"

    Returns:
        debug=False: (picked, None)
        debug=True:  (picked, dbg)
        picked: [(text, {"x","y","w","h"}), ...]
    """
    dbg = {"blocks": [], "assign_by_cell": False}
    dx, dy = dialog_rect["x"], dialog_rect["y"]
    dw, dh = dialog_rect["w"], dialog_rect["h"]
    # 只裁弹窗下半部（选项区）送 OCR，避免整屏识别几十个无关文字块（速度+准确率双赢）
    zone_y_lo = dy + int(dh * CONFIG["options_y_lo"])
    zone_y_hi = dy + int(dh * CONFIG["options_y_hi"])
    zone_x_lo = dx
    zone_x_hi = dx + dw
    pad_y = max(6, int(dh * 0.02))  # 上下略放宽，避免按钮边缘文字被切
    crop_x = max(0, zone_x_lo)
    crop_y = max(0, zone_y_lo - pad_y)
    crop_box = (crop_x, crop_y,
                min(im.size[0], zone_x_hi), min(im.size[1], zone_y_hi + pad_y))
    crop = im.crop(crop_box)
    try:
        import urllib.request
        buf = io.BytesIO()
        crop.save(buf, "PNG")
        boundary = "----wb"
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"img\"; filename=\"p.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n".encode()
            + buf.getvalue()
            + f"\r\n--{boundary}--\r\n".encode()
        )
        req = urllib.request.Request(
            _OCR_URL, data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.load(r)
    except Exception as e:
        logger.warning(f"OCR 调用 8001 失败: {e}")
        return ([], dbg) if debug else ([], None)

    blocks = res.get("blocks", []) or []
    # OCR 是在裁剪图上做的，坐标平移回全图绝对坐标，后续逻辑不变
    for b in blocks:
        b["x"] = b["x"] + crop_x
        b["y"] = b["y"] + crop_y

    cands = []  # (text, box)
    for b in blocks:
        t = (b.get("text") or "").strip()
        bx, by = b["x"], b["y"]
        bw, bh = int(b.get("w", 0)), int(b.get("h", 0))
        passed = True
        reason = ""
        if not t:
            passed, reason = False, "空文本"
        elif t in _OCR_NOISE or any(rx.match(t) for rx in _OCR_NOISE_RE):
            passed, reason = False, "噪声词"
        elif len(t) < 2 or len(t) > 8:
            passed, reason = False, f"长度{len(t)}"
        elif not (zone_x_lo <= bx <= zone_x_hi and zone_y_lo <= by <= zone_y_hi):
            passed, reason = False, "越界"
        dbg["blocks"].append({
            "text": t, "x": int(bx), "y": int(by), "w": bw, "h": bh,
            "kept": passed, "reason": reason,
        })
        if passed:
            cands.append((t, {"x": int(bx), "y": int(by), "w": bw, "h": bh}))

    # --- 按格分配（推荐）---
    if answer_cells and len(answer_cells) == 4:
        dbg["assign_by_cell"] = True
        slots = [None, None, None, None]  # A/B/C/D
        for t, box in cands:
            cx = box["x"] + box["w"] / 2.0
            cy = box["y"] + box["h"] / 2.0
            for idx, cell in enumerate(answer_cells):
                if (cell["x"] <= cx <= cell["x"] + cell["w"]
                        and cell["y"] <= cy <= cell["y"] + cell["h"]):
                    # 同一格出现多个 block 时，取面积最大的（通常是完整按钮文字）
                    if slots[idx] is None or box["w"] * box["h"] > slots[idx][1]["w"] * slots[idx][1]["h"]:
                        slots[idx] = (t, box)
                    break
        picked = [s for s in slots if s is not None]
        chosen = set(t for t, _ in picked)
        for blk in dbg["blocks"]:
            blk["chosen"] = blk["text"] in chosen
        return (picked, dbg) if debug else (picked, None)

    # --- 回退：按 y 分行，每行取前 2 ---
    cands_with_y = [(c[1]["y"], c[1]["x"], c[0], c[1]) for c in cands]
    cands_with_y.sort()
    if not cands_with_y:
        return ([], dbg) if debug else ([], None)
    # 行分组阈值：按文字高度自适应
    avg_h = int(np.median([c[3]["h"] for c in cands_with_y])) if cands_with_y else 20
    line_gap = max(int(avg_h * 1.2), int(dh * 0.03))
    rows, cur = [], [cands_with_y[0]]
    for c in cands_with_y[1:]:
        if c[0] - cur[-1][0] < line_gap:
            cur.append(c)
        else:
            rows.append(cur)
            cur = [c]
    rows.append(cur)

    picked = []
    for r in rows:
        r.sort(key=lambda x: x[1])
        for _, _, t, box in r[:2]:
            if t not in [p[0] for p in picked]:
                picked.append((t, box))
            if len(picked) == 4:
                break
        if len(picked) == 4:
            break
    picked = picked[:4]
    chosen = set(t for t, _ in picked)
    for blk in dbg["blocks"]:
        blk["chosen"] = blk["text"] in chosen
    return (picked, dbg) if debug else (picked, None)


def _resolve_best_letter_by_geometry(best_name: str, picked: list, answer_cells: list) -> tuple:
    """用几何格子 + OCR 文本框，把匹配到的选项名映射到正确字母。"""
    if not best_name or len(answer_cells) != 4:
        return -1, ""
    for text, bbox in picked:
        if text != best_name:
            continue
        cx = bbox["x"] + bbox["w"] / 2.0
        cy = bbox["y"] + bbox["h"] / 2.0
        for idx, cell in enumerate(answer_cells):
            if (cell["x"] <= cx <= cell["x"] + cell["w"] and
                    cell["y"] <= cy <= cell["y"] + cell["h"]):
                return idx, chr(ord("A") + idx)
    return -1, ""


def _resolve_option_icon(opt: str) -> Optional[Path]:
    """按选项名找参考图标：优先 175dt 缓存，其次本地题库 icons"""
    icon_path = _get_175dt_icon(opt)
    if icon_path is None:
        for b in _bank:
            if b.get("name") == opt:
                local_icon = ICON_DIR / Path(b["icon"]).name
                if local_icon.exists():
                    return local_icon
                break
    return icon_path


def _template_match_options(im: Image.Image, options: list, search_rel: dict):
    """参考图标多尺度滑窗搜索"""
    if not HAS_CV2:
        return None, None
    W, H = im.size
    sx1, sy1 = int(W * search_rel["x1"]), int(H * search_rel["y1"])
    sx2, sy2 = int(W * search_rel["x2"]), int(H * search_rel["y2"])
    scene = np.asarray(im.crop((sx1, sy1, sx2, sy2)).convert("RGB"))[:, :, ::-1].copy()

    items = []
    for opt in options:
        icon_path = _resolve_option_icon(opt)
        if icon_path is None:
            items.append({"name": opt, "ncc": -1.0, "scale": 0, "loc": None, "source": "missing"})
            continue
        try:
            ref = cv2.imdecode(np.fromfile(str(icon_path), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        except Exception:
            ref = None
        if ref is None:
            items.append({"name": opt, "ncc": -1.0, "scale": 0, "loc": None, "source": "badfile"})
            continue
        if ref.ndim == 2:
            ref = cv2.cvtColor(ref, cv2.COLOR_GRAY2BGR)
        elif ref.shape[2] == 4:
            ref = ref[:, :, :3]
        best = (-1.0, None, 0)
        for s in CONFIG["tm_scales"]:
            if s >= min(scene.shape[0], scene.shape[1]):
                continue
            t = cv2.resize(ref, (s, s), interpolation=cv2.INTER_AREA)
            try:
                res = cv2.matchTemplate(scene, t, cv2.TM_CCOEFF_NORMED)
            except cv2.error:
                continue
            res = np.nan_to_num(res, nan=-1, posinf=-1, neginf=-1)
            _, mx, _, loc = cv2.minMaxLoc(res)
            if mx > best[0]:
                best = (mx, loc, s)
        mx, loc, s = best
        items.append({
            "name": opt, "ncc": round(float(mx), 4), "scale": s, "loc": loc,
            "source": "175dt" if icon_path.parent.name == "175dt_icons" else "local",
        })

    items.sort(key=lambda x: x["ncc"], reverse=True)
    best = items[0] if items else None
    for it in items:
        if it.get("loc") and it.get("scale"):
            x, y, s = it["loc"][0], it["loc"][1], it["scale"]
            it["box"] = {"x": sx1 + x, "y": sy1 + y, "w": s, "h": s}
            it["pass"] = it["ncc"] >= CONFIG["tm_conf"]
        else:
            it["box"] = None
            it["pass"] = False
    icon_box = None
    if best and best.get("box"):
        b = best["box"]
        icon_box = {
            "x1": round(b["x"] / W, 4), "y1": round(b["y"] / H, 4),
            "x2": round((b["x"] + b["w"]) / W, 4), "y2": round((b["y"] + b["h"]) / H, 4),
        }
    search_box = {"x": sx1, "y": sy1, "w": sx2 - sx1, "h": sy2 - sy1}
    return {"method": "template", "items": items, "search_box": search_box}, icon_box


def _recognize_icon_in_box(im: Image.Image, box: dict, options: list):
    """用候选命中框裁出干净图标，与本地参考图标逐一做 1:1 比对。"""
    if not HAS_CV2 or not box:
        return None
    x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
    if w < 8 or h < 8:
        return None
    icon = np.asarray(im.crop((x, y, x + w, y + h)).convert("RGB"))[:, :, ::-1].copy()
    base = max(8, min(w, h))
    items = []
    for opt in options:
        icon_path = _resolve_option_icon(opt)
        if icon_path is None:
            items.append({"name": opt, "ncc": -1.0, "scale": 0, "source": "missing"})
            continue
        try:
            ref = cv2.imdecode(np.fromfile(str(icon_path), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        except Exception:
            ref = None
        if ref is None:
            items.append({"name": opt, "ncc": -1.0, "scale": 0, "source": "badfile"})
            continue
        if ref.ndim == 2:
            ref = cv2.cvtColor(ref, cv2.COLOR_GRAY2BGR)
        elif ref.shape[2] == 4:
            ref = ref[:, :, :3]
        best = (-1.0, base)
        for s in (base, base - 4, base + 4, base + 8):
            if s < 8:
                continue
            t = cv2.resize(ref, (s, s), interpolation=cv2.INTER_AREA)
            ii = cv2.resize(icon, (s, s), interpolation=cv2.INTER_AREA)
            try:
                res = cv2.matchTemplate(ii, t, cv2.TM_CCOEFF_NORMED)
            except cv2.error:
                continue
            v = float(np.nan_to_num(res, nan=-1)[0][0])
            if v > best[0]:
                best = (v, s)
        items.append({
            "name": opt, "ncc": round(best[0], 4), "scale": best[1],
            "source": "175dt" if icon_path.parent.name == "175dt_icons" else "local",
        })
    return items


@app.post("/api/dati/solve-image")
async def solve_image(img: UploadFile = File(...), fallback_options: str = Form(""),
                      panel: str = Form("")):
    """一体化端点：整张游戏截图 -> 自动识别正确选项字母 (A/B/C/D)

    流程（纯图像处理，不依赖 YOLO）：
    1) 颜色分割找答题弹窗
    2) 水墨投影找 2 行 2 列 -> 拼出 A/B/C/D 四格
    3) OCR 识别选项文字（仅用于匹配和展示，定位不依赖 OCR）
    4) 模板匹配找到正确图标 -> best_letter

    panel 参数已忽略（保留兼容性）
    """
    t0 = time.time()
    try:
        data = await img.read()
        im = Image.open(io.BytesIO(data)).convert("RGB")
        W, H = im.size

        # ===== Step 1: 找弹窗 =====
        # 优先用前端 YOLO 送的 panel（最准，避免整屏蓝背景被颜色分割误判为全图）；
        # 否则退化为颜色分割；最后兜底比例。
        dialog_rect = None
        if panel:
            try:
                xs = [int(float(x)) for x in panel.split(",")]
                if len(xs) == 4 and xs[2] > xs[0] and xs[3] > xs[1]:
                    dialog_rect = {"x": xs[0], "y": xs[1],
                                   "w": xs[2] - xs[0], "h": xs[3] - xs[1]}
                    logger.info(f"[dialog] 使用前端 panel: {dialog_rect}")
            except Exception as e:
                logger.warning(f"panel 解析失败: {e}")
        if dialog_rect is None:
            dialog_rect = _find_dialog_by_color(im)
            if dialog_rect is None:
                dialog_rect = _fallback_dialog(im)
                logger.info(f"[dialog] 颜色分割失败，使用兜底比例: {dialog_rect}")
            else:
                logger.info(f"[dialog] 颜色分割成功: {dialog_rect}")
        t_dialog = (time.time() - t0) * 1000

        # ===== Step 2: 找 4 个选项格（三路优先级：按钮投影 -> 按钮颜色分割 -> 水墨投影 -> 兜底网格）=====
        answer_cells = _answer_cells_by_button_projection(im, dialog_rect)
        if len(answer_cells) == 4:
            logger.info("[solve] 按钮投影成功")
        else:
            answer_cells = _answer_cells_by_button_color(im, dialog_rect)
            if len(answer_cells) == 4:
                logger.info("[solve] 按钮颜色分割成功")
            else:
                answer_cells = _answer_cells_projection(im, dialog_rect)
                if len(answer_cells) == 4:
                    logger.info("[solve] 文字水墨投影成功")
                else:
                    answer_cells = _fallback_grid_cells(dialog_rect)
                    logger.warning("[solve] 三种方法均失败，使用兜底网格")
        t_cells = (time.time() - t0) * 1000

        # ===== Step 3: OCR 选项文字（可跳过以提速）=====
        t_ocr0 = time.time()
        used_fallback = False
        if fallback_options:
            # 前端已给出 4 选项文字：直接跳过 OCR 网络调用（最大提速项）
            options = [o.strip() for o in fallback_options.split(",") if o.strip()][:4]
            used_fallback = True
            picked, ocr_dbg = [], None
            logger.info("[solve] 使用前端 fallback_options，跳过 OCR 网络调用")
        else:
            picked, ocr_dbg = _ocr_extract_options_in_dialog(
                im, dialog_rect, answer_cells=answer_cells, debug=True
            )
            options = [t for t, _ in picked]
            if len(options) < 2 and fallback_options:
                options = [o.strip() for o in fallback_options.split(",") if o.strip()][:4]
                used_fallback = True
                picked = []
        t_ocr = (time.time() - t_ocr0) * 1000

        if len(options) < 2:
            return {"success": False, "error": f"选项不足（OCR 识别 {len(options)} 个，fallback={used_fallback}），无法匹配",
                    "options_found": options, "answer_cells": answer_cells}

        # ===== Step 4: 模板匹配（4 候选相对判别，决定正确选项名）=====
        t_match0 = time.time()
        # 图标搜索区：弹窗上半部分（0~45%）
        px, py = dialog_rect["x"], dialog_rect["y"]
        pw, ph = dialog_rect["w"], dialog_rect["h"]
        search_rel = {
            "x1": max(0.0, px / W),
            "y1": max(0.0, py / H),
            "x2": min(1.0, (px + pw) / W),
            "y2": min(1.0, (py + ph * 0.45) / H),
        }
        tm_result, icon_box = _template_match_options(im, options, search_rel)
        # 直接用 pass1 结果：去掉冗余的 _recognize_icon_in_box 二次匹配（省 ~50-100ms，且 pass1 已足够准）
        items = (tm_result["items"] if tm_result else []) or []
        items_sorted = sorted(items, key=lambda x: -x["ncc"])
        t_match = (time.time() - t_match0) * 1000
        top_item = items_sorted[0] if items_sorted else None
        second = items_sorted[1] if len(items_sorted) > 1 else None
        margin_ok = (second is None) or (top_item["ncc"] - second["ncc"] >= CONFIG["tm_margin"])

        used_tm = False
        if top_item is not None and top_item["ncc"] >= CONFIG["tm_floor"] and margin_ok:
            used_tm = True
            scores = []
            for it in items_sorted[:4]:
                scores.append({
                    "name": it["name"], "ncc": it["ncc"],
                    "score": round(it["ncc"] / top_item["ncc"] if top_item["ncc"] > 0 else 0, 4),
                    "scale": it["scale"], "source": it["source"],
                })
            best = dict(scores[0])
            best["method"] = "template"
            best_index, best_letter = _resolve_best_letter_by_geometry(
                best["name"], picked, answer_cells
            )
            if best_index < 0 and best["name"] in options:
                best_index = options.index(best["name"])
                best_letter = chr(ord("A") + best_index)
            result = {"scores": scores, "best": best,
                      "best_index": best_index, "best_letter": best_letter}
        else:
            ncc_info = ""
            if top_item and second:
                ncc_info = f" (top={top_item['ncc']:.3f} second={second['ncc']:.3f} gap={top_item['ncc']-second['ncc']:.3f})"
            logger.info(f"模板未命中{ncc_info}")
            best = {"name": "", "score": 0.0, "ncc": 0.0, "method": "template-no-match"}
            result = {"scores": [], "best": best, "best_index": -1, "best_letter": ""}

        answer_box = None
        if answer_cells and 0 <= result["best_index"] < len(answer_cells):
            answer_box = answer_cells[result["best_index"]]

        t_ms = (time.time() - t0) * 1000
        logger.info(
            f"solve-image: dialog={dialog_rect} ocr={options} fallback={used_fallback} "
            f"method={'template' if used_tm else 'template-no-match'} -> "
            f"{result['best'].get('name') or '<未识别>'} "
            f"letter={result['best_letter'] or '-'} ({t_ms:.0f}ms)"
        )
        return {
            "success": True,
            "dialog_rect": dialog_rect,
            "options": options,
            "used_fallback": used_fallback,
            "method": "template" if used_tm else "template-no-match",
            "icon_box": icon_box,
            "search_box": (tm_result or {}).get("search_box"),
            "icon_boxes": [
                {"name": it["name"], "ncc": it["ncc"], "scale": it.get("scale"),
                 "pass": it.get("pass"), "box": it.get("box")}
                for it in ((tm_result or {}).get("items") or [])
            ],
            "ocr_debug": ocr_dbg,
            "answer_cells": answer_cells,
            "answer_box": answer_box,
            "scores": result["scores"],
            "best": result["best"],
            "best_index": result["best_index"],
            "best_letter": result["best_letter"],
            "time_ms": round(t_ms, 1),
            "timings": {
                "dialog_ms": round(t_dialog, 1),
                "cells_ms": round(t_cells - t_dialog, 1),
                "ocr_ms": round(t_ocr, 1),
                "match_ms": round(t_match, 1),
            },
        }
    except Exception as e:
        logger.error(f"solve-image 失败: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/dati/debug-projection")
async def debug_projection(img: UploadFile = File(...)):
    """调试端点：返回水墨投影/按钮分割可视化，用于定位问题。

    Returns:
        {
            "dialog": {...},
            "cells_button": [...],
            "cells_proj": [...],
            "cells_fallback": [...],
            "projection": {
                "row_segments": [...],
                "col_segments_top": [...],
                "col_segments_bot": [...],
                "h_proj": [...],
                "v_proj_top": [...],
                "v_proj_bot": [...]
            },
            "ink_stats": {...}
        }
    """
    if not HAS_CV2:
        return {"error": "需要 opencv-python"}
    try:
        data = await img.read()
        im = Image.open(io.BytesIO(data)).convert("RGB")

        # 弹窗
        dialog_rect = _find_dialog_by_color(im)
        if dialog_rect is None:
            dialog_rect = _fallback_dialog(im)

        # 三种方法的 cells
        cells_button = _answer_cells_by_button_color(im, dialog_rect)
        cells_proj = _answer_cells_projection(im, dialog_rect)
        cells_fallback = _fallback_grid_cells(dialog_rect)

        # 投影详情
        ox, oy = int(dialog_rect["x"]), int(dialog_rect["y"])
        ow, oh = int(dialog_rect["w"]), int(dialog_rect["h"])
        y_start = oy + int(oh * CONFIG["options_y_lo"])
        y_end = oy + int(oh * CONFIG["options_y_hi"])
        crop = im.crop((ox, y_start, ox + ow, y_end)).convert("RGB")
        cw, ch = crop.size
        crop_bgr = np.asarray(crop)[:, :, ::-1].copy()
        ink = _ink_mask_from_crop(crop_bgr)

        h_proj = ink.sum(axis=1).tolist()
        h_sm = _smooth(h_proj, max(2, int(ch * CONFIG["row_smooth_ratio"])))
        h_thr = max(cw * CONFIG["row_thr_width_ratio"], max(h_sm) * CONFIG["row_thr_peak_ratio"])
        h_segments = _find_segments(
            h_sm, h_thr,
            max(3, int(ch * CONFIG["row_min_height_ratio"])),
            max(5, int(ch * CONFIG["row_merge_gap_ratio"])),
        )
        h_segments = [s for s in h_segments if s[0] < ch * CONFIG["row_bottom_limit"]]

        proj_info = {
            "row_segments": h_segments,
            "h_proj": h_proj[:100] if len(h_proj) > 100 else h_proj,  # 截断避免过长
            "h_thr": float(h_thr),
        }

        ink_stats = {
            "total": float(ink.sum()),
            "ratio": float(ink.mean()),
            "shape": list(ink.shape),
        }

        return {
            "dialog": dialog_rect,
            "cells_button": cells_button,
            "cells_proj": cells_proj,
            "cells_fallback": cells_fallback,
            "projection": proj_info,
            "ink_stats": ink_stats,
        }
    except Exception as e:
        logger.error(f"debug-projection 失败: {e}")
        return {"error": str(e)}


# 模块导入时即构建参考模板
build_ref_templates()


if __name__ == "__main__":
    load_bank()
    build_ref_templates()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8008, log_config=_build_uvicorn_log_config())