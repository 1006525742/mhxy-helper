#!/usr/bin/env python3
"""资产登记后端 - 梦幻西游囤货/倒卖的个人资产登记本。

定位：只做「登记」，不做经营分析。
  - 记录：买了什么、多少钱、什么时候、卖了多少、压了多久
  - 计算：压货天数、利润、利润率（仅这三个）
  - 不做：统计看板、排行榜、经营诊断、年化收益率

金额单位统一为「万」（梦幻币）。费用 fee 也是「万」，是金额不是费率。

端口 8012 / 数据库 backend/data/asset.db
（端口说明：8011 已被 backend_notify 占用，本项目实际占用见下）
"""
import csv
import io
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "asset.db"

# 物品类型（与藏宝阁/竞品口径对齐）
ITEM_TYPES = [
    "武器", "装备", "灵饰", "玉魄", "召唤兽装备",
    "召唤兽", "灵犀玉", "宝石", "材料", "角色", "其他",
]

# 压货超过该天数，前端标橙预警
HOLD_WARN_DAYS = 30

# ---------------- OCR + 规则解析（截图识别，可选依赖） ----------------
try:
    from PIL import Image
    import numpy as np
    from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR
    _OCR_OK = True
except Exception:
    _OCR_OK = False
_ocr_engine = None

def _get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
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
    return _ocr_engine

def ocr_image_to_lines(raw: bytes) -> List[str]:
    """图片 -> OCR 逐行文本。RapidOCR 返回 txts 列表（每行一个）。"""
    if not _OCR_OK:
        return []
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.array(img)[:, :, ::-1].copy()  # RGB -> BGR
    res = _get_ocr_engine()(arr)
    lines = []
    if res is not None and getattr(res, "txts", None):
        for t in res.txts:
            if t and isinstance(t, str) and t.strip():
                lines.append(t.strip())
    return lines

# ---------- OCR 结构化（规则模板 v2，覆盖装备多字段） ----------
# 装备基础/附加属性词表（双向匹配）
_ZBX_ATTRS = [
    "体质", "魔力", "力量", "耐力", "敏捷", "气血", "魔法", "伤害", "命中", "防御",
    "速度", "法术防御", "法术伤害", "抗封", "躲避", "灵力", "修炼", "封印命中",
    "抗封印", "治疗能力", "物理暴击", "法术暴击", "抗物理暴击", "抗法术暴击",
    "固伤", "法力",
]
# 宝石词表
_GEMS = [
    "黑宝石", "红宝石", "黄宝石", "蓝宝石", "绿宝石", "月亮石", "太阳石", "舍利子",
    "光芒石", "神秘石", "翡翠石", "星辉石", "星陨石", "吸收宝石", "黑曜石", "猫眼石",
]
# 特技 / 特效词表
_EFFECTS = [
    "暴怒", "愤怒", "破血狂攻", "弱点攻击", "破碎无双", "命归术", "慈航普度", "晶清诀",
    "玉清诀", "四海升平", "罗汉金钟", "流云诀", "凝滞诀", "笑里藏刀", "放下屠刀",
    "碎甲术", "破甲术", "河东狮吼", "起死回生", "圣灵之甲", "修罗咒", "心如明镜",
    "镇海珠", "绝幻魔音", "野兽之力", "魔兽之印", "脱胎换骨", "太极护法", "普渡众生",
    "灵动九天", "经脉疗法", "归元心法", "长驱直入", "移形换影", "凝神诀", "明光宝珠",
    "神佑复生", "神农", "精致", "简易", "无级别限制", "专用", "不可磨灭", "坚固",
    "易成长", "必中", "再生", "冥思", "慧根", "幸运", "绝杀", "凝魂", "珍宝",
    "诅咒之伤", "诅咒之亡", "凝魄",
]


def _alt(words):
    """把词表拼成一个正则（长词优先，避免短词抢匹配）。"""
    return "|".join(sorted(set(words), key=len, reverse=True))


