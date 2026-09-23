#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mhxy-helper 本地访问统计服务（零依赖：仅 Python 标准库）。

功能：
  POST /api/analytics/track         接收前端埋点事件，写入 SQLite（analytics.db）
  GET  /api/analytics/stats?days=N  返回聚合统计 JSON（供看板调用）
  GET  /                          返回看板 HTML 页面（仅本机 127.0.0.1 可见）
  GET  /api/analytics/health       健康检查

绑定 127.0.0.1:8014：
  - 看板只在本地浏览器（http://127.0.0.1:8014）可见，不进网站、不暴露公网。
  - 公网收集：需 VPS Nginx 仅反代 /api/analytics/track（POST）经 frpc 到本机 8014，
    看板与 /api/stats 仍仅本机可达（见同目录 nginx_analytics.conf / frpc_analytics.ini）。
"""
import hashlib
import ipaddress
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "analytics.db")
HOST = "127.0.0.1"
PORT = 8014
MAX_BODY = 64 * 1024

# ---- 看板内嵌地图的腾讯地图 key ----
# 地图只渲染在本机看板（127.0.0.1:8014），不进网站；key 仅本机读取，不下发给公网。
# 申请：https://lbs.qq.com/dev/console/key/manage （个人免费，选「WebService/JavaScript GL」）
# 建议把 key 写进同目录 map_key.txt（一行，# 开头为注释），避免硬编码进代码。
MAP_KEY_FILE = os.path.join(BASE_DIR, "map_key.txt")


def _load_map_key():
    """读取地图 key：优先环境变量，其次 map_key.txt。"""
    key = (os.environ.get("MHXY_TMAP_KEY") or "").strip()
    if key:
        return key
    try:
        with open(MAP_KEY_FILE, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s and not s.startswith("#"):
                    return s
    except FileNotFoundError:
        pass
    return ""

# ---- IP 归属地解析（用途：看板展示「用户来自哪里」）----
# 合规：events 表【不保存任何原始 IP】，只落解析后的 国家/省/市/运营商。
# 缓存键用 IP 的加盐哈希（不可逆推），仅为避免同一 IP 重复调用外部接口。
GEO_ENABLED = True
GEO_API = "http://ip-api.com/json/{ip}?fields=status,country,regionName,city,isp,lat,lon&lang=zh-CN"
GEO_TIMEOUT = 3.0
GEO_TTL_OK = 30 * 24 * 3600  # 成功结果缓存 30 天
GEO_TTL_FAIL = 3600  # 失败结果缓存 1 小时，避免反复超时拖慢上报
GEO_RATE_LIMIT = 40  # ip-api.com 免费额度约 45 次/分钟，留些余量
SALT_PATH = os.path.join(BASE_DIR, ".geo_salt")
_geo_calls = []


def _load_salt():
    """首次运行生成随机盐并落盘(600)，保证哈希键在重启后仍稳定。"""
    try:
        with open(SALT_PATH, "r") as f:
            s = f.read().strip()
            if s:
                return s
    except OSError:
        pass
    s = os.urandom(16).hex()
    try:
        with open(SALT_PATH, "w") as f:
            f.write(s)
        os.chmod(SALT_PATH, 0o600)
    except OSError:
        pass
    return s


GEO_SALT = _load_salt()

# ip-api.com 只把 国家/省/市 做了中文本地化，ISP 恒为英文，这里归一化为中文简称
ISP_MAP = [
    ("china mobile", "中国移动"),
    ("chinamobile", "中国移动"),
    ("china telecom", "中国电信"),
    ("chinanet", "中国电信"),
    ("china unicom", "中国联通"),
    ("china169", "中国联通"),
    ("cernet", "中国教育网"),
    ("education and research", "中国教育网"),
    ("alibaba", "阿里云"),
    ("aliyun", "阿里云"),
    ("tencent", "腾讯云"),
    ("huawei", "华为云"),
    ("baidu", "百度云"),
    ("amazon", "亚马逊AWS"),
    ("microsoft", "微软Azure"),
]


def normalize_isp(isp):
    s = (isp or "").strip()
    if not s:
        return ""
    low = s.lower()
    for key, name in ISP_MAP:
        if key in low:
            return name
    return s


# ip-api.com 免费版对部分城市仍返回拼音/英文（如 Wenquan），归一化为中文真实市名
CITY_NAME_MAP = {
    "wenquan": "福州",
    "福州市": "福州",
    "济南市": "济南",
    "宁波市": "宁波",
    "南京市": "南京",
    "杭州市": "杭州",
    "wenzhou": "温州",
    "xiamen": "厦门",
    "shenzhen": "深圳",
    "guangzhou": "广州",
    "zhangzhou": "漳州",
    "putian": "莆田",
    "quanzhou": "泉州",
    "fuzhou": "福州",
}


def normalize_city(city):
    c = (city or "").strip()
    if not c:
        return ""
    return CITY_NAME_MAP.get(c.lower(), c)


# 境外云厂商 / 数据中心 ISP（爬虫、探测流量的服务器出口，非真实用户）。
# 命中且归属地非中国时，过滤掉其地理信息，使其不污染地图与地域排行（点击量仍计入模块排行）。
FOREIGN_DC_ISP = [
    "google", "amazon", "microsoft", "azure", "digitalocean", "linode",
    "hetzner", "ovh", "vultr", "oracle", "cloudflare", "fastly",
    "akamai", "datacenter", "data center", "hosting", "leaseweb",
    "contabo", "ramnode", "buyvm", "server",
]


def is_foreign_datacenter(isp, country):
    if not isp or country == "中国":
        return False
    low = isp.lower()
    return any(k in low for k in FOREIGN_DC_ISP)


# 路由名 -> 站点真实模块名（看板展示用）。
# 真实名取自站点首页 frontend/public/mhxy/static/index.html 的 nav-card 标题，
# 以及各 View 自带的 <h1>/<h2>（如 BaotuView 的「宝图监控」、CbgView 的「藏宝阁」）。
# 不要自行翻译，对齐站点上用户看到的名字。
MODULE_LABELS = {
    "home": "首页",
    "ghost": "抓鬼狂魔",
    "baotu": "宝图监控",
    "fentu": "分图助手",
    "watu": "挖图助手",
    "jiankong": "通用监控",
    "jiankong4": "自动战斗监控",
    "cixin": "慈心下棋",
    "fishing": "金牌钓手",
    "cbg": "藏宝阁",
    "cbg-library": "藏宝阁藏品库",
    "gold": "全服金价",
    "assets": "资产登记",
    "tiandikang": "天地砍王",
    "calc": "数值计算器",
    "calc-detail": "数值计算器·详情",
    "calc-data": "数值计算器·录入",
    "harvest": "收货采集",
    "chess": "定旗狂魔",
    "scammer": "骗子名单",
    "dati": "答题助手",
    "muyu": "敲木鱼",
    "paoshang": "跑商助手",
    "admin-wechat": "微信推送接收人管理",
}

# 兜底：路由无 name / 无效路径时上报的占位值，统一显示中文，不再出现英文
MODULE_FALLBACK_LABELS = {
    "unknown": "其他（未识别路径）",
    "undefined": "其他（未识别路径）",
}


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            day TEXT NOT NULL,
            module TEXT NOT NULL,
            path TEXT,
            event_type TEXT DEFAULT 'page_view',
            visitor_id TEXT,
            session_id TEXT,
            referer TEXT,
            ua TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_module ON events(module)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id)")
    # 地理 + 计数字段（老库平滑升级：缺列则 ADD COLUMN，已有数据自动取默认值）
    cols = [r[1] for r in conn.execute("PRAGMA table_info(events)")]
    for col, decl in (
        ("country", "TEXT DEFAULT ''"),
        ("region", "TEXT DEFAULT ''"),
        ("city", "TEXT DEFAULT ''"),
        ("isp", "TEXT DEFAULT ''"),
        ("lat", "REAL DEFAULT 0"),
        ("lon", "REAL DEFAULT 0"),
        ("count", "INTEGER DEFAULT 1"),  # 批量上报：一次事件可代表 N 次（如敲木鱼连点）
    ):
        if col not in cols:
            conn.execute("ALTER TABLE events ADD COLUMN %s %s" % (col, decl))
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_region ON events(region)")
    # IP 归属地缓存：键为 IP 的加盐哈希，不存原始 IP
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ip_geo (
            ip_hash TEXT PRIMARY KEY,
            country TEXT,
            region TEXT,
            city TEXT,
            isp TEXT,
            lat REAL DEFAULT 0,
            lon REAL DEFAULT 0,
            ok INTEGER DEFAULT 0,
            updated INTEGER
        )
        """
    )
    gcols = [r[1] for r in conn.execute("PRAGMA table_info(ip_geo)")]
    for col, decl in (("lat", "REAL DEFAULT 0"), ("lon", "REAL DEFAULT 0")):
        if col not in gcols:
            conn.execute("ALTER TABLE ip_geo ADD COLUMN %s %s" % (col, decl))
    conn.commit()
    conn.close()


