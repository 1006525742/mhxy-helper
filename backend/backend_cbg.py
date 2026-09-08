#!/usr/bin/env python3
"""梦幻西游助手 - 藏宝阁模块后端 (端口 8009)

独立进程，端口 8009（注意：8002 已被宝图模块占用）。

== 职责 ==
装备/角色订阅、价格快照、历史成交的**纯存储服务**。

== 安全模型（方案 B：用户各自授权）==
1. 后端**绝不存储**任何用户的藏宝阁 cookie / 密码。
   cookie 由前端在用户自己的浏览器里持有（localStorage），只在用户本地用于访问藏宝阁。
2. 所有业务数据按 `user_token` 隔离（user_token 由前端在 localStorage 生成随机串）。
   后端被攻破也拿不到任何用户的藏宝阁凭证。
3. 藏宝阁抓取逻辑由前端在**用户浏览器**内完成（自带 cookie + 官方签名），
   解析后的结构化数据 POST 给本服务落库。后端本身不主动发起任何藏宝阁请求。
4. 估值/比价仅为辅助参考，前端须标注"仅供参考"。

== 数据表 ==
- watch_list      订阅清单（具体某件装备，ordersn 唯一）
- price_snapshot  每次查询写一条价格快照（形成历史曲线）
- deal_history    成交记录
"""

import json
import hashlib
import logging
import sqlite3
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
# 缩略图本地目录：采集时把网易 CDN 图片下载到本机，前端由后端托管，绕开防盗链
THUMBS_DIR = Path(__file__).resolve().parent / "thumbs"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(str(LOG_DIR / "cbg.log"), encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("cbg")

DB_PATH = Path(__file__).resolve().parent / "data" / "cbg.db"


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """CREATE TABLE IF NOT EXISTS watch_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT NOT NULL,
            ordersn TEXT NOT NULL,
            server_id TEXT,
            server_name TEXT,
            equip_name TEXT,
            target_price REAL,
            note TEXT,
            created_at REAL,
            UNIQUE(user_token, ordersn))"""
    )
    cur.execute(
        """CREATE TABLE IF NOT EXISTS price_snapshot (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT NOT NULL,
            ordersn TEXT NOT NULL,
            current_price REAL,
            same_type_lowest REAL,
            status TEXT,
            ts REAL)"""
    )
    cur.execute(
        """CREATE TABLE IF NOT EXISTS deal_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT NOT NULL,
            ordersn TEXT NOT NULL,
            deal_ts REAL,
            deal_price REAL)"""
    )
    cur.execute(
        """CREATE TABLE IF NOT EXISTS captured_item (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT NOT NULL,
            eid TEXT NOT NULL,
            server_id TEXT,
            server_name TEXT,
            name TEXT,
            price REAL,
            first_price REAL,
            attrs_json TEXT,
            thumb_url TEXT,
            detail_url TEXT,
            capture_label TEXT,
            captured_at REAL,
            item_type TEXT DEFAULT 'equip',
            UNIQUE(user_token, eid))"""
    )
    cur.execute(
        """CREATE TABLE IF NOT EXISTS subscription (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT NOT NULL,
            name TEXT,
            server_id TEXT,
            server_name TEXT,
            search_url TEXT,
            conditions_json TEXT,
            label TEXT,
            enabled INTEGER DEFAULT 1,
            interval_minutes INTEGER DEFAULT 60,
            last_run REAL,
            next_run REAL,
            created_at REAL)"""
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_snap ON price_snapshot(user_token, ordersn)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_capture ON captured_item(user_token, eid)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_deal ON deal_history(user_token, ordersn)"
    )
    # 缩略图本地目录 + captured_item 迁移（新增 local_thumb 列）
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(captured_item)")]
    if "local_thumb" not in cols:
        conn.execute("ALTER TABLE captured_item ADD COLUMN local_thumb TEXT")
    if "status" not in cols:
        conn.execute("ALTER TABLE captured_item ADD COLUMN status TEXT DEFAULT '在售'")
    if "subscription_id" not in cols:
        conn.execute("ALTER TABLE captured_item ADD COLUMN subscription_id TEXT")
    if "item_type" not in cols:
        conn.execute("ALTER TABLE captured_item ADD COLUMN item_type TEXT DEFAULT 'equip'")
    if "est_price" not in cols:
        conn.execute("ALTER TABLE captured_item ADD COLUMN est_price REAL")
    # subscription 表迁移：last_result 存最近一次采集结果（scanned/captured/error），供前端显示与诊断
    scols = [r[1] for r in conn.execute("PRAGMA table_info(subscription)")]
    if "last_result" not in scols:
        conn.execute("ALTER TABLE subscription ADD COLUMN last_result TEXT")
    conn.commit()
    conn.close()
    logger.info("cbg db initialized at %s", DB_PATH)