_TYPE_RE = re.compile(r"类型[:：]\s*([^\s,，。]+)")
_NAME_RE = re.compile(r"名称[:：]\s*([^\s,，。]+)")
_PRICE_RE = re.compile(r"(售价|价格|成交价|买入价|标价)\D*\d+")
_GEM_RE = re.compile(r"(?:" + _alt(_GEMS) + r")")
_EFFECT_RE = re.compile(r"(?:" + _alt(_EFFECTS) + r")")
_SET_RE = re.compile(r"附加状态[:：]?\s*([^\s,，。]+)|变化[:：]?\s*([^\s,，。]+)|套装[:：]?\s*([^\s,，。]+)")
_FORWARD_ATTR_RE = re.compile(r"(" + _alt(_ZBX_ATTRS) + r")\s*[+＋\-－]?\s*(\d+)")
_REVERSE_ATTR_RE = re.compile(r"(\d+)\s*(" + _alt(_ZBX_ATTRS) + r")")
_DUAN_RE = re.compile(r"(\d+)\s*锻")
_KONG_RE = re.compile(r"(\d+)\s*孔")


def _is_attr_line(line: str) -> bool:
    return bool(
        _FORWARD_ATTR_RE.search(line) or _REVERSE_ATTR_RE.search(line)
        or _DUAN_RE.search(line) or _KONG_RE.search(line)
        or _GEM_RE.search(line) or _EFFECT_RE.search(line) or _SET_RE.search(line)
    )


def parse_asset_from_ocr(lines: List[str]) -> dict:
    """规则模板 v2：OCR 文本 -> 资产字段。
    覆盖：属性(正向/反向) / 锻炼段数 / 开孔数 / 宝石 / 特技特效 / 套装状态。
    价格不抽，留手填。
    """
    item_type = ""
    name = ""
    attr_parts: List[str] = []
    equip_like = False
    for line in lines:
        if _PRICE_RE.search(line):
            continue
        # 类型
        if not item_type:
            m = _TYPE_RE.search(line)
            if m:
                item_type = m.group(1)
            else:
                for t in ITEM_TYPES:
                    if t == "宝石":
                        continue  # 「黑宝石」等宝石名含「宝石」，不应据此误判大类
                    if t in line:
                        item_type = t
                        break
        # 名称
        if not name:
            m = _NAME_RE.search(line)
            if m:
                name = m.group(1)
        # 正向属性：体质+24
        for m in _FORWARD_ATTR_RE.finditer(line):
            attr_parts.append(f"{m.group(1)}+{m.group(2)}")
            equip_like = True
        # 反向属性：2体质
        for m in _REVERSE_ATTR_RE.finditer(line):
            attr_parts.append(f"{m.group(2)}+{m.group(1)}")
            equip_like = True
        # 锻炼段数：10锻
        m = _DUAN_RE.search(line)
        if m:
            attr_parts.append(f"锻炼+{m.group(1)}")
            equip_like = True
        # 开孔数：4孔
        m = _KONG_RE.search(line)
        if m:
            attr_parts.append(f"孔数+{m.group(1)}")
            equip_like = True
        # 宝石
        for m in _GEM_RE.finditer(line):
            attr_parts.append(f"宝石:{m.group(0)}")
        # 套装 / 状态
        m = _SET_RE.search(line)
        if m:
            val = next((g for g in m.groups() if g), "")
            if val:
                attr_parts.append(f"套装:{val}")
                equip_like = True
        # 特技 / 特效
        for m in _EFFECT_RE.finditer(line):
            attr_parts.append(f"特效:{m.group(0)}")
    # 去重保序
    seen = set()
    attrs = []
    for a in attr_parts:
        if a not in seen:
            seen.add(a)
            attrs.append(a)
    # 无显式类型且形态像装备时，默认归类为「装备」
    if not item_type and equip_like:
        item_type = "装备"
    # 名称兜底：取首个非属性/非类型/非价格/不含关键字的短行
    if not name:
        for line in lines:
            if _is_attr_line(line) or _PRICE_RE.search(line):
                continue
            if item_type and item_type in line:
                continue
            if "类型" in line or "名称" in line or "：" in line or ":" in line:
                continue
            if 2 <= len(line) <= 20:
                name = line
                break
    return {
        "item_type": item_type,
        "name": name,
        "attributes": "\n".join(attrs),
        "raw_text": "\n".join(lines),
    }

