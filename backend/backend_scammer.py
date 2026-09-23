#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
梦幻西游 · 骗子名单后端 (scammer)

运行：uvicorn backend_scammer:app --host 0.0.0.0 --port 8013

数据：
  backend/data/scammer.json         基线名单（由 scripts/import_scammer_xlsx.py 从 xlsx 生成）
  backend/data/scammer_reports.json 用户在线举报（与基线分开存，重新导入不会覆盖）

隐私策略：
  微信 / 微信号 / 提供人微信 / 手机号 属于个人信息，列表接口一律返回打码值，
  只有显式调用 /api/scammer/reveal 才返回明文，且带 IP 限流，避免被批量抓取。
"""
import os
import re
import json
import time
import threading
from collections import defaultdict
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
BASE_FILE = os.path.join(DATA_DIR, "scammer.json")
REPORT_FILE = os.path.join(DATA_DIR, "scammer_reports.json")

os.makedirs(DATA_DIR, exist_ok=True)

app = FastAPI(title="MHXY Scammer List")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_lock = threading.Lock()

CATEGORY_LABELS = {
    "gang": "骗子帮派",
    "scammer": "疑似骗子",
    "afk": "挂机不看号",
    "blacklist": "黑名单",
}

# ---------------- 数据读写 ----------------


def _load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_base():
    return _load_json(BASE_FILE, {"updatedAt": "", "notice": "", "rules": [], "records": []})


def load_reports():
    return _load_json(REPORT_FILE, {"reports": []}).get("reports", [])


def all_records():
    """基线 + 用户举报"""
    return load_base().get("records", []) + load_reports()


# ---------------- 脱敏 ----------------


def mask(s: str) -> str:
    """打码：手机号 199****2966；其余保留首尾各 1 字符"""
    if not s:
        return ""
    s = str(s)
    if re.fullmatch(r"1[3-9]\d{9}", s):
        return s[:3] + "****" + s[-4:]
    n = len(s)
    if n <= 2:
        return s[0] + "*" if n else ""
    if n <= 4:
        return s[0] + "*" * (n - 2) + s[-1]
    return s[:2] + "*" * (n - 4) + s[-2:]


def public_view(rec: dict) -> dict:
    """对外视图：敏感字段替换成打码值 + hasSensitive 标记"""
    out = dict(rec)
    sen = rec.get("sensitive") or {}
    out["sensitive"] = {
        "wechat": mask(sen.get("wechat", "")),
        "wechatId": mask(sen.get("wechatId", "")),
        "reporterWechat": mask(sen.get("reporterWechat", "")),
        "phones": [mask(p) for p in sen.get("phones", [])],
    }
    out["hasSensitive"] = any(
        sen.get(k) for k in ("wechat", "wechatId", "reporterWechat")
    ) or bool(sen.get("phones"))
    return out


# ---------------- reveal 限流 ----------------

_reveal_hits = defaultdict(list)
REVEAL_LIMIT = 30      # 每分钟最多 30 次
REVEAL_WINDOW = 60


def _client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return req.client.host if req.client else "unknown"


def _allow_reveal(ip: str) -> bool:
    now = time.time()
    arr = [t for t in _reveal_hits[ip] if now - t < REVEAL_WINDOW]
    arr.append(now)
    _reveal_hits[ip] = arr
    return len(arr) <= REVEAL_LIMIT


# ---------------- 接口 ----------------


@app.get("/api/scammer/meta")
def meta():
    base = load_base()
    reports = load_reports()
    recs = base.get("records", []) + reports
    by_cat = defaultdict(int)
    for r in recs:
        by_cat[r.get("category", "scammer")] += 1
    return {
        "result": "ok",
        "updatedAt": base.get("updatedAt", ""),
        "notice": base.get("notice", ""),
        "rules": base.get("rules", []),
        "total": len(recs),
        "userReports": len(reports),
        "highRisk": sum(1 for r in recs if r.get("risk") == "high"),
        "byCategory": {k: {"label": CATEGORY_LABELS.get(k, k), "count": v}
                       for k, v in by_cat.items()},
    }


@app.get("/api/scammer/list")
def list_records(category: str = "", q: str = "", risk: str = "", limit: int = 500):
    recs = all_records()
    kw = (q or "").strip().lower()
    out = []
    for r in recs:
        if category and r.get("category") != category:
            continue
        if risk and r.get("risk") != risk:
            continue
        if kw:
            hay = " ".join([
                str(r.get("name", "")), str(r.get("gameId", "")), str(r.get("type", "")),
                str(r.get("detail", "")), str(r.get("reporter", "")), str(r.get("level", "")),
            ]).lower()
            if kw not in hay:
                continue
        out.append(public_view(r))
    # 先按时间倒序，再利用稳定排序把高风险顶到前面（同风险组内保持时间倒序）
    out.sort(key=lambda r: r.get("timeISO") or "", reverse=True)
    out.sort(key=lambda r: 0 if r.get("risk") == "high" else 1)
    return {"result": "ok", "total": len(out), "records": out[:limit]}


@app.get("/api/scammer/check")
def check(q: str = ""):
    """组队/交易前查 ID 或昵称：精确 ID 命中优先，其次昵称包含匹配"""
    kw = (q or "").strip()
    if not kw:
        return {"result": "ok", "level": "none", "hits": [], "keyword": ""}

    kw_low = kw.lower()
    exact, fuzzy = [], []
    for r in all_records():
        gid = str(r.get("gameId", "")).strip()
        name = str(r.get("name", "")).strip()
        if gid and gid == kw:
            exact.append(r)
        elif gid and kw_low in gid.lower():
            fuzzy.append(r)
        elif name and (name.lower() == kw_low or kw_low in name.lower()):
            fuzzy.append(r)

    hits = exact + fuzzy
    level = "danger" if exact else ("warn" if hits else "safe")
    return {
        "result": "ok",
        "keyword": kw,
        "level": level,
        "count": len(hits),
        "hits": [public_view(r) for r in hits[:20]],
    }


class ReportIn(BaseModel):
    name: str = Field("", max_length=64)
    gameId: str = Field("", max_length=32)
    level: str = Field("", max_length=16)
    type: str = Field("", max_length=64)      # 骗术类型，如「抓鬼骗钱」
    time: str = Field("", max_length=64)
    detail: str = Field("", max_length=1000)
    reporter: str = Field("", max_length=64)
    wechat: str = Field("", max_length=64)
    wechatId: str = Field("", max_length=64)


@app.post("/api/scammer/report")
async def report(body: ReportIn, req: Request):
    """用户举报：入库后所有人可见，标记 source=user / verified=false"""
    ip = _client_ip(req)
    if not body.name and not body.gameId and not body.wechat:
        return {"result": "error", "error": "游戏昵称、ID、微信至少填一项"}

    now = datetime.now()
    recs = load_reports()
    seq = len(recs) + 1
    phones = re.findall(r"(?<!\d)(1[3-9]\d{9})(?!\d)", body.detail)
    detail = re.sub(r"(?<!\d)(1[3-9]\d{9})(?!\d)",
                    lambda m: m.group(1)[:3] + "****" + m.group(1)[-4:],
                    body.detail)

    rec = {
        "id": f"user-{now.strftime('%Y%m%d%H%M%S')}-{seq:03d}",
        "category": "scammer",
        "name": body.name.strip() or "(未提供昵称)",
        "gameId": body.gameId.strip(),
        "level": body.level.strip(),
        "type": body.type.strip() or "未分类",
        "time": body.time.strip(),
        "timeISO": now.strftime("%Y-%m-%d"),
        "reporter": body.reporter.strip(),
        "detail": detail.strip(),
        "sensitive": {
            "wechat": body.wechat.strip(),
            "wechatId": body.wechatId.strip(),
            "reporterWechat": "",
            "phones": phones,
        },
        "source": "user",
        "verified": False,
        "risk": "normal",
        "createdAt": now.strftime("%Y-%m-%d %H:%M:%S"),
        "ip": ip,
    }

    # 同一 ID/名字已有人举报过 -> 升级为高风险
    key = rec["gameId"] or rec["name"]
    if any((r.get("gameId") or r.get("name")) == key for r in all_records()):
        rec["risk"] = "high"

    with _lock:
        cur = load_reports()
        cur.append(rec)
        _save_json(REPORT_FILE, {"reports": cur})

    return {"result": "ok", "record": public_view(rec), "message": "举报已提交，其他玩家现在也能看到"}


@app.get("/api/scammer/reveal")
def reveal(req: Request, id: str = "", field: str = ""):
    """按需返回单个敏感字段明文（带限流）"""
    ip = _client_ip(req)
    if not _allow_reveal(ip):
        return {"result": "error", "error": "查询过于频繁，请稍后再试"}

    allowed = {"wechat", "wechatId", "reporterWechat", "phones"}
    if field not in allowed:
        return {"result": "error", "error": "非法字段"}

    for r in all_records():
        if r.get("id") == id:
            sen = r.get("sensitive") or {}
            val = sen.get(field, "")
            if field == "phones":
                return {"result": "ok", "value": val or [], "masked": bool(val)}
            return {"result": "ok", "value": val, "masked": bool(val)}
    return {"result": "error", "error": "记录不存在"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "scammer", "port": 8013}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8013)