init_db()

# ---------- 估价数据 ----------
PRICING_FILE = Path(__file__).resolve().parent / "pricing_data.json"
_pricing_data = None

def load_pricing():
    global _pricing_data
    if _pricing_data is None:
        try:
            with open(PRICING_FILE, "r", encoding="utf-8") as f:
                _pricing_data = json.load(f)
            logger.info("pricing data loaded from %s", PRICING_FILE)
        except Exception as e:
            logger.warning("failed to load pricing data: %s", e)
            _pricing_data = {}
    return _pricing_data


def price_cultivation(level: int, table: str) -> float:
    """修炼估价：level 等级，table 为表名（如 cultivation_attack_magic_hunt）"""
    data = load_pricing()
    if not data:
        return 0.0
    tbl = data.get("tables", {}).get(table, {})
    values = tbl.get("values", [])
    if level < 0 or level >= len(values):
        level = min(level, len(values) - 1)
    return float(values[level]) if values else 0.0


def price_school_skill(level: int) -> float:
    """师门技能估价"""
    return price_cultivation(level, "school_skill")


def price_qiangzhuang_shensu(level: int) -> float:
    """强壮/神速估价"""
    return price_cultivation(level, "qiangzhuang_shensu")


def calculate_role_price(attrs: dict) -> dict:
    """根据角色属性计算估价"""
    data = load_pricing()
    if not data:
        return {"error": "估价数据未加载"}

    result = {"items": [], "total_mhb": 0.0}

    # 修炼（攻修/法修/猎术用同一表，防修/抗法用另一表）
    for key, table, field in [
        ("攻修", "cultivation_attack_magic_hunt", "iExptSki1"),
        ("法修", "cultivation_attack_magic_hunt", "iExptSki3"),
        ("猎术", "cultivation_attack_magic_hunt", "iExptSki5"),
        ("防修", "cultivation_defense_resist", "iExptSki2"),
        ("抗法", "cultivation_defense_resist", "iExptSki4"),
    ]:
        val = attrs.get(key)
        if val:
            # 格式可能是 "23/24" 或 "20"
            level = int(str(val).split("/")[0])
            mhb = price_cultivation(level, table)
            if mhb > 0:
                result["items"].append({"name": key, "level": level, "value_mhb": mhb})
                result["total_mhb"] += mhb

    # 控制力
    for key, field in [("攻击控制", "iBeastSki1"), ("防御控制", "iBeastSki2"),
                       ("法术控制", "iBeastSki3"), ("法抗控制", "iBeastSki4")]:
        level = attrs.get(key)
        if level is not None:
            mhb = price_cultivation(level, "control")
            if mhb > 0:
                result["items"].append({"name": key, "level": level, "value_mhb": mhb})
                result["total_mhb"] += mhb

    # 师门技能 1-7
    for i in range(1, 8):
        key = f"师门技能{i}"
        level = attrs.get(key)
        if level is not None:
            mhb = price_school_skill(level)
            if mhb > 0:
                result["items"].append({"name": key, "level": level, "value_mhb": mhb})
                result["total_mhb"] += mhb

    # 强壮/神速
    for key in ["强壮", "神速"]:
        level = attrs.get(key)
        if level is not None:
            mhb = price_qiangzhuang_shensu(level)
            if mhb > 0:
                result["items"].append({"name": key, "level": level, "value_mhb": mhb})
                result["total_mhb"] += mhb

    # 转换为 RMB
    ratio = data.get("ratio", {}).get("dream_to_rmb", 3000)
    rmb_base = data.get("ratio", {}).get("rmb_base", 205)
    discount = data.get("discount", 0.6)

    ratio_val = rmb_base / ratio if ratio > 0 else 1.0
    result["ratio"] = ratio_val
    result["total_rmb"] = result["total_mhb"] * ratio_val
    result["discount"] = discount
    result["final_rmb"] = result["total_rmb"] * discount

    return result