app = FastAPI(title="MHXY Asset Register", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- 数据库 ----------------

def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS asset (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            code                TEXT,
            item_type           TEXT,
            server              TEXT,
            name                TEXT NOT NULL,
            attributes          TEXT,
            related_role        TEXT,
            qty                 INTEGER DEFAULT 1,
            buy_price           REAL,
            buy_date            TEXT,
            sell_price          REAL,
            sell_date           TEXT,
            fee                 REAL DEFAULT 0,
            note                TEXT,
            listing_reminder_at TEXT,
            status              TEXT DEFAULT 'in_stock',
            source              TEXT DEFAULT 'manual',
            cbg_eid             TEXT,
            deleted_at          TEXT,
            created_at          TEXT,
            updated_at          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_asset_status ON asset(status, deleted_at);
        CREATE INDEX IF NOT EXISTS idx_asset_name   ON asset(name);
        """
    )
    conn.commit()
    conn.close()


init_db()


# ---------------- 计算 ----------------

def _days(a: Optional[str], b: Optional[str]) -> Optional[int]:
    """两个 YYYY-MM-DD 之间相差天数，任一为空返回 None"""
    if not a or not b:
        return None
    try:
        d1 = datetime.strptime(a, "%Y-%m-%d")
        d2 = datetime.strptime(b, "%Y-%m-%d")
        return (d2 - d1).days
    except Exception:
        return None


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def decorate(row: sqlite3.Row) -> Dict[str, Any]:
    """给一条记录补上派生字段：压货天数、利润、利润率、成本、收入"""
    d = dict(row)
    buy_price = d.get("buy_price")
    sell_price = d.get("sell_price")
    qty = d.get("qty") or 1
    fee = d.get("fee") or 0.0

    buy_date = d.get("buy_date")
    sell_date = d.get("sell_date")

    # 压货天数：已售算到卖出日，未售算到今天
    hold_days = _days(buy_date, sell_date) if sell_date else _days(buy_date, _today())
    d["hold_days"] = hold_days
    d["hold_warning"] = bool(hold_days is not None and hold_days > HOLD_WARN_DAYS)

    d["cost"] = round((buy_price or 0) * qty, 4)
    profit = None
    profit_rate = None
    if sell_price is not None and buy_price is not None:
        revenue = sell_price * qty
        profit = round(revenue - (buy_price * qty) - fee, 4)
        d["revenue"] = round(revenue, 4)
        if buy_price * qty:
            profit_rate = round(profit / (buy_price * qty), 4)
    d["profit"] = profit
    d["profit_rate"] = profit_rate
    return d


# ---------------- 列表 ----------------

@app.get("/api/asset/list")
def list_assets(
    status: str = "in_stock",      # in_stock / sold / all / trash
    kw: str = "",                  # 关键词：名称 / 属性 / 代号 / 备注
    item_type: str = "",
    server: str = "",
    sort: str = "created_desc",    # created_desc / buy_date_desc / price_desc / profit_desc / hold_desc
    page: int = 1,
    page_size: int = 20,
):
    conn = get_db()
    clauses: List[str] = []
    args: List[Any] = []

    if status == "trash":
        clauses.append("deleted_at IS NOT NULL")
    else:
        clauses.append("deleted_at IS NULL")
        if status in ("in_stock", "sold"):
            clauses.append("status=?")
            args.append(status)

    if kw:
        clauses.append("(name LIKE ? OR attributes LIKE ? OR code LIKE ? OR note LIKE ?)")
        args.extend([f"%{kw}%"] * 4)
    if item_type and item_type != "all":
        clauses.append("item_type=?")
        args.append(item_type)
    if server:
        clauses.append("server LIKE ?")
        args.append(f"%{server}%")

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""

    total = conn.execute(
        "SELECT COUNT(*) AS c FROM asset" + where, args
    ).fetchone()["c"]

    order = {
        "created_desc": "created_at DESC",
        "buy_date_desc": "buy_date DESC",
        "price_desc": "buy_price DESC",
        "price_asc": "buy_price ASC",
        "profit_desc": "(sell_price - buy_price) DESC",
        "hold_desc": "buy_date ASC",
    }.get(sort, "created_at DESC")

    offset = max(0, (page - 1) * page_size)
    rows = conn.execute(
        f"SELECT * FROM asset{where} ORDER BY {order} LIMIT ? OFFSET ?",
        args + [page_size, offset],
    ).fetchall()
    conn.close()

    return {"success": True, "total": total, "items": [decorate(r) for r in rows]}


# ---------------- 汇总（一行） ----------------

@app.get("/api/asset/summary")
def summary():
    """一行最小汇总：在库件数 / 成本合计 / 已售利润"""
    conn = get_db()
    stock_rows = conn.execute(
        "SELECT * FROM asset WHERE deleted_at IS NULL AND status='in_stock'"
    ).fetchall()
    sold_rows = conn.execute(
        "SELECT * FROM asset WHERE deleted_at IS NULL AND status='sold'"
    ).fetchall()
    conn.close()

    stock_qty = sum((r["qty"] or 1) for r in stock_rows)
    stock_cost = round(
        sum(((r["buy_price"] or 0) * (r["qty"] or 1)) for r in stock_rows), 4
    )
    sold_profit = round(
        sum((decorate(r)["profit"] or 0) for r in sold_rows), 4
    )
    return {
        "success": True,
        "stock_count": len(stock_rows),
        "stock_qty": stock_qty,
        "stock_cost": stock_cost,
        "sold_count": len(sold_rows),
        "sold_profit": sold_profit,
    }


# ---------------- 新增 ----------------

@app.post("/api/asset/create")
def create_asset(payload: Dict[str, Any]):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="物品名称不能为空")

    # 批量重复录入：连续录入时用同一份数据写 N 条
    try:
        batch = int(payload.get("batch_save_count") or 1)
    except Exception:
        batch = 1
    batch = max(1, min(batch, 50))

    now = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    ids = []
    for _ in range(batch):
        cur = conn.execute(
            """INSERT INTO asset
               (code, item_type, server, name, attributes, related_role, qty,
                buy_price, buy_date, fee, note, listing_reminder_at,
                status, source, cbg_eid, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                payload.get("code") or "",
                payload.get("item_type") or "",
                payload.get("server") or "",
                name,
                payload.get("attributes") or "",
                payload.get("related_role") or "",
                int(payload.get("qty") or 1),
                payload.get("buy_price"),
                payload.get("buy_date") or _today(),
                float(payload.get("fee") or 0),
                payload.get("note") or "",
                payload.get("listing_reminder_at") or "",
                payload.get("status") or "in_stock",
                payload.get("source") or "manual",
                payload.get("cbg_eid") or "",
                now_str,
                now_str,
            ),
        )
        ids.append(cur.lastrowid)
    conn.commit()

    row = conn.execute("SELECT * FROM asset WHERE id=?", (ids[0],)).fetchone()
    conn.close()
    return {"success": True, "ids": ids, "item": decorate(row)}


# ---------------- 类型字典 / 导出 / 健康检查 ----------------
# 注意：这些固定路径必须注册在 /api/asset/{asset_id} 之前，
# 否则会被参数路由抢先匹配（FastAPI 按注册顺序匹配）。

@app.get("/api/asset/types")
def types():
    return {"success": True, "types": ITEM_TYPES, "hold_warn_days": HOLD_WARN_DAYS}


@app.post("/api/asset/ocr-parse")
async def ocr_parse(img: UploadFile = File(...)):
    """截图识别：OCR 出文字 -> 规则抽取 类型/名称/属性。价格不抽，留手填。"""
    if not _OCR_OK:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "OCR 引擎未加载（缺少 rapidocr/PIL 依赖）"},
        )
    try:
        raw = await img.read()
        lines = ocr_image_to_lines(raw)
        parsed = parse_asset_from_ocr(lines)
        return parsed
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": f"识别失败：{e}"})


