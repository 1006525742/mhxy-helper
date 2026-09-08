"""
梦幻西游 · 收货采集后端 (harvest)
=================================
对标 mhxyai.com/v2/price/time/market 的「时间服全区物价表」：
- 一条记录 = 一次收货价采集样本（物品名 / 分类 / 服务器 / 收货价 / 图标 / 采集时间）
- 展示时按「物品」聚合，得到 平均收货价 / 最低收货价 / 最高收货价 / 样本数 / 最新采集时间
- 分类侧栏与 mhxyai 保持一致（CATEGORIES 由扒站结果填充，见底部标注）

运行：uvicorn backend_harvest:app --host 0.0.0.0 --port 8007
数据：backend/data/harvest.json
"""
import json
import os
import time
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="梦幻收货采集", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "harvest.json")
CAT_FILE = os.path.join(os.path.dirname(__file__), "data", "categories.json")

# ===== 分类（与 mhxyai.com/v2/price/time/market 完全一致）=====
# 来源：GET https://mhxyai.com/v2/api/admin/price/categories (serverType=time)
# 两级树：14 个顶级分类 + 103 个叶子分类，叶子含 parentCategoryId 指回顶级。
# 落盘在 data/categories.json，启动时载入；缺失则退回内置兜底。
def load_taxonomy() -> dict:
    try:
        with open(CAT_FILE, "r", encoding="utf-8") as f:
            doc = json.load(f)
        cats = doc.get("categories", [])
    except (FileNotFoundError, json.JSONDecodeError):
        cats = []
    if not cats:
        cats = [
            {"categoryId": 1, "serverType": "time", "levelNo": 1, "parentCategoryId": None, "categoryName": "宝石", "displayName": "宝石"},
            {"categoryId": 154, "serverType": "time", "levelNo": 1, "parentCategoryId": None, "categoryName": "魔兽要诀", "displayName": "魔兽要诀"},
        ]
    by_id = {c["categoryId"]: c for c in cats}
    tops = [c for c in cats if c.get("levelNo") == 1]
    leaves = [c for c in cats if c.get("levelNo") == 2]
    # 顶级名 -> 树节点
    tree = []
    top_names = set()
    leaf_parent = {}      # 叶子分类名 -> 顶级分类名
    for t in tops:
        top_names.add(t["categoryName"])
        tree.append({
            "id": t["categoryId"],
            "name": t["categoryName"],
            "displayName": t.get("displayName") or t["categoryName"],
            "children": [],
        })
    top_index = {n["name"]: n for n in tree}
    for lf in leaves:
        pid = lf.get("parentCategoryId")
        parent = by_id.get(pid)
        parent_name = parent["categoryName"] if parent else None
        leaf_parent[lf["categoryName"]] = parent_name
        if parent_name in top_index:
            top_index[parent_name]["children"].append({
                "id": lf["categoryId"],
                "name": lf["categoryName"],
                "displayName": lf.get("displayName") or lf["categoryName"],
            })
        elif parent_name is None:
            # 孤儿叶子：自成一格顶级
            top_names.add(lf["categoryName"])
            tree.append({"id": lf["categoryId"], "name": lf["categoryName"],
                         "displayName": lf.get("displayName") or lf["categoryName"], "children": []})
    return {"tree": tree, "top_names": top_names, "leaf_parent": leaf_parent}


TAX = load_taxonomy()


def parent_of(category: str):
    """给定分类名，返回其顶级分类名（叶子查表；顶级返回自身；未知返回空）。"""
    if category in TAX["top_names"]:
        return category
    return TAX["leaf_parent"].get(category, "")


def match_category(rows: list, category: str) -> list:
    """筛选：category 为顶级名 -> 匹配 parent；否则精确匹配 category 字段。"""
    if not category:
        return rows
    if category in TAX["top_names"]:
        return [r for r in rows if r.get("parent") == category]
    return [r for r in rows if r["category"] == category]


# ---------- 存储 ----------
def load_db() -> dict:
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"samples": []}


def save_db(db: dict) -> None:
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


# ---------- 模型 ----------
class SampleIn(BaseModel):
    item_name: str
    category: str
    server: str
    price: float
    icon: Optional[str] = None          # 形如 "道具/特赦令牌.png"，前端经 /static/icons 代理取图
    collected_at: Optional[int] = None  # epoch 秒；缺省取当前时间


# ---------- 接口 ----------
@app.get("/api/harvest/categories")
def get_categories():
    """返回与 mhxyai 一致的两级分类树（顶级 + 叶子）。"""
    return {"success": True, "tree": TAX["tree"], "topNames": sorted(TAX["top_names"])}


@app.post("/api/harvest")
def add_sample(s: SampleIn):
    if not s.item_name or not s.category or not s.server:
        raise HTTPException(400, "item_name / category / server 必填")
    if s.price is None or s.price < 0:
        raise HTTPException(400, "price 必须为非负数字")
    db = load_db()
    ts = s.collected_at or int(time.time())
    rec = {
        "id": uuid.uuid4().hex[:12],
        "item_name": s.item_name.strip(),
        "category": s.category.strip(),
        "server": s.server.strip(),
        "price": float(s.price),
        "icon": (s.icon or "").strip(),
        "collected_at": ts,
        "parent": parent_of(s.category.strip()),
    }
    db["samples"].append(rec)
    save_db(db)
    return {"success": True, "id": rec["id"]}