def day_str(ts_ms):
    return datetime.utcfromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d")


def ip_hash(ip):
    """缓存键：IP 的加盐哈希，不可逆推出原始 IP。"""
    return hashlib.sha256((GEO_SALT + str(ip)).encode("utf-8")).hexdigest()[:32]


def classify_local(ip):
    """内网/本机 IP 不打外部接口，直接归类。返回 None 表示是公网 IP。"""
    if not ip:
        return ("", "未知", "未知", "未知", 0.0, 0.0)
    if ip in ("127.0.0.1", "::1", "localhost"):
        return ("", "本机", "本机", "内网", 0.0, 0.0)
    try:
        if ipaddress.ip_address(ip).is_private:
            return ("", "局域网", "局域网", "内网", 0.0, 0.0)
    except ValueError:
        return ("", "未知", "未知", "未知", 0.0, 0.0)
    return None


def _rate_ok():
    now = time.time()
    while _geo_calls and now - _geo_calls[0] > 60:
        _geo_calls.pop(0)
    return len(_geo_calls) < GEO_RATE_LIMIT


def resolve_geo(ip):
    """返回 (country, region, city, isp)。

    - 内网/本机直接归类，不查外部接口；
    - 公网 IP 先查本地缓存（键=加盐哈希），未命中才调 ip-api.com，并回写缓存；
    - 失败按 1 小时负缓存，限流或异常一律降级为「未知」，绝不影响埋点入库。
    """
    local = classify_local(ip)
    if local is not None:
        return (local[0], local[1], normalize_city(local[2]), local[3], local[4], local[5])
    key = ip_hash(ip)
    now = int(time.time())
    conn = get_conn()
    row = conn.execute(
        "SELECT country, region, city, isp, lat, lon, ok, updated FROM ip_geo WHERE ip_hash=?",
        (key,),
    ).fetchone()
    conn.close()
    if row:
        country, region, city, isp, lat, lon, ok, updated = row
        ttl = GEO_TTL_OK if ok else GEO_TTL_FAIL
        if now - (updated or 0) < ttl:
            if ok:
                return (country, region, normalize_city(city), isp, lat or 0.0, lon or 0.0)
            return ("", "未知", "未知", "未知", 0.0, 0.0)
    if not GEO_ENABLED or not _rate_ok():
        return ("", "未知", "未知", "未知", 0.0, 0.0)
    country = region = city = isp = ""
    lat = lon = 0.0
    ok = 0
    try:
        req = urllib.request.Request(
            GEO_API.format(ip=ip), headers={"User-Agent": "mhxy-analytics/1.0"}
        )
        with urllib.request.urlopen(req, timeout=GEO_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") == "success":
            country = (data.get("country") or "")[:64]
            region = (data.get("regionName") or "")[:64]
            city = normalize_city(data.get("city"))[:64]
            isp = normalize_isp(data.get("isp"))[:128]
            # 城市中心点（ip-api 为 WGS84），仅用于地图打点，非个人精确定位
            try:
                lat = float(data.get("lat") or 0)
                lon = float(data.get("lon") or 0)
            except (TypeError, ValueError):
                lat = lon = 0.0
            ok = 1
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("geo lookup failed (hash=%s): %s\n" % (key, e))
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO ip_geo (ip_hash, country, region, city, isp, lat, lon, ok, updated) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (key, country, region, city, isp, lat, lon, ok, now),
    )
    conn.commit()
    conn.close()
    if ok:
        _geo_calls.append(time.time())
        return (country, region, city, isp, lat, lon)
    return ("", "未知", "未知", "未知", 0.0, 0.0)