@app.get("/api/asset/health")
def health():
    return {"success": True, "service": "asset", "db": str(DB_PATH)}


@app.get("/api/asset/export")
def export_csv(status: str = "all"):
    conn = get_db()
    clauses, args = [], []
    if status == "trash":
        clauses.append("deleted_at IS NOT NULL")
    else:
        clauses.append("deleted_at IS NULL")
        if status in ("in_stock", "sold"):
            clauses.append("status=?")
            args.append(status)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute("SELECT * FROM asset" + where + " ORDER BY id DESC", args).fetchall()
    conn.close()

    buf = io.StringIO()
    buf.write("\ufeff")  # BOM，兼容 Excel 打开中文
    writer = csv.writer(buf)
    writer.writerow([
        "代号", "类型", "区服", "物品名称", "物品属性", "对应角色", "数量",
        "买入价(万)", "买入日期", "卖出价(万)", "卖出日期", "费用(万)",
        "压货天数", "利润(万)", "利润率", "状态", "备注",
    ])
    for r in rows:
        d = decorate(r)
        writer.writerow([
            d.get("code") or "", d.get("item_type") or "", d.get("server") or "",
            d.get("name") or "", d.get("attributes") or "", d.get("related_role") or "",
            d.get("qty") or 1, d.get("buy_price") if d.get("buy_price") is not None else "",
            d.get("buy_date") or "", d.get("sell_price") if d.get("sell_price") is not None else "",
            d.get("sell_date") or "", d.get("fee") or 0,
            d.get("hold_days") if d.get("hold_days") is not None else "",
            d.get("profit") if d.get("profit") is not None else "",
            d.get("profit_rate") if d.get("profit_rate") is not None else "",
            "已售" if d.get("status") == "sold" else "未售",
            d.get("note") or "",
        ])
    buf.seek(0)
    filename = f"assets_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------- 详情 ----------------