app = FastAPI(title="MHXY CBG Module", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Pydantic 模型 ----------
class WatchIn(BaseModel):
    user_token: str
    ordersn: str
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    equip_name: Optional[str] = None
    target_price: Optional[float] = None
    note: Optional[str] = None


class SnapshotIn(BaseModel):
    user_token: str
    ordersn: str
    current_price: Optional[float] = None
    same_type_lowest: Optional[float] = None
    status: Optional[str] = None


class DealItem(BaseModel):
    deal_ts: float
    deal_price: float


class DealsIn(BaseModel):
    user_token: str
    ordersn: str
    deals: List[DealItem]


class ImportItem(BaseModel):
    ordersn: str
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    equip_name: Optional[str] = None


class ImportIn(BaseModel):
    user_token: str
    items: List[ImportItem]


class CaptureItem(BaseModel):
    eid: str
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    name: Optional[str] = None
    price: Optional[float] = None
    first_price: Optional[float] = None
    attrs: Optional[dict] = None
    thumb_url: Optional[str] = None
    thumb_candidates: Optional[str] = None  # JSON 字符串：头像候选 URL 列表，后端逐一试探取真实图
    detail_url: Optional[str] = None
    status: Optional[str] = None
    item_type: Optional[str] = None  # yupo / role / equip / pet ...


class CaptureIn(BaseModel):
    user_token: Optional[str] = None
    label: Optional[str] = None
    subscription_id: Optional[str] = None
    item_type: Optional[str] = None  # yupo / role / equip / pet ...
    items: List[CaptureItem]


class SubscriptionIn(BaseModel):
    user_token: str
    name: str
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    search_url: str
    conditions_json: Optional[str] = None
    label: Optional[str] = None
    interval_minutes: int = 60
    enabled: bool = True


class SubscriptionUpdate(BaseModel):
    name: Optional[str] = None
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    search_url: Optional[str] = None
    conditions_json: Optional[str] = None
    label: Optional[str] = None
    interval_minutes: Optional[int] = None
    enabled: Optional[bool] = None


class RanResult(BaseModel):
    scanned: Optional[int] = None
    captured: Optional[int] = None
    error: Optional[str] = None


# ---------- 工具 ----------
# 单用户模式：本机单人使用，扩展/前端各自生成 token 导致数据互相看不到，
# 统一归到固定用户，所有采集数据共享。
SINGLE_USER = "u_local_single"

def _user(req: Request, fallback: Optional[str] = None) -> str:
    return SINGLE_USER


DEFAULT_ROLE_THUMB = "https://cbg-xyq.res.netease.com/images/role_icon/small/1.gif"

# 门派名 -> iSchool（与 cbg-extension/content.js 的 SCHOOL_MAP 保持一致）
SCHOOL_NAME_TO_ID = {
    "大唐官府": 1, "化生寺": 2, "女儿村": 3, "方寸山": 4, "天宫": 5, "普陀山": 6,
    "龙宫": 7, "五庄观": 8, "狮驼岭": 9, "魔王寨": 10, "阴曹地府": 11, "盘丝洞": 12,
    "神木林": 13, "凌波城": 14, "无底洞": 15, "女魃墓": 16, "天机城": 17,
    "花果山": 18, "东海渊": 19, "九黎城": 20, "弥勒山": 21,
}
SECT_ICON_BASE = "https://cbg-xyq.res.netease.com/images/role_icon/small/"


def sect_icon_url(attrs: Optional[dict]) -> Optional[str]:
    """按门派推算门派图标 URL，用作角色造型图下载失败时的回退。

    规则（2026-08-29 实测）：icon_id = iSchool*2 - 1（男）/ iSchool*2（女）。
    接口无性别字段，统一取男。
    """
    try:
        sid = SCHOOL_NAME_TO_ID.get((attrs or {}).get("门派"))
        if not sid:
            return None
        return f"{SECT_ICON_BASE}{sid * 2 - 1}.gif"
    except Exception:
        return None


def download_thumb(
    eid: str, thumb_url: Optional[str], fallback_url: Optional[str] = None,
    candidates: Optional[list] = None,
) -> Optional[str]:
    """把网易 CDN 缩略图下载到本机 thumbs/，返回文件名；失败返回 None。

    候选链（字段无关，逐一试探取第一张真实图）：thumb_url → candidates(扩展算好的
    多个头像 URL) → fallback_url(门派图标) → DEFAULT_ROLE_THUMB。404/异常自动跳到下一个，
    因此内容脚本即使把字段优先级排错（如 d.icon 404 但 equip_face_img 可用），也能自动命中真图。
    """
    if not thumb_url:
        return None

    # 容错：扩展可能传来不带域名的相对片段（如 "328_3746.gif"、"blank_role.gif"）。
    # 这类值 urlopen 会直接抛异常（缺 scheme），随后全部落到 DEFAULT_ROLE_THUMB 兜底，
    # 而兜底用的是固定 URL → 文件名哈希固定 → 整批条目共用同一个本地文件，
    # 前端就表现为"所有角色头像都是同一张"。这里统一按人脸图 CDN 前缀补全。
    def _abs(u: str) -> str:
        s = (u or "").strip()
        if s.startswith("http://") or s.startswith("https://"):
            return s
        return "https://cbg-xyq.res.netease.com/images/small/" + s.lstrip("/")

    def _fetch(u: str) -> Optional[bytes]:
        req = urllib.request.Request(
            u,
            headers={
                "Referer": "https://xyq.cbg.163.com/",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read()

    def _save(data: bytes, u: str) -> str:
        if not data:
            raise ValueError("empty body")
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            ext = "png"
        elif data[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif data[:6] in (b"GIF87a", b"GIF89a"):
            ext = "gif"
        else:
            ext = "img"
        # 按缩略图 URL 哈希命名：相同 URL（如同一种玉魄）只存一份，避免重复
        h = hashlib.sha1(u.encode("utf-8")).hexdigest()[:16]
        fname = f"t_{h}.{ext}"
        (THUMBS_DIR / fname).write_bytes(data)
        return fname

    # 已下载过的图直接复用、不再重复请求网易 CDN：相同 URL 必然映射到相同文件名，
    # 因此只要本地存在同名文件就说明已抓过（角色头像重复度很高，如 blank_role 占三成、
    # 门派造型图只有十几种，复用可省掉绝大部分请求，也降低被风控的概率）。
    # 文件名含由内容决定的扩展名，故按常见扩展名依次探测。
    def _reuse(u: str) -> Optional[str]:
        h = hashlib.sha1(u.encode("utf-8")).hexdigest()[:16]
        for ext in ("gif", "png", "jpg", "img"):
            f = THUMBS_DIR / f"t_{h}.{ext}"
            try:
                if f.exists() and f.stat().st_size > 0:
                    return f.name
            except OSError:
                pass
        return None

    # 多级回退链：主 url → 同 ID 的 role_icon/small（小图兜底）→ 门派图标 → 默认图。
    # 设计原因：内容脚本把 d.icon 拼成 bigface/<id>.gif（角色大头像 160×200），
    # 但同 ID 在 role_icon/small/ 下的 50×50 小图几乎总在；主图 404 时自动试小图，
    # 比直接落到默认图更贴近真实造型。链中任一环节命中 _reuse() 都会复用本地文件。
    import re as _re
    def _alt_for(u: str) -> Optional[str]:
        # bigface/<id>.gif → 试同 ID 的 role_icon/small/<id>.gif（小图）
        m = _re.search(r"/images/bigface/(\d+)\.gif$", u or "")
        if m:
            return f"https://cbg-xyq.res.netease.com/images/role_icon/small/{m.group(1)}.gif"
        return None
    def _try(u: str) -> Optional[str]:
        if not u: return None
        try:
            abs_u = _abs(u)
            reused = _reuse(abs_u)
            if reused: return reused
            return _save(_fetch(abs_u), abs_u)
        except Exception as ex:
            logger.warning("thumb try failed for %s: %s (url=%s)", eid, ex, u)
            return None
    abs_main = _abs(thumb_url)
    # 候选链：主图 → 扩展算好的候选列表 → 门派图标 → 默认图。逐一试探，取第一张真实图。
    chain = []
    if abs_main:
        chain.append(abs_main)
    if candidates:
        if isinstance(candidates, str):
            try:
                candidates = json.loads(candidates)
            except Exception:
                candidates = []
        if isinstance(candidates, list):
            for c in candidates:
                if c:
                    chain.append(_abs(c))
    if fallback_url:
        chain.append(_abs(fallback_url))
    chain.append(DEFAULT_ROLE_THUMB)
    # 去重（保序），避免重复请求同一 URL
    _seen = set()
    chain = [u for u in chain if u and not (u in _seen or _seen.add(u))]
    for u in chain:
        f = _try(u)
        if f:
            return f
    return None


# ---------- 路由 ----------
@app.get("/api/cbg/health")
def health():
    return {"status": "ok", "module": "cbg"}


@app.get("/api/cbg/watch")
def list_watch(req: Request, user_token: str = ""):
    ut = _user(req, user_token)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM watch_list WHERE user_token=? ORDER BY created_at DESC", (ut,)
    ).fetchall()
    conn.close()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/cbg/watch")
def add_watch(item: WatchIn):
    conn = get_db()
    conn.execute(
        """INSERT INTO watch_list
           (user_token, ordersn, server_id, server_name, equip_name, target_price, note, created_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(user_token, ordersn) DO UPDATE SET
             server_id=excluded.server_id,
             server_name=excluded.server_name,
             equip_name=excluded.equip_name,
             target_price=excluded.target_price,
             note=excluded.note""",
        (
            item.user_token,
            item.ordersn,
            item.server_id,
            item.server_name,
            item.equip_name,
            item.target_price,
            item.note,
            time.time(),
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/cbg/watch")
def del_watch(req: Request, user_token: str = "", ordersn: str = ""):
    ut = _user(req, user_token)
    if not ordersn:
        raise HTTPException(status_code=400, detail="缺少 ordersn")
    conn = get_db()
    conn.execute(
        "DELETE FROM watch_list WHERE user_token=? AND ordersn=?", (ut, ordersn)
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/cbg/snapshot")
def add_snapshot(item: SnapshotIn):
    conn = get_db()
    conn.execute(
        """INSERT INTO price_snapshot
           (user_token, ordersn, current_price, same_type_lowest, status, ts)
           VALUES (?,?,?,?,?,?)""",
        (
            item.user_token,
            item.ordersn,
            item.current_price,
            item.same_type_lowest,
            item.status,
            time.time(),
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/cbg/history")
def history(req: Request, user_token: str = "", ordersn: str = ""):
    ut = _user(req, user_token)
    if not ordersn:
        raise HTTPException(status_code=400, detail="缺少 ordersn")
    conn = get_db()
    rows = conn.execute(
        """SELECT current_price, same_type_lowest, status, ts
           FROM price_snapshot WHERE user_token=? AND ordersn=? ORDER BY ts ASC""",
        (ut, ordersn),
    ).fetchall()
    conn.close()
    return {"ordersn": ordersn, "points": [dict(r) for r in rows]}


@app.post("/api/cbg/deals")
def add_deals(item: DealsIn):
    conn = get_db()
    conn.executemany(
        "INSERT INTO deal_history (user_token, ordersn, deal_ts, deal_price) VALUES (?,?,?,?)",
        [(item.user_token, item.ordersn, d.deal_ts, d.deal_price) for d in item.deals],
    )
    conn.commit()
    conn.close()
    return {"ok": True, "count": len(item.deals)}


@app.get("/api/cbg/deals")
def get_deals(req: Request, user_token: str = "", ordersn: str = ""):
    ut = _user(req, user_token)
    if not ordersn:
        raise HTTPException(status_code=400, detail="缺少 ordersn")
    conn = get_db()
    rows = conn.execute(
        """SELECT deal_ts, deal_price FROM deal_history
           WHERE user_token=? AND ordersn=? ORDER BY deal_ts DESC""",
        (ut, ordersn),
    ).fetchall()
    conn.close()
    return {"ordersn": ordersn, "deals": [dict(r) for r in rows]}


@app.post("/api/cbg/import")
def import_items(item: ImportIn):
    conn = get_db()
    now = time.time()
    for it in item.items:
        conn.execute(
            """INSERT INTO watch_list
               (user_token, ordersn, server_id, server_name, equip_name, created_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(user_token, ordersn) DO NOTHING""",
            (item.user_token, it.ordersn, it.server_id, it.server_name, it.equip_name, now),
        )
    conn.commit()
    conn.close()
    return {"ok": True, "imported": len(item.items)}


# ---------- 采集物品库（成批快照） ----------
@app.post("/api/cbg/capture")
def capture_items(body: CaptureIn):
    if not body.items:
        return {"ok": True, "captured": 0}
    conn = get_db()
    ut = body.user_token or "local"
    # 订阅采集：归属以订阅创建时的 user_token 为准（网页 token），插件 token 与网页 token
    # 不同，故通过 subscription_id 反查订阅真实 user_token，保证网页端按自己 token 能读到结果。
    if body.subscription_id:
        srow = conn.execute(
            "SELECT user_token FROM subscription WHERE id=?", (body.subscription_id,)
        ).fetchone()
        if srow and srow["user_token"]:
            ut = srow["user_token"]
    now = time.time()
    inserted = 0
    updated = 0
    for it in body.items:
        if not it.eid:
            continue
        row = conn.execute(
            # 注意：下面要读 row["thumb_url"] 判断头像是否变更，SELECT 必须包含该列，
            # 否则 sqlite3.Row 会抛 IndexError: No item with that key → 整个 capture 接口 500。
            "SELECT first_price, local_thumb, thumb_url FROM captured_item WHERE user_token=? AND eid=?",
            (ut, it.eid),
        ).fetchone()
        attrs_json = None
        if it.attrs is not None:
            try:
                attrs_json = json.dumps(it.attrs, ensure_ascii=False)
            except Exception:
                attrs_json = None
        label = body.label or "未分类"
        # 角色自动估价：attrs 一并入库时直接算好存 est_price，前端免点按钮
        item_type_val = it.item_type or body.item_type or 'equip'
        est_price = None
        if item_type_val == 'role' and attrs_json:
            try:
                pr = calculate_role_price(json.loads(attrs_json))
                est_price = pr.get("final_rmb") if pr.get("items") else -1
            except Exception:
                est_price = None
        # 缩略图：本地缺失则下载；若本次 thumb_url 与已存不同（如头像字段修正），重新下载刷新
        existing_thumb = (row["local_thumb"] if row else None) or None
        existing_thumb_url = (row["thumb_url"] if row else None) or None
        # 造型图（d.icon）在网易 CDN 上约半数取不到，退到门派图标，再不行才是默认图
        fb_url = sect_icon_url(it.attrs if isinstance(it.attrs, dict) else None)
        # 候选头像 URL 列表（扩展算好的，按优先级逐一试探取真实图）
        cands = None
        if getattr(it, "thumb_candidates", None):
            try:
                cands = json.loads(it.thumb_candidates)
            except Exception:
                cands = None
        if it.thumb_url and it.thumb_url != existing_thumb_url:
            local_thumb = download_thumb(it.eid, it.thumb_url, fb_url, candidates=cands) or existing_thumb
        else:
            local_thumb = existing_thumb or (
                download_thumb(it.eid, it.thumb_url, fb_url, candidates=cands) if it.thumb_url else None
            )
        if row is None:
            first_price = it.first_price if it.first_price is not None else it.price
            conn.execute(
                """INSERT INTO captured_item
                   (user_token, eid, server_id, server_name, name, price, first_price,
                    attrs_json, thumb_url, detail_url, capture_label, captured_at, local_thumb, status, subscription_id, item_type, est_price)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    ut, it.eid, it.server_id, it.server_name, it.name, it.price,
                    first_price, attrs_json, it.thumb_url, it.detail_url, label, now,
                    local_thumb, it.status or '在售', body.subscription_id or None, item_type_val,
                    est_price,
                ),
            )
            inserted += 1
        else:
            conn.execute(
                """UPDATE captured_item SET
                     server_id=?, server_name=?, name=?, price=?,
                     attrs_json=?, thumb_url=?, detail_url=?, capture_label=?, captured_at=?,
                     local_thumb=COALESCE(local_thumb, ?),
                     status=COALESCE(?, status),
                     subscription_id=COALESCE(?, subscription_id),
                     est_price=CASE WHEN ? IS NOT NULL THEN ? ELSE est_price END
                   WHERE user_token=? AND eid=?""",
                (
                    it.server_id, it.server_name, it.name, it.price,
                    attrs_json, it.thumb_url, it.detail_url, label, now,
                    local_thumb, it.status, body.subscription_id or None,
                    est_price, est_price, ut, it.eid,
                ),
            )
            updated += 1
    conn.commit()
    conn.close()
    return {"ok": True, "captured": inserted + updated, "inserted": inserted, "updated": updated, "scanned": len(body.items)}


@app.get("/api/cbg/thumb/{filename}")
def serve_thumb(filename: str):
    """托管本地缩略图（绕开网易 CDN 防盗链）。"""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="bad filename")
    p = THUMBS_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(p))


@app.get("/api/cbg/items")
def list_items(
    req: Request,
    user_token: str = "",
    label: str = "",
    server: str = "",
    kw: str = "",
    min_price: float = 0,
    max_price: float = 0,
    item_type: str = "",
    sort: str = "time_desc",
):
    conn = get_db()
    sql = "SELECT * FROM captured_item"
    args: List[Any] = []
    clauses = []
    if label and label != "all":
        clauses.append("capture_label=?")
        args.append(label)
    if server:
        clauses.append("server_name LIKE ?")
        args.append(f"%{server}%")
    if kw:
        clauses.append("(name LIKE ? OR attrs_json LIKE ?)")
        args.append(f"%{kw}%")
        args.append(f"%{kw}%")
    if min_price and min_price > 0:
        clauses.append("price >= ?")
        args.append(min_price)
    if max_price and max_price > 0:
        clauses.append("price <= ?")
        args.append(max_price)
    if item_type:
        # 支持 "role" 精确匹配，也支持 "neq:role" 排除某类型
        if item_type.startswith("neq:"):
            clauses.append("(item_type IS NULL OR item_type != ?)")
            args.append(item_type[4:])
        else:
            clauses.append("item_type=?")
            args.append(item_type)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    if sort == "price_asc":
        sql += " ORDER BY price ASC"
    elif sort == "price_desc":
        sql += " ORDER BY price DESC"
    else:
        sql += " ORDER BY captured_at DESC"
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    items = []
    for r in rows:
        d = dict(r)
        dropped = False
        if d.get("first_price") and d.get("price") is not None and d["price"] < d["first_price"]:
            dropped = True
        d["dropped"] = dropped
        items.append(d)
    return {"items": items}


@app.get("/api/cbg/labels")
def list_labels(req: Request, user_token: str = "", exclude_type: str = ""):
    where = ""
    args: List[Any] = []
    if exclude_type:
        # 排除某类型（如玉魄页面 exclude_type=role，标签计数不含角色）
        where = " WHERE (item_type IS NULL OR item_type != ?)"
        args.append(exclude_type)
    conn = get_db()
    rows = conn.execute(
        f"""SELECT capture_label, COUNT(*) AS cnt, MIN(price) AS min_price,
                  MAX(price) AS max_price, MAX(captured_at) AS last_at
           FROM captured_item{where} GROUP BY capture_label
           ORDER BY last_at DESC""",
        args,
    ).fetchall()
    conn.close()
    return {"labels": [dict(r) for r in rows]}


class StatusUpdate(BaseModel):
    status: str


@app.get("/api/cbg/capture/ids")
def list_capture_ids():
    """返回库内所有物品的 eid + server_id，供插件刷新在售状态时逐件查询。"""
    conn = get_db()
    rows = conn.execute(
        "SELECT eid, server_id, server_name, name, status FROM captured_item"
    ).fetchall()
    conn.close()
    return {"items": [dict(r) for r in rows]}


@app.put("/api/cbg/item/{eid}/status")
def update_item_status(eid: str, body: StatusUpdate):
    """插件在已登录浏览器内逐件查询后，回写在售状态（在售/已售/已下架）。"""
    conn = get_db()
    cur = conn.execute(
        "UPDATE captured_item SET status=? WHERE eid=?", (body.status, eid)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "updated": cur.rowcount, "eid": eid, "status": body.status}


@app.delete("/api/cbg/item")
def del_item(req: Request, user_token: str = "", eid: str = ""):
    if not eid:
        raise HTTPException(status_code=400, detail="缺少 eid")
    conn = get_db()
    conn.execute("DELETE FROM captured_item WHERE eid=?", (eid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/cbg/label")
def del_label(req: Request, user_token: str = "", label: str = ""):
    if not label:
        raise HTTPException(status_code=400, detail="缺少 label")
    conn = get_db()
    conn.execute("DELETE FROM captured_item WHERE capture_label=?", (label,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/cbg/items/type")
def del_items_by_type(req: Request, user_token: str = "", item_type: str = ""):
    """按 item_type 批量删除（如 item_type=role 清空全部角色藏品）。"""
    if not item_type:
        raise HTTPException(status_code=400, detail="缺少 item_type")
    conn = get_db()
    cur = conn.execute("DELETE FROM captured_item WHERE item_type=?", (item_type,))
    conn.commit()
    conn.close()
    return {"ok": True, "deleted": cur.rowcount}


# ---------- 自动采集订阅（插件定时触发） ----------
@app.get("/api/cbg/subscriptions")
def list_subscriptions(req: Request, user_token: str = ""):
    # 本机单用户：订阅由网页创建（网页 token），插件弹窗也要能看到全部订阅，
    # 故不按 token 过滤（与 due_subscriptions 同口径）。
    _user(req, user_token)  # 仍要求带 token，但不用来过滤
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM subscription ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["enabled"] = bool(d.get("enabled"))
        out.append(d)
    return {"subscriptions": out}


@app.post("/api/cbg/subscriptions")
def create_subscription(item: SubscriptionIn):
    ut = item.user_token or "local"
    now = time.time()
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO subscription
           (user_token, name, server_id, server_name, search_url, conditions_json,
            label, enabled, interval_minutes, last_run, next_run, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            ut, item.name, item.server_id, item.server_name, item.search_url,
            item.conditions_json, item.label or "未分类", 1 if item.enabled else 0,
            item.interval_minutes, None, now, now,
        ),
    )
    sid = cur.lastrowid
    conn.commit()
    conn.close()
    return {"ok": True, "id": sid}


@app.get("/api/cbg/subscriptions/due")
def due_subscriptions(req: Request, user_token: str = ""):
    """返回已启用且到点(next_run<=now)的订阅，供插件定时器拉取执行。

    说明：订阅由网页端创建（user_token=网页 localStorage 随机串），而调度由插件
    background 驱动（X-User-Token=插件 chrome.storage 里的另一个随机串），两者 token
    不一致。本机单用户场景下，这里不按 token 过滤，返回本机所有已启用且到点的订阅；
    采集结果归属在 capture 阶段会通过 subscription_id 反查订阅真实 user_token 解决。
    """
    _user(req, user_token)  # 仍要求带 token（插件调用），但不用来过滤
    now = time.time()
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM subscription WHERE enabled=1 AND next_run<=?",
        (now,),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["enabled"] = bool(d.get("enabled"))
        out.append(d)
    return {"subscriptions": out}


@app.get("/api/cbg/subscriptions/{sid}")
def get_subscription(sid: int, req: Request, user_token: str = ""):
    ut = _user(req, user_token)
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM subscription WHERE id=? AND user_token=?", (sid, ut)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    d = dict(row)
    d["enabled"] = bool(d.get("enabled"))
    return {"subscription": d}


@app.put("/api/cbg/subscriptions/{sid}")
def update_subscription(sid: int, item: SubscriptionUpdate):
    conn = get_db()
    row = conn.execute("SELECT id FROM subscription WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    sets, args = [], []
    for f in ("name", "server_id", "server_name", "search_url", "conditions_json", "label", "interval_minutes"):
        v = getattr(item, f, None)
        if v is not None:
            sets.append(f + "=?")
            args.append(v)
    if item.enabled is not None:
        sets.append("enabled=?")
        args.append(1 if item.enabled else 0)
    if sets:
        conn.execute(
            "UPDATE subscription SET " + ", ".join(sets) + " WHERE id=?", args + [sid]
        )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/cbg/subscriptions/{sid}")
def delete_subscription(sid: int, req: Request, user_token: str = ""):
    # 本机单用户：不按 token 过滤，网页/插件都能删除（与 list/due 同口径）
    _user(req, user_token)
    conn = get_db()
    conn.execute("DELETE FROM subscription WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/cbg/subscriptions/{sid}/ran")
def mark_ran(sid: int, result: Optional[RanResult] = None):
    """插件完成一次采集后回写：last_run=now, next_run=now+interval；附带采集结果供诊断/展示。"""
    conn = get_db()
    row = conn.execute(
        "SELECT interval_minutes FROM subscription WHERE id=?", (sid,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    iv = row["interval_minutes"] or 60
    now = time.time()
    last_result = None
    if result is not None:
        last_result = json.dumps(
            {"scanned": result.scanned, "captured": result.captured, "error": result.error},
            ensure_ascii=False,
        )
        logger.info(
            "subscription %s 采集完成: scanned=%s captured=%s error=%s",
            sid, result.scanned, result.captured, result.error,
        )
    conn.execute(
        "UPDATE subscription SET last_run=?, next_run=?, last_result=? WHERE id=?",
        (now, now + iv * 60, last_result, sid),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/cbg/subscriptions/{sid}/run-now")
def run_now(sid: int, req: Request, user_token: str = ""):
    """立即触发：把 next_run 设为 now，下一次定时器（≤1分钟）即会执行。"""
    ut = _user(req, user_token)
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM subscription WHERE id=? AND user_token=?", (sid, ut)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    conn.execute("UPDATE subscription SET next_run=? WHERE id=?", (time.time(), sid))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- 估价接口 ----------
class PriceRequest(BaseModel):
    attrs: dict


@app.post("/api/cbg/price/role")
def price_role(body: PriceRequest):
    """角色估价：传入 attrs 字典，返回估价明细"""
    result = calculate_role_price(body.attrs)
    return result


@app.get("/api/cbg/price/item/{eid}")
def price_item(eid: str, req: Request, user_token: str = ""):
    """从库内已采集的角色计算估价"""
    ut = _user(req, user_token)
    conn = get_db()
    row = conn.execute(
        "SELECT attrs_json, item_type FROM captured_item WHERE eid=? AND user_token=?",
        (eid, ut),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="item not found")
    if row["item_type"] != "role":
        return {"error": "仅支持角色估价"}
    attrs = json.loads(row["attrs_json"] or "{}")
    return calculate_role_price(attrs)


if __name__ == "__main__":
    import uvicorn

    logger.info("starting cbg backend on :8006")
    uvicorn.run(app, host="0.0.0.0", port=8006)
