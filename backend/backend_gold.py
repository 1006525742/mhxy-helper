#!/usr/bin/env python3
"""全服金价后端 - 从梦幻西游物价API采集全部区服的游戏币(金价)行情。

数据来源:
  - 区服列表: https://mhapi.zyungame.com/mh/server/list/filter  (isShow=1 的全部区服，老服为主)
  - 补充名单: 藏宝阁开服年份表 cbg_server_ages.json 中 age∈{new, mid} 的新服/中服，按区名去重并入
  - 金价接口: https://mhapi.zyungame.com/mh/server/prices?serverName=<区服>
             返回 data.yxbPrices.{yxbPrice, date, area, openStatus, timeType, upDown7, upDown1}

金价定义: yxbPrice = 1元宝对应多少「万」游戏币 (单位: 万游戏币/元宝)。
断更判断: yxbPrices.date 距今 > 7 天 视为源站停更(陈货)，前端标红。
分档: 按真实开服日期(优先 CBG 表) 计算 1年内/1-3年/3年外。
"""
import json
import time
import threading
import base64
from datetime import datetime, date
from pathlib import Path

import requests
import urllib3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "gold_prices.json"
# 各区开服年份数据源：取自藏宝阁藏品模块生成的 cbg_server_ages.json（按 server_id→{name,date,age}）
# 优先用前端 canonical 文件，缺失时回退到后端本地副本
CBG_AGES_FILES = [
    BASE_DIR.parent / "frontend" / "public" / "cbg_server_ages.json",
    BASE_DIR / "data" / "cbg_server_ages.json",
]
# 可选的手动开服日期覆盖表 { "服务器名": "YYYY-MM-DD" }，用于修正个别偏差
OPEN_DATE_FILE = BASE_DIR / "data" / "server_open_dates.json"
LIST_API = "https://mhapi.zyungame.com/mh/server/list/filter"
PRICE_API = "https://mhapi.zyungame.com/mh/server/prices"
STALE_DAYS = 7          # 金价日期距今超过该天数视为断更
REFRESH_INTERVAL = 6 * 3600  # 内置定时刷新间隔(秒)，约 6 小时
# 永久排除名单：已确认合区/停服、两源都查不到的区，不参与采集与展示
EXCLUDE_SERVERS = {
    "金榜题名",
    "彩云归",
    "纵横驰骋",
    "西湖映月",
    "花样年华",
}

_data_cache = None
_cache_time = 0


def fetch_server_list():
    """动态拉取全部可显示区服名称"""
    try:
        resp = requests.get(LIST_API, timeout=15, verify=False)
        servers = resp.json().get("data", [])
        return [s["server"] for s in servers if s.get("isShow") == 1]
    except Exception as e:
        print(f"[gold] 拉取区服列表失败: {e}")
        return []


def fetch_gold(server):
    """拉取单个区服的金价原始数据"""
    try:
        resp = requests.get(PRICE_API, params={"serverName": server}, timeout=15, verify=False)
        data = (resp.json() or {}).get("data") or {}
        yxb = data.get("yxbPrices", {}) or {}
        price = yxb.get("yxbPrice")
        ydate = yxb.get("date", "")
        try:
            dt = datetime.strptime(ydate, "%Y-%m-%d").date()
            age = (date.today() - dt).days
        except Exception:
            dt, age = None, None
        return {
            "server": server,
            "area": yxb.get("area", ""),
            "openStatus": yxb.get("openStatus", ""),
            "timeType": yxb.get("timeType", ""),
            "yxbPrice": float(price) if price not in (None, "") else None,
            "date": ydate,
            "ageDays": age,
            "stale": (age is not None and age > STALE_DAYS) if age is not None else None,
            "upDown7": yxb.get("upDown7", ""),
            "upDown1": yxb.get("upDown1", ""),
        }
    except Exception as e:
        print(f"[gold] 获取 {server} 金价失败: {e}")
        return {"server": server, "yxbPrice": None, "date": "", "error": str(e)}


def apply_manual_guard(rec, manual_map):
    """手动更新保护：若该区服曾被手动赋值，只有上游行情日期比手动日期更新才覆盖。

    返回 (最终记录, 是否保留了手动值)
    """
    man = manual_map.get(rec.get("server"))
    if not man:
        return rec, False

    up_date = rec.get("date") or ""
    man_date = man.get("manualDate") or man.get("date") or ""

    if up_date > man_date:
        # 源站行情已比手动值更新 -> 恢复正常自动值，清除手动标记
        rec["manual"] = False
        print(f"[gold] {rec.get('server')}: 源站已更新({up_date} > {man_date})，改用自动值")
        return rec, False

    # 源站没有更新行情 -> 保留手动金价
    m = dict(rec)
    m["yxbPrice"] = man.get("manualPrice", man.get("yxbPrice"))
    m["date"] = man_date
    m["manual"] = True
    m["manualPrice"] = man.get("manualPrice", man.get("yxbPrice"))
    m["manualDate"] = man_date
    m["manualUpdatedAt"] = man.get("manualUpdatedAt", "")
    # 按手动日期重算断更状态
    try:
        dt = datetime.strptime(man_date, "%Y-%m-%d").date()
        m["ageDays"] = (date.today() - dt).days
        m["stale"] = m["ageDays"] > STALE_DAYS
    except Exception:
        m["ageDays"], m["stale"] = None, None
    return m, True