@app.get("/api/asset/{asset_id}")
def get_asset(asset_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM asset WHERE id=?", (asset_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"success": True, "item": decorate(row)}


# ---------------- 编辑 / 标记售出 ----------------

@app.patch("/api/asset/{asset_id}")
def update_asset(asset_id: int, payload: Dict[str, Any]):
    conn = get_db()
    row = conn.execute("SELECT * FROM asset WHERE id=?", (asset_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="记录不存在")

    editable = [
        "code", "item_type", "server", "name", "attributes", "related_role",
        "qty", "buy_price", "buy_date", "sell_price", "sell_date", "fee",
        "note", "listing_reminder_at", "cbg_eid",
    ]
    sets, args = [], []
    for k in editable:
        if k in payload:
            sets.append(f"{k}=?")
            args.append(payload[k])

    # 标记售出：给了 sell_price 就自动置为 sold，日期缺省为今天
    if payload.get("sell_price") is not None and not row["sell_date"]:
        if "sell_date" not in payload:
            sets.append("sell_date=?")
            args.append(_today())
        sets.append("status=?")
        args.append("sold")

    if sets:
        sets.append("updated_at=?")
        args.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        args.append(asset_id)
        conn.execute(
            "UPDATE asset SET " + ", ".join(sets) + " WHERE id=?",
            args,
        )
        conn.commit()

    new_row = conn.execute("SELECT * FROM asset WHERE id=?", (asset_id,)).fetchone()
    conn.close()
    return {"success": True, "item": decorate(new_row)}


@app.post("/api/asset/{asset_id}/split-sell")
def split_sell(asset_id: int, payload: Dict[str, Any]):
    """部分售出：拆成「已售 N 件」+「在库 M 件」两条记录"""
    try:
        sell_qty = int(payload.get("qty") or 0)
    except Exception:
        sell_qty = 0
    if sell_qty <= 0:
        raise HTTPException(status_code=400, detail="售出数量必须大于 0")

    conn = get_db()
    row = conn.execute("SELECT * FROM asset WHERE id=?", (asset_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="记录不存在")

    total_qty = row["qty"] or 1
    if sell_qty >= total_qty:
        conn.close()
        raise HTTPException(status_code=400, detail="售出数量不能超过库存，请直接标记售出")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sell_price = payload.get("sell_price")
    sell_date = payload.get("sell_date") or _today()
    fee = float(payload.get("fee") or 0)

    # 原记录缩减为剩余在库
    conn.execute(
        "UPDATE asset SET qty=?, updated_at=? WHERE id=?",
        (total_qty - sell_qty, now_str, asset_id),
    )
    # 新生成一条已售记录
    cur = conn.execute(
        """INSERT INTO asset
           (code, item_type, server, name, attributes, related_role, qty,
            buy_price, buy_date, sell_price, sell_date, fee, note,
            listing_reminder_at, status, source, cbg_eid, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'sold', ?,?,?,?)""",
        (
            row["code"], row["item_type"], row["server"], row["name"],
            row["attributes"], row["related_role"], sell_qty,
            row["buy_price"], row["buy_date"], sell_price, sell_date, fee,
            row["note"], row["listing_reminder_at"],
            row["source"], row["cbg_eid"], now_str, now_str,
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"success": True, "sold_id": new_id, "remain_id": asset_id}


# ---------------- 删除 / 回收站 ----------------

@app.delete("/api/asset/{asset_id}")
def soft_delete(asset_id: int):
    conn = get_db()
    conn.execute(
        "UPDATE asset SET deleted_at=? WHERE id=?",
        (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), asset_id),
    )
    conn.commit()
    conn.close()
    return {"success": True}


@app.post("/api/asset/{asset_id}/restore")
def restore(asset_id: int):
    conn = get_db()
    conn.execute("UPDATE asset SET deleted_at=NULL WHERE id=?", (asset_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.delete("/api/asset/{asset_id}/purge")
def purge(asset_id: int):
    conn = get_db()
    conn.execute("DELETE FROM asset WHERE id=?", (asset_id,))
    conn.commit()
    conn.close()
    return {"success": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8012)