@app.get("/api/harvest/raw")
def list_raw(category: str = "", server: str = "", kw: str = ""):
    db = load_db()
    rows = db["samples"]
    rows = match_category(rows, category)
    if server:
        rows = [r for r in rows if server in r["server"]]
    if kw:
        rows = [r for r in rows if kw in r["item_name"]]
    rows.sort(key=lambda r: r["collected_at"], reverse=True)
    return {"success": True, "samples": rows, "total": len(rows)}


@app.get("/api/harvest")
def list_aggregated(category: str = "", server: str = "", kw: str = ""):
    """按物品聚合，输出 mhxyai 同款 7 字段 + 图片。"""
    db = load_db()
    rows = db["samples"]
    rows = match_category(rows, category)
    if server:
        rows = [r for r in rows if server in r["server"]]
    if kw:
        rows = [r for r in rows if kw in r["item_name"]]

    groups: dict = {}
    for r in rows:
        name = r["item_name"]
        g = groups.setdefault(name, {
            "item_name": name,
            "category": r["category"],
            "parent": r.get("parent", ""),
            "icon": r["icon"],
            "prices": [],
            "latest": 0,
        })
        g["prices"].append(r["price"])
        if r["collected_at"] > g["latest"]:
            g["latest"] = r["collected_at"]
            g["category"] = r["category"]
            g["icon"] = r["icon"]
            g["parent"] = r.get("parent", "")

    items = []
    for name, g in groups.items():
        ps = g["prices"]
        items.append({
            "item_name": name,
            "category": g["category"],
            "parent": g["parent"],
            "icon": g["icon"],
            "avg": round(sum(ps) / len(ps), 2),
            "min": min(ps),
            "max": max(ps),
            "count": len(ps),
            "latest": g["latest"],
        })
    items.sort(key=lambda x: x["latest"], reverse=True)
    return {"success": True, "items": items, "total": len(items)}


@app.delete("/api/harvest/clear")
def clear_all():
    save_db({"samples": []})
    return {"success": True}


@app.delete("/api/harvest/item/{name}")
def delete_item(name: str):
    """按物品名清空其全部采集样本（聚合表里的「清样本」用这个）。"""
    db = load_db()
    before = len(db["samples"])
    db["samples"] = [r for r in db["samples"] if r["item_name"] != name]
    save_db(db)
    return {"success": True, "deleted": before - len(db["samples"])}


@app.delete("/api/harvest/{sid}")
def delete_sample(sid: str):
    """按单条样本 id 删除。"""
    db = load_db()
    before = len(db["samples"])
    db["samples"] = [r for r in db["samples"] if r["id"] != sid]
    save_db(db)
    return {"success": True, "deleted": before - len(db["samples"])}


@app.post("/api/harvest/recognize")
async def recognize(file: UploadFile = File(...)):
    """接收截图，用 RapidOCR(PP-OCRv6) 识别文字块，返回带坐标与置信度的列表。

    前端用于「框选截图 → 上传 → 候选勾选入库」，对标 mhxyai 的摊位截图识别
    （对方后端同样是收图跑视觉识别）。坐标用于在 UI 里按版面顺序排列候选。
    """
    import numpy as np
    import cv2
    from services.rapidocr_recognizer import get_ocr_engine

    data = await file.read()
    if not data:
        raise HTTPException(400, "空文件")
    nparr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "无法解码图片，请传 PNG / JPG")

    engine = get_ocr_engine(use_cls=True)
    if engine is None:
        raise HTTPException(500, "OCR 引擎初始化失败")

    try:
        result = engine(img)
    except Exception as e:
        raise HTTPException(500, f"OCR 推理失败: {e}")

    blocks = []
    if result is not None and hasattr(result, "txts") and result.txts:
        txts = result.txts
        scores = getattr(result, "scores", None)
        boxes = getattr(result, "boxes", None)
        for i, text in enumerate(txts):
            box = boxes[i] if boxes is not None else None
            score = scores[i] if scores is not None else None
            yc = float(np.mean([p[1] for p in box])) if box is not None else 0.0
            xc = float(np.mean([p[0] for p in box])) if box is not None else 0.0
            blocks.append({
                "text": str(text),
                "score": float(score) if score is not None else 0.0,
                "x": xc,
                "y": yc,
            })
    # 按版面顺序：先按行（y 分桶 20px）再按列（x）
    blocks.sort(key=lambda b: (round(b["y"] / 20), b["x"]))
    h, w = img.shape[:2]
    return {"success": True, "size": [w, h], "blocks": blocks}


@app.get("/api/harvest/health")
def health():
    return {"success": True, "service": "harvest"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)