def load_365tools_index():
    """拉取 365tools 补充源(glod2?type=3)，解码混淆Base64，建 区服名(去空格)->记录 索引。"""
    try:
        r = requests.get("https://admin.365tools.cn/api/wx/glod2?type=3", timeout=20,
                         verify=False, headers={"User-Agent": "Mozilla/5.0"})
        obj = r.json()
        enc = obj.get("data", "")
        if not enc:
            return {}
        dec = base64.b64decode(enc.replace("$", "a").replace("#", "b") + "==")
        arr = json.loads(dec.decode("utf-8", "ignore"))
        idx = {}
        for it in arr:
            a = (it.get("area") or "").replace(" ", "")
            if a:
                idx[a] = it
        return idx
    except Exception as e:
        print(f"[gold] 365tools 拉取失败: {e}")
        return {}


def enrich_from_365tools(rec, idx):
    """mhapi 断更或缺失时，用 365tools 补充金价。返回 (rec, 是否补充)。

    规则: 手动价优先(不补)；mhapi 已实时(有价且非断更)不补；否则按区服名匹配 365tools，
    补 price 并标 date=今天、stale=False、src=365tools（365tools 无日期字段，按当天计）。
    """
    if rec.get("manual"):
        return rec, False
    if rec.get("yxbPrice") is not None and not rec.get("stale"):
        return rec, False
    s = (rec.get("server") or "").replace(" ", "")
    it = idx.get(s)
    if not it:
        return rec, False
    price = it.get("price")
    try:
        price = float(str(price).replace("¥", "").replace(",", ""))
    except Exception:
        return rec, False
    if not price:
        return rec, False
    rec["yxbPrice"] = price
    rec["date"] = date.today().strftime("%Y-%m-%d")
    rec["ageDays"] = 0
    rec["stale"] = False
    rec["src"] = "365tools"
    return rec, True


def sync_all():
    """全量采集所有区服金价并落盘，返回汇总"""
    base = fetch_server_list()
    extra = load_extra_server_names()   # CBG 新服/中服候选区名
    # 合并去重：base 优先(含 timeType 等字段)，extra 仅补充源站未覆盖的新服
    seen, servers = set(), []
    for s in list(base) + list(extra):
        if s in seen:
            continue
        seen.add(s)
        servers.append(s)
    extra_set = set(extra)
    if not servers:
        return {"success": False, "message": "无法获取区服列表"}

    # 读取已有数据，用于保留「手动更新」的区服金价
    old = load_data() or {}
    manual_map = {r.get("server"): r for r in old.get("servers", []) if r.get("manual")}
    cbg_ages = load_cbg_ages()          # name -> {date, age}
    overrides = load_open_dates()       # 手动覆盖 {name: date}
    idx_365 = load_365tools_index()     # 365tools 补充源索引(区服名->记录)

    records, fresh, stale, fail = [], 0, 0, 0
    kept_manual = 0
    enriched_count = 0
    planned = len(servers)
    for i, s in enumerate(servers, 1):
        if s in EXCLUDE_SERVERS:
            print(f"[gold] 跳过排除名单区服: {s}")
            continue
        rec = fetch_gold(s)
        rec, kept = apply_manual_guard(rec, manual_map)
        cbg_rec = cbg_ages.get(s)
        open_date = overrides.get(s) or (cbg_rec or {}).get("date", "")
        rec["openDate"] = open_date
        # 新服源站可能缺 area/openStatus，用 CBG 表补全
        if not rec.get("area") and cbg_rec:
            rec["area"] = cbg_rec.get("area", "")
        if not rec.get("openStatus") and cbg_rec:
            rec["openStatus"] = cbg_rec.get("openStatus", "")
        rec["ageBucket"] = classify_by_open_date(open_date) or fallback_bucket(rec)
        # 365tools 补充源：mhapi 断更/缺失时用其金价补全
        rec, enriched = enrich_from_365tools(rec, idx_365)
        if enriched:
            enriched_count += 1
        if kept:
            kept_manual += 1

        if rec.get("yxbPrice") is None:
            if s in extra_set:
                # 新服候选在源站查不到金价(尚未收录/合区)，跳过不写入
                print(f"[gold] 新服 {s} 源站无金价，跳过")
                continue
            fail += 1
        elif rec.get("stale"):
            stale += 1
        else:
            fresh += 1
        records.append(rec)
        if i % 30 == 0:
            print(f"[gold] 采集进度 {i}/{planned}")
        time.sleep(0.1)

    payload = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(records),
        "freshCount": fresh,
        "staleCount": stale,
        "failCount": fail,
        "manualCount": kept_manual,
        "supplementCount": enriched_count,
        "servers": records,
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[gold] 采集完成: 总{planned} 实时{fresh} 断更{stale} 失败{fail} 保留手动{kept_manual} 365补充{enriched_count}")
    return {"success": True, "total": len(records), "freshCount": fresh,
            "staleCount": stale, "failCount": fail, "manualCount": kept_manual,
            "supplementCount": enriched_count}