def insert_event(payload, ip=None):
    try:
        # 防护：丢弃无访客 ID 的脏数据（真实前端必带匿名 vid；空 vid 多为测试/异常请求）
        vid_raw = payload.get("vid")
        if not vid_raw or not str(vid_raw).strip():
            return False
        module = str(payload.get("module") or "").strip() or "unknown"
        ts = int(payload.get("ts") or 0)
        if ts <= 0:
            ts = int(datetime.now().timestamp() * 1000)
        day = day_str(ts)
        # 归属地：只存 国家/省/市/运营商 + 城市中心点坐标，原始 IP 不落库
        country, region, city, isp, lat, lon = resolve_geo(ip)
        # 境外云厂商/数据中心流量（爬虫/探测）过滤地理信息，不污染地图与地域排行（点击仍计入模块）
        if is_foreign_datacenter(isp, country):
            country = region = city = isp = ""
            lat = lon = 0.0
        # 批量计数：一次事件可代表 N 次（敲木鱼连点等场景），限幅防滥用
        try:
            cnt = int(payload.get("count") or 1)
        except (TypeError, ValueError):
            cnt = 1
        cnt = max(1, min(1000, cnt))
        conn = get_conn()
        conn.execute(
            "INSERT INTO events (ts, day, module, path, event_type, visitor_id, session_id, referer, ua, "
            "country, region, city, isp, lat, lon, count) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ts,
                day,
                module,
                str(payload.get("path") or "")[:256],
                str(payload.get("type") or "page_view")[:32],
                str(payload.get("vid") or "")[:64],
                str(payload.get("sid") or "")[:64],
                str(payload.get("referer") or "")[:512],
                str(payload.get("ua") or "")[:512],
                country,
                region,
                city,
                isp,
                lat,
                lon,
                cnt,
            ),
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("insert_event error: %s\n" % e)
        return False