def load_data():
    """加载本地金价数据"""
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def load_open_dates():
    """加载手动开服日期覆盖表 {服务器名: "YYYY-MM-DD"}。"""
    if OPEN_DATE_FILE.exists():
        try:
            return json.loads(OPEN_DATE_FILE.read_text(encoding="utf-8")) or {}
        except Exception:
            pass
    return {}


def load_cbg_ages():
    """加载藏宝阁藏品模块的开服年份表，返回 name -> {date, age} 映射。"""
    for p in CBG_AGES_FILES:
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8")) or {}
                return {v.get("name"): v for v in data.values() if v.get("name")}
            except Exception:
                pass
    return {}


def load_extra_server_names():
    """返回藏宝阁开服表中 age∈{new, mid} 的新服/中服区名列表，作为金价跟踪的补充名单。"""
    extra = set()
    for p in CBG_AGES_FILES:
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8")) or {}
                for v in data.values():
                    if v.get("age") in ("new", "mid") and v.get("name"):
                        extra.add(v["name"])
            except Exception:
                pass
    return list(extra)


def classify_by_open_date(open_date):
    """按真实开服日期动态分档: 1y(1年内) / 1-3y(1-3年) / 3y+(3年外)，无日期返回空串。"""
    if not open_date:
        return ""
    try:
        d = datetime.strptime(open_date, "%Y-%m-%d").date()
    except Exception:
        return ""
    days = (date.today() - d).days
    if days <= 365:
        return "1y"
    if days <= 3 * 365:
        return "1-3y"
    return "3y+"


def fallback_bucket(rec):
    """CBG 表无该区时，退回 API 的 timeType 粗分档。"""
    tt = rec.get("timeType", "")
    if tt == "三年外":
        return "3y+"
    if tt == "三年内":
        return "1-3y"
    return ""


# ---------------------------------------------------------------- FastAPI
app = FastAPI(title="梦幻全服金价")


@app.get("/api/gold")
async def get_gold(sort: str = "price", order: str = "desc", q: str = ""):
    """获取全服最新金价。
    sort: price(金价) | date(日期) | server(名称)
    order: asc | desc
    q: 服务器名模糊搜索
    """
    data = load_data()
    if not data:
        return JSONResponse(
            {"success": False, "message": "暂无数据，请先触发刷新 /api/gold/refresh", "data": None},
            media_type="application/json; charset=utf-8",
        )

    servers = data.get("servers", [])
    if q:
        servers = [s for s in servers if q in s.get("server", "")]

    def sort_key(s):
        if sort == "date":
            return s.get("date", "") or ""
        if sort == "server":
            return s.get("server", "")
        # price: 金价降序时把 None 排最后
        p = s.get("yxbPrice")
        return p if p is not None else (float("-inf") if order == "desc" else float("inf"))

    try:
        servers = sorted(servers, key=sort_key, reverse=(order == "desc"))
    except Exception:
        pass

    out = dict(data)
    out["servers"] = servers
    out["success"] = True
    return JSONResponse(out, media_type="application/json; charset=utf-8")


@app.get("/api/gold/status")
async def gold_status():
    """返回当前刷新状态与数据概览"""
    data = load_data()
    return {
        "success": True,
        "refreshing": False,
        "updatedAt": data.get("updatedAt") if data else None,
        "total": data.get("total") if data else 0,
        "freshCount": data.get("freshCount") if data else 0,
        "staleCount": data.get("staleCount") if data else 0,
        "failCount": data.get("failCount") if data else 0,
        "manualCount": data.get("manualCount") if data else 0,
        "supplementCount": data.get("supplementCount") if data else 0,
    }


def _periodic_loop():
    """内置定时刷新：启动时若空则先采一次，之后每 REFRESH_INTERVAL 秒采一次。"""
    first = True
    while True:
        data = load_data()
        if first or not data:
            print("[gold] 定时线程: 首次/缺失数据，执行采集")
            sync_all()
            first = False
        time.sleep(REFRESH_INTERVAL)
        print("[gold] 定时线程: 周期采集")
        sync_all()


if __name__ == "__main__":
    import uvicorn

    # 启动定时刷新线程（守护）
    threading.Thread(target=_periodic_loop, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8010)