def build_stats(days):
    days = max(1, min(365, int(days)))
    today = datetime.utcnow().date()
    day_list = [
        (today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)
    ]
    start = day_list[0]
    end = day_list[-1]

    conn = get_conn()
    # 点击量 pivot：module -> day -> count
    clicks = {}
    module_totals = {}
    for module, day, cnt in conn.execute(
        "SELECT module, day, SUM(count) FROM events WHERE day BETWEEN ? AND ? GROUP BY module, day",
        (start, end),
    ):
        clicks.setdefault(module, {})[day] = cnt
        module_totals[module] = module_totals.get(module, 0) + cnt
    # 每日独立访客
    dau = {}
    for day, cnt in conn.execute(
        "SELECT day, COUNT(DISTINCT visitor_id) FROM events WHERE day BETWEEN ? AND ? GROUP BY day",
        (start, end),
    ):
        dau[day] = cnt
    # 区间独立访客总数 / 总点击
    all_users = (
        conn.execute(
            "SELECT COUNT(DISTINCT visitor_id) FROM events WHERE day BETWEEN ? AND ?",
            (start, end),
        ).fetchone()[0]
        or 0
    )
    all_clicks = (
        conn.execute(
            "SELECT SUM(count) FROM events WHERE day BETWEEN ? AND ?", (start, end)
        ).fetchone()[0]
        or 0
    )
    # 地域分布：省份 / 城市 / 运营商（点击量=SUM(count) + 独立用户数，空值不计）
    # col / limit 均为本函数内固定字面量，非外部输入
    def _top(col, limit=15, with_geo=False):
        if with_geo:
            # t = 当日点击（口径与顶部"今日"卡片一致，用 day_list[-1]），供地图打点只展示当天
            rows = conn.execute(
                "SELECT %s AS name, SUM(count) c, COUNT(DISTINCT visitor_id) u, MAX(lat) la, MAX(lon) lo, "
                "SUM(CASE WHEN day=? THEN count ELSE 0 END) t "
                "FROM events WHERE day BETWEEN ? AND ? AND %s <> '' AND lat <> 0 AND lon <> 0 GROUP BY %s ORDER BY c DESC LIMIT %d"
                % (col, col, col, limit),
                (day_list[-1], start, end),
            ).fetchall()
            return [
                {
                    "name": r[0],
                    "clicks": r[1],
                    "users": r[2],
                    "lat": r[3] or 0.0,
                    "lon": r[4] or 0.0,
                    "today": r[5] or 0,
                }
                for r in rows
            ]
        rows = conn.execute(
            "SELECT %s AS name, SUM(count) c, COUNT(DISTINCT visitor_id) u FROM events "
            "WHERE day BETWEEN ? AND ? AND %s <> '' GROUP BY %s ORDER BY c DESC LIMIT %d"
            % (col, col, col, limit),
            (start, end),
        ).fetchall()
        return [{"name": r[0], "clicks": r[1], "users": r[2]} for r in rows]

    geo = {
        "regions": _top("region"),
        "cities": _top("city", limit=200, with_geo=True),  # 城市多取一些供地图打点
        "isps": _top("isp"),
    }

    # ---- 功德榜（敲木鱼：event_type='merit'，一次事件可代表 N 次）----
    def _merit(day=None):
        if day:
            row = conn.execute(
                "SELECT SUM(count) FROM events WHERE day=? AND event_type='merit'", (day,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT SUM(count) FROM events WHERE day BETWEEN ? AND ? AND event_type='merit'",
                (start, end),
            ).fetchone()
        return row[0] or 0

    merit_total = _merit()
    merit_today = _merit(day_list[-1])
    merit_users = (
        conn.execute(
            "SELECT COUNT(DISTINCT visitor_id) FROM events WHERE day BETWEEN ? AND ? "
            "AND event_type='merit'",
            (start, end),
        ).fetchone()[0]
        or 0
    )
    merit_cities = [
        {"name": r[0], "merit": r[1], "users": r[2]}
        for r in conn.execute(
            "SELECT city, SUM(count) m, COUNT(DISTINCT visitor_id) u FROM events "
            "WHERE day BETWEEN ? AND ? AND event_type='merit' AND city<>'' "
            "GROUP BY city ORDER BY m DESC LIMIT 10",
            (start, end),
        ).fetchall()
    ]
    conn.close()

    # 补全 pivot 中缺失的 day 为 0
    for m in clicks:
        for d in day_list:
            clicks[m].setdefault(d, 0)

    ranking = sorted(module_totals.items(), key=lambda kv: kv[1], reverse=True)

    return {
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
        "days": day_list,
        "moduleLabels": MODULE_LABELS,
        "clicks": clicks,  # module -> {day: count}
        "dau": {d: dau.get(d, 0) for d in day_list},
        "ranking": [
            {
                "module": m,
                "label": MODULE_LABELS.get(m) or MODULE_FALLBACK_LABELS.get(m, m),
                "total": t,
                "today": clicks.get(m, {}).get(day_list[-1], 0),
            }
            for m, t in ranking
        ],
        "totals": {
            "allClicks": all_clicks,
            "allUsers": all_users,
            "todayClicks": sum(clicks.get(m, {}).get(day_list[-1], 0) for m in clicks),
            "todayUsers": dau.get(day_list[-1], 0),
            "days": days,
        },
        "geo": geo,
        "merit": {
            "total": merit_total,
            "today": merit_today,
            "users": merit_users,
            "cities": merit_cities,
        },
    }


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html, code=200):
        body = html.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def client_ip(self):
        """取真实客户端 IP。

        经 frp tcp 隧道时 socket 层源 IP 必为 127.0.0.1（frpc 本机回连），
        真实 IP 只能靠 VPS Nginx 透传的 X-Real-IP / X-Forwarded-For 请求头拿。
        """
        xrip = self.headers.get("X-Real-IP")
        if xrip and xrip.strip():
            return xrip.strip()
        xff = self.headers.get("X-Forwarded-For")
        if xff and xff.strip():
            return xff.split(",")[0].strip()
        return (self.client_address[0] if self.client_address else "") or ""

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        if path in ("/", "/dashboard", "/index.html"):
            try:
                with open(
                    os.path.join(BASE_DIR, "dashboard.html"), "r", encoding="utf-8"
                ) as f:
                    self._send_html(f.read())
            except FileNotFoundError:
                self._send_html("<h1>dashboard.html not found</h1>", 404)
        elif path.startswith("/assets/"):
            # 静态底图等资源：仅限 assets 目录，防路径穿越
            fname = os.path.basename(path[len("/assets/"):])
            fpath = os.path.join(BASE_DIR, "assets", fname)
            if os.path.isfile(fpath):
                ctype = "image/jpeg" if fname.lower().endswith((".jpg", ".jpeg")) else (
                    "image/png" if fname.lower().endswith(".png") else "application/octet-stream"
                )
                try:
                    with open(fpath, "rb") as f:
                        self.send_response(200)
                        self.send_header("Content-Type", ctype)
                        self.send_header("Content-Length", str(os.path.getsize(fpath)))
                        self.send_header("Cache-Control", "max-age=86400")
                        self.end_headers()
                        self.wfile.write(f.read())
                except OSError:
                    self._send_json({"error": "read failed"}, 500)
            else:
                self._send_json({"error": "not found"}, 404)
        elif path == "/api/analytics/health":
            self._send_json({"ok": True, "service": "mhxy-analytics"})
        elif path == "/api/analytics/config":
            # 看板启动配置（仅本机可见）：地图 key 等
            self._send_json({"mapKey": _load_map_key(), "geoEnabled": GEO_ENABLED})
        elif path == "/api/analytics/stats":
            try:
                days = int(qs.get("days", ["14"])[0])
            except (TypeError, ValueError):
                days = 14
            self._send_json(build_stats(days))
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/analytics/track":
            self._send_json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._send_json({"ok": False, "error": "bad body"}, 400)
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            self._send_json({"ok": False, "error": "bad json"}, 400)
            return
        ok = insert_event(payload, self.client_ip())
        self._send_json({"ok": ok})

    def log_message(self, fmt, *args):
        sys.stderr.write("[analytics] " + (fmt % args) + "\n")


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write("mhxy-analytics listening on http://%s:%d\n" % (HOST, PORT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
