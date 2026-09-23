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
import re as _re
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


MHXY_TAX = load_taxonomy()          # mhxyai 类目表，仅作归一兜底

# ===== 物品规范（物价宝鉴迁入本模块的本地副本）=====
# 数据来源：backend/data/wuji_catalog.json（从 wuji/price_spider.py 的 ICON_MAPPING
# + wuji/static/icons 抽取而来，物品名 → {icon, category}），不再依赖 wuji/ 源码。
# 效果：识别到「否定信仰」自动归到「低级兽决」，与物价宝鉴规范一致。
# 补充表：backend/data/wuji_extra.json（可直接编辑，无需改代码）。
# 分类展示顺序
# 「钟灵石」= 官方「精魄灵石」（镶嵌召唤兽装备、可合成到 10 级），与人物装备用的
# 「宝石」是两套东西，价格也完全不是一个量级，必须独立成类，不能并进宝石。
WUJI_CAT_ORDER = ["五宝", "宝石", "珍珠", "钟灵石", "低级兽决", "高级兽决", "低级内丹",
                  "变身卡片", "如意丹", "人物灵饰", "装备", "道具", "高价值", "其他"]


_CATALOG_FILE = os.path.join(os.path.dirname(__file__), "data", "wuji_catalog.json")
_EXTRA_FILE = os.path.join(os.path.dirname(__file__), "data", "wuji_extra.json")


def load_wuji_catalog() -> dict:
    """载入物品规范：{物品名: {'icon': '低级兽决/兽决.png', 'category': '低级兽决'}}。

    优先读本地副本 wuji_catalog.json（从物价宝鉴迁入，已含图标相对路径与分类），
    再合并 wuji_extra.json 用户补充表。wuji 模块移除后，本模块完全自包含。
    """
    catalog: dict = {}
    try:
        with open(_CATALOG_FILE, "r", encoding="utf-8") as f:
            catalog = json.load(f)
    except Exception as e:
        print(f"[catalog] 读取 wuji_catalog.json 失败: {e}")
        catalog = {}
    # 补充表：物价宝鉴没覆盖的物品（如部分兽决名）
    try:
        with open(_EXTRA_FILE, "r", encoding="utf-8") as f:
            for k, v in json.load(f).items():
                if k.startswith("_"):
                    continue
                if isinstance(v, dict) and v.get("category"):
                    catalog[k] = {"icon": v.get("icon", ""), "category": v["category"]}
    except (FileNotFoundError, json.JSONDecodeError, AttributeError):
        pass
    return catalog


WUJI_ITEMS = load_wuji_catalog()


def build_wuji_taxonomy(catalog: dict) -> dict:
    """按物价宝鉴规范生成两级树：顶级 = 图标分类，叶子 = 该分类下的物品名。"""
    groups: dict = {}
    for name, info in catalog.items():
        if info.get("alias_of"):
            continue        # 别名条目只用于归一匹配，不占下拉选项
        if info.get("no_match"):
            continue        # 禁用匹配条目（单字简写等）：不占下拉、也不参与归一
        groups.setdefault(info["category"], []).append(name)
    if not groups:
        return {"tree": [], "top_names": set(), "leaf_parent": {}}
    cats = [c for c in WUJI_CAT_ORDER if c in groups] + \
           [c for c in sorted(groups) if c not in WUJI_CAT_ORDER]
    tree, top_names, leaf_parent = [], set(), {}
    for i, cat in enumerate(cats):
        top_names.add(cat)
        kids = sorted(groups[cat], key=lambda x: (-len(x), x))
        children = []
        for j, nm in enumerate(kids):
            leaf_parent[nm] = cat
            children.append({"id": (i + 1) * 1000 + j, "name": nm, "displayName": nm})
        tree.append({"id": i + 1, "name": cat, "displayName": cat, "children": children})
    return {"tree": tree, "top_names": top_names, "leaf_parent": leaf_parent}


# 主分类树 = 物价宝鉴规范；若 wuji 不可用则退回 mhxyai 类目表
TAX = build_wuji_taxonomy(WUJI_ITEMS)
if not TAX["tree"]:
    TAX = MHXY_TAX

# ===== OCR 名 → 规范物品归一 =====
# 优先按物价宝鉴物品名归一（带图标 + 分类），未命中再退回 mhxyai 类目表。
# 识别流程：精确 → 包含（规范名是 OCR 名的子串且长度差≤2）→ 模糊（difflib 比率≥0.6）。
import difflib as _difflib

def _norm(s):
    """匹配用归一：小写、去空白。中文为主，空白多为 OCR 误插。"""
    return _re.sub(r'\s+', '', (s or '').lower())


def build_alias_map(catalog: dict) -> dict:
    """{归一别名: 规范名} —— 命中后直接归到规范名入库。

    用途：同价位的一类物品没必要逐个登记，如 80 级武器 20 个具体名
    （黑炎魔刀/碧玉剑/…）价格一致，统一归一为「80武器」入库，避免主表被
    样式差异拆成几十条。带 alias_of 的条目不出现在分类下拉里。
    """
    out = {}
    for k, v in catalog.items():
        if not (isinstance(v, dict) and v.get("alias_of")):
            continue
        if v.get("no_match"):
            continue        # 禁用匹配条目不进别名表
        nk = _norm(k)
        if nk:
            out[nk] = v["alias_of"]
    return out


ALIAS_NORM = build_alias_map(WUJI_ITEMS)

# 禁用匹配的条目（如「剑/伞/刀」这类单字简写）：连 mhxyai 兜底表也不许命中。
# 原因：OCR 会把「碧玉剑」截成「剑」，命中后入库成「剑 + 指南书图标」，物品名错。
NO_MATCH_NORM = {_norm(k) for k, v in WUJI_ITEMS.items()
                 if isinstance(v, dict) and v.get("no_match")}


def _build_catalog(tax):
    pairs = []          # (规范名, 顶级名, 是否顶级)
    for top in tax['tree']:
        tname = top['name']
        pairs.append((tname, tname, True))
        for lf in top.get('children', []):
            pairs.append((lf['name'], tname, False))
    norm_list = []
    norm_meta = {}
    for name, parent, is_top in pairs:
        nk = _norm(name)
        if not nk:
            continue
        norm_list.append(nk)
        if nk not in norm_meta:        # 叶子优先于同名顶级
            norm_meta[nk] = {'name': name, 'parent': parent, 'is_top': is_top}
    return norm_list, norm_meta


CAT_NORM, CAT_META = _build_catalog(TAX)
MHXY_NORM, MHXY_META = _build_catalog(MHXY_TAX)


_LEVEL_PREFIX = ('高级', '低级', '初级', '超级', '进阶', '垃圾')


def _lvl(s: str) -> str:
    """取等级前缀（高级/低级/…）。高级必杀 与 必杀 是不同物品，不能互相匹配。"""
    for p in _LEVEL_PREFIX:
        if s.startswith(p):
            return p
    return ''


def _match_catalog(rc, norm_list, meta):
    """三级匹配：精确 → 包含 → 模糊。命中返回 (规范名, 顶级名, 方式, 分数)，否则 None。

    包含/模糊两级都要求**等级前缀一致**，避免「高级必杀」被错配成「必杀」。
    """
    if rc in meta:
        m = meta[rc]
        return m['name'], m['parent'], 'exact', 1.0
    rl = _lvl(rc)
    best = None                              # 包含（规范名是 OCR 名子串，多出的字符≤2）
    for nk, m in meta.items():
        if nk and nk in rc and (len(rc) - len(nk)) <= 2 and _lvl(nk) == rl:
            if best is None or len(nk) > best[0]:
                best = (len(nk), nk, m)
    if best:
        _, nk, m = best
        return m['name'], m['parent'], 'contains', round(len(nk) / len(rc), 3)
    for cand in _difflib.get_close_matches(rc, norm_list, n=8, cutoff=0.6):
        if _lvl(cand) != rl:
            continue
        m = meta[cand]
        ratio = _difflib.SequenceMatcher(None, rc, cand).ratio()
        return m['name'], m['parent'], 'fuzzy', round(ratio, 3)
    return None


def _icon_of(name: str) -> str:
    """物价宝鉴物品名 → 图标相对路径（如 低级兽决/兽决.png）。"""
    return (WUJI_ITEMS.get(name) or {}).get('icon', '')


def _zhonglingshi_level(rc: str):
    """「N级+钟灵石特效」→ 保留等级入库（如 5级破血狂攻）。

    钟灵石（精魄灵石）可合成到 10 级，**等级决定价格**：实测同一摊位 1级破血狂攻 2万、
    5级破血狂攻 318万，差 150 倍。若按特效名归一，1 级和 5 级会混成一条，均价毫无意义。
    所以命中钟灵石类特效时把等级拼回物品名（顶级分类仍归「钟灵石」）。
    仅对钟灵石生效 —— 别处「105级炼妖石」的等级是物品名固有部分，不能这么拆。
    """
    m = _re.match(r'^(\d{1,2})级(.+)$', rc)
    if not m:
        return None
    lv, inner = m.group(1), m.group(2)
    if not (1 <= int(lv) <= 10):
        return None
    hit = _match_catalog(inner, CAT_NORM, CAT_META)
    if not hit:
        return None
    name, parent, method, score = hit
    if parent != '钟灵石':
        return None
    full = f'{lv}级{name}'
    return {'item_name': full, 'category': full, 'parent': '钟灵石',
            'icon': _icon_of(name), 'matched': True,
            'match_method': 'zs-level', 'match_score': score}


def normalize_item_name(raw):
    """把 OCR 出的物品名归一为规范物品（优先物价宝鉴，退回 mhxyai 类目表）。

    返回 {item_name, category, parent, icon, matched, match_method, match_score}。
    - 命中物价宝鉴：item_name=规范物品名、category=物价宝鉴分类（如 低级兽决）、
      icon=图标相对路径（如 低级兽决/兽决.png），可直接入库并显示图标；
    - 命中 mhxyai：用其类目树，无图标；
    - 都没命中：回退 raw，前端用「默认分类」兜底或手选。
    """
    rc = _norm(raw)
    if not rc:
        return {'item_name': raw, 'category': '', 'parent': '', 'icon': '',
                'matched': False, 'match_method': 'none', 'match_score': 0.0}
    if rc in NO_MATCH_NORM:                                 # 0. 禁用匹配条目直接判未匹配
        return {'item_name': raw, 'category': '', 'parent': '', 'icon': '',
                'matched': False, 'match_method': 'blocked', 'match_score': 0.0}
    zs = _zhonglingshi_level(rc)                            # 0.5 「N级+特效」保留等级
    if zs:
        return zs
    tgt = ALIAS_NORM.get(rc)                                # 1. 别名 → 等级/品类统称
    if tgt:
        return {'item_name': tgt, 'category': tgt,
                'parent': (WUJI_ITEMS.get(tgt) or {}).get('category', ''),
                'icon': _icon_of(tgt), 'matched': True,
                'match_method': 'alias', 'match_score': 1.0, 'alias_from': raw}
    hit = _match_catalog(rc, CAT_NORM, CAT_META)            # 1. 物价宝鉴规范优先
    if hit:
        name, parent, method, score = hit
        return {'item_name': name, 'category': name, 'parent': parent,
                'icon': _icon_of(name), 'matched': True,
                'match_method': 'wuji-' + method, 'match_score': score}
    hit = _match_catalog(rc, MHXY_NORM, MHXY_META)          # 2. 退回 mhxyai 类目表
    if hit:
        name, parent, method, score = hit
        return {'item_name': name, 'category': name, 'parent': parent,
                'icon': _icon_of(name), 'matched': True,
                'match_method': 'mhxy-' + method, 'match_score': score}
    return {'item_name': raw, 'category': '', 'parent': '', 'icon': '',   # 3. 未匹配
            'matched': False, 'match_method': 'none', 'match_score': 0.0}


# ===== 解析增强：UI 文案过滤 + 网格列对齐配对 + 黏连物品名切分 =====
# 摊位 UI 上的固定文案（表头/页脚/标签），不是物品名。
_UI_NOISE = {
    '单价', '名称', '等级', '数量', '总量', '总数量', '价格', '收购', '出售',
    '收购价', '出售价', '物品', '类型', '时间', '日期', '备注', '说明',
    '总价', '现金', '摊主', '购买', '更多', '关注', '摆摊', '确定', '取消',
    '切换模式', '观看图鉴', '物品类', '召唤兽类', '制造类', '藏宝阁类',
    'id', '编号', '合计', '服务器', '区服',
}
_UI_NOISE_NORM = {_norm(x) for x in _UI_NOISE}
# 「单价」出现在每个物品格里，不能用来判定页脚带
_FOOTER_IGNORE_NORM = {_norm(x) for x in ('单价',)}


# 强特征词：整块文字**只要含有**就判为界面文案，不管去掉后还剩什么。
# 例：收购摊标题栏「摊主的收购项目」去掉「摊主/收购」后还剩「的项目」，
#     靠原有的"去空判断"会漏掉，被当成物品名入库 —— 必须整块丢弃。
_STRONG_NOISE = (
    '摊主', '摊位', '收购', '出售', '购买', '卖出', '单价', '总价', '现金',
    '藏宝阁类', '物品类', '召唤兽类', '制造类', '切换模式', '观看图鉴', '合计',
)


def _is_ui_noise(t: str) -> bool:
    """整块文字去掉所有 UI 文案词（允许重复）后为空 → 是界面文案，不是物品名。"""
    s = _norm(t)
    if not s or s in _UI_NOISE_NORM:
        return True
    if _re.fullmatch(r'\d+\s*[级阶]', s):     # 图标角上的等级徽章，如「105级」，不是物品
        return True
    for kw in _STRONG_NOISE:                 # 含强特征词 → 界面文案，直接丢弃
        if kw in s:
            return True
    rest = s
    for nk in _UI_NOISE_NORM:
        if nk:
            rest = rest.replace(nk, '')
    return rest == ''


def _detect_footer_band(blocks: list):
    """检测底部控制栏（数量/物品类/召唤兽类/摊主/总价/现金/购买… 那一排）。

    UI 文案块在底部聚集时返回该带起始 y；低于它的文字块全部忽略，避免把
    「摊主/摊主名/ID/31062504」这类页脚文字当成物品配价。
    仅用非「单价」的 UI 词判断（单价在物品格里出现，不能当页脚特征）。
    """
    ys = [b.get('y', 0) for b in blocks]
    if not ys:
        return None
    ymin, ymax = min(ys), max(ys)
    span = ymax - ymin
    if span <= 0:
        return None
    noise_ys = sorted(
        b.get('y', 0) for b in blocks
        if _is_ui_noise(b.get('text') or '')
        and _norm(b.get('text') or '') not in _FOOTER_IGNORE_NORM
        # 「1级 / 2级」是每格自带的等级徽章，贯穿全行，不能当页脚特征，
        # 否则长摊位（多行）底部那几枚徽章会触发误判、把下半截物品整片删掉。
        and not _re.fullmatch(r'\d+\s*[级阶]', _norm(b.get('text') or ''))
    )
    if len(noise_ys) < 3:
        return None
    tail = [y for y in noise_ys if y >= ymin + 0.7 * span]
    if len(tail) < 3:
        return None
    return min(tail)


def _cluster_1d(vals, tol):
    """一维聚类，返回各簇中心（升序）。"""
    out: list = []
    for v in sorted(vals):
        if out and abs(v - out[-1][-1]) <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return 0.0
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _estimate_pair_window(names: list, prices: list = None):
    """由版面估计「物品名→价格」的配对窗口：行距推纵向上限，列距推横向上限。

    网格摊位里，一个格子的「名称」在上、「单价+数字」在下，下一格又在其下。
    纵向上限取行距的 0.7 倍，确保只吃到本格下方的价格、不吃到下一格的。
    """
    rows = _cluster_1d([n['y'] for n in names], 12.0)
    if len(rows) >= 2:
        pitch = _median([rows[i + 1] - rows[i] for i in range(len(rows) - 1)])
    else:
        pitch = 0.0
    max_dy = 0.7 * pitch if pitch > 0 else 60.0

    cols = _cluster_1d([n['x'] for n in names], 60.0) if names else []
    if len(cols) >= 2:
        colp = _median([cols[i + 1] - cols[i] for i in range(len(cols) - 1)])
    else:
        colp = 0.0
    max_dx = 0.55 * colp if colp > 0 else 90.0

    # 用价格的实际位置校准纵向上限。
    # 坑：标题/页脚行（如「内丹内丹●清」）会与名称行一起被当成"相邻两行"，
    # pitch 被算小 → max_dy 反而小于真实的「名称→单价」间距，导致一条都配不上。
    # 这里取「每个名称到其同列、正下方最近价格」的 dy 中位数，留 30% 余量兜底。
    if prices:
        cand = []
        for n in names:
            near = [pr['y'] - n['y'] for pr in prices
                    if pr['y'] > n['y'] and abs(pr['x'] - n['x']) <= max_dx]
            if near:
                cand.append(min(near))
        if cand:
            max_dy = max(max_dy, _median(cand) * 1.3)
    max_dy = min(max_dy, 240.0)      # 兜底上限，避免异常版面吃到远处的页脚数字
    return max_dy, max_dx


def _last_inline_price(text: str):
    """在「名称+价格」合并块里找价格：取最后一个**后面不跟「级/阶」**的数字。

    避开等级徽章——「105级炼妖石」里的 105 是等级，不是价格，否则会被抠成
    物品名「级炼妖石」+ 价格 105。
    """
    best = None
    for m in _re.finditer(r'(\d+(?:\.\d+)?)\s*([万wW]?)', text):
        if text[m.end():m.end() + 1] in ('级', '阶'):
            continue
        best = m
    return best


def detect_stall_region(blocks: list):
    """用「单价」文字块自动定位摊位格子区域，返回 (x0, y0, x1, y1)；定位不到返回 None。

    摊位每个物品格里都有「单价」二字，且排成规则网格。找齐这些块即可反推区域：
    - 横向：单价块跨度左右各扩约 0.9 列（把图标、物品名圈进来）
    - 纵向：最上一行单价往上扩 1 个行距（含物品名行），最下一行往下扩 0.5 行距
    这样即使截整窗（带聊天/按钮），也能自动裁到摊位，不必手动框选。
    """
    # OCR 常把「单价 40000」黏成一个块（text="单价40000"），只认纯"单价"会漏掉
    # 这些格，导致 region 只框住少数被分开识别的格子、漏掉其余物品行。
    # 故匹配以"单价"开头（含黏块）的文本块。
    ups = [b for b in blocks if _norm(b.get('text') or '').startswith('单价')]
    if len(ups) < 2:                 # 2 个即可（小摊位可能只有 2 个物品格）
        return None
    xs = [b.get('x', 0) for b in ups]
    ys = [b.get('y', 0) for b in ups]
    col_c = _cluster_1d(xs, 40.0)
    row_c = _cluster_1d(ys, 12.0)
    col_pitch = _median([col_c[i + 1] - col_c[i] for i in range(len(col_c) - 1)]) if len(col_c) >= 2 else 120.0
    row_pitch = _median([row_c[i + 1] - row_c[i] for i in range(len(row_c) - 1)]) if len(row_c) >= 2 else 62.0
    # 横向只扩 0.5 列：物品名紧邻「单价」左侧/上方，扩太多会把左侧 HUD 面板圈进来
    x0 = min(xs) - 0.5 * col_pitch
    x1 = max(xs) + 0.5 * col_pitch
    y0 = min(ys) - 1.0 * row_pitch          # 往上 1 行，含物品名行
    y1 = max(ys) + 0.5 * row_pitch          # 往下半行，含本行价格、不含底部控制栏
    return (x0, y0, x1, y1)


# 用于「黏连物品名」按词典切分的词汇表（叶子+顶级，按长度降序，长词优先）。
SEG_NAMES = sorted({m['name'] for m in CAT_META.values()}, key=lambda x: -len(x))


def _segment_names(raw: str) -> list:
    """把 OCR 黏连的物品名（如『高级清灵仙露中级清灵仙露…』）按类目词典贪心切分为若干规范物品名。

    返回已知物品名列表；若一个都切不出，回退为 [raw]（交给归一逻辑处理）。
    """
    s = _norm(raw)
    if not s:
        return []
    # 钟灵石「N级+特效」：等级决定价格，切分时**不许把等级跳掉**
    # （原逻辑逐字跳过无法匹配的字符，会把「1级」削没，只剩「破血狂攻」）
    m = _re.match(r'^(\d{1,2})级(.+)$', s)
    if m:
        hit = _match_catalog(m.group(2), CAT_NORM, CAT_META)
        if hit and hit[1] == '钟灵石':
            return [s]
    found = []
    while s:
        hit = None
        for name in SEG_NAMES:
            nk = _norm(name)
            if nk and s.startswith(nk):
                hit = name
                break
        if hit:
            found.append(hit)
            s = s[len(_norm(hit)):]
        else:
            s = s[1:]          # 跳过无法匹配的字符（OCR 黏连/错字）
    known = [f for f in found if _norm(f) in CAT_META]
    return known if known else [raw]


def parent_of(category: str):
    """给定分类名，返回其顶级分类名（叶子查表；顶级返回自身；未知返回空）。"""
    if category in TAX["top_names"]:
        return category
    p = TAX["leaf_parent"].get(category, "")
    if p:
        return p
    # 动态名「N级+钟灵石特效」（如 5级破血狂攻）不在分类树里，去掉等级再查
    m = _re.match(r'^(\d{1,2})级(.+)$', category or '')
    if m:
        return TAX["leaf_parent"].get(m.group(2), "")
    return ""


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
    price_type: Optional[str] = "buy"    # buy=收货价（收购摊位）；sell=出货价（出售摊位）
    stall_owner: Optional[str] = None    # 摊主名（如「素颜ω如天」），用于价格溯源
    stall_id: Optional[str] = None       # 摊位ID（如「31062504」）
    stall_name: Optional[str] = None     # 摊位名/招牌（如「25W收163五行」），摊主自写的广告语
    icon: Optional[str] = None          # 形如 "低级兽决/兽决.png"，前端经 /static/icons 代理取图
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
    pt = (s.price_type or "buy").strip().lower()
    if pt not in ("buy", "sell"):
        pt = "buy"
    db = load_db()
    ts = s.collected_at or int(time.time())
    rec = {
        "id": uuid.uuid4().hex[:12],
        "item_name": s.item_name.strip(),
        "category": s.category.strip(),
        "server": s.server.strip(),
        "price": float(s.price),
        "price_type": pt,
        "stall_owner": (s.stall_owner or "").strip(),
        "stall_id": (s.stall_id or "").strip(),
        "stall_name": (s.stall_name or "").strip(),
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


def _stat(recs: list):
    """统计一组样本：均价/最低/最高/样本数。

    额外带上**最低价、最高价那两条原始记录**（min_rec / max_rec），
    前端点价格就能溯源到具体摊位（摊主名 / 摊位ID / 区服 / 采集时间）。
    """
    if not recs:
        return None
    ps = [r["price"] for r in recs]
    lo = min(recs, key=lambda r: r["price"])
    hi = max(recs, key=lambda r: r["price"])

    def _rec(r):
        return {
            "id": r.get("id", ""),
            "price": r["price"],
            "server": r.get("server", ""),
            "stall_owner": r.get("stall_owner", ""),
            "stall_id": r.get("stall_id", ""),
            "stall_name": r.get("stall_name", ""),
            "collected_at": r.get("collected_at", 0),
        }

    return {
        "avg": round(sum(ps) / len(ps), 4),
        "min": min(ps),
        "max": max(ps),
        "count": len(ps),
        "min_rec": _rec(lo),
        "max_rec": _rec(hi),
    }


@app.get("/api/harvest")
def list_aggregated(category: str = "", server: str = "", kw: str = ""):
    """按物品聚合，分别给出「收货价(buy)」与「出货价(sell)」的均价/区间/样本数。"""
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
            "buy": [],
            "sell": [],
            "latest": 0,
        })
        pt = r.get("price_type") or "buy"
        # 塞整条样本记录（不是只塞 r["price"]），_stat 才能溯源到摊位/摊主/ID
        (g["sell"] if pt == "sell" else g["buy"]).append(r)
        if r["collected_at"] > g["latest"]:
            g["latest"] = r["collected_at"]
            g["category"] = r["category"]
            g["icon"] = r["icon"]
            g["parent"] = r.get("parent", "")

    items = []
    for name, g in groups.items():
        b = _stat(g["buy"])
        s = _stat(g["sell"])
        main = b or s or {"avg": 0, "min": 0, "max": 0, "count": 0}
        items.append({
            "item_name": name,
            "category": g["category"],
            "parent": g["parent"],
            # 优先用 catalog 实时补图标（样本存库的 icon 可能为空，如采集时 catalog 尚未登记）
            "icon": WUJI_ITEMS.get(name, {}).get("icon") or g["icon"],
            "buy": b,
            "sell": s,
            # 兼容旧字段（无收货价时用出货价顶，保证排序/旧视图不炸）
            "avg": main["avg"],
            "min": main["min"],
            "max": main["max"],
            "count": (b["count"] if b else 0) + (s["count"] if s else 0),
            "latest": g["latest"],
        })
    items.sort(key=lambda x: x["latest"], reverse=True)
    return {"success": True, "items": items, "total": len(items)}


@app.delete("/api/harvest/clear")
def clear_all():
    save_db({"samples": []})
    return {"success": True}


@app.delete("/api/harvest/server/{server}")
def delete_server(server: str):
    """删除某个区服的全部采集样本（用户有此权限）。"""
    db = load_db()
    before = len(db["samples"])
    db["samples"] = [r for r in db["samples"] if r["server"] != server]
    save_db(db)
    return {"success": True, "deleted": before - len(db["samples"])}


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


# ===== OCR 结果 → 结构化收货价条目（对标 mhxyai 的 items[]）=====
# mhxyai 的 /api/price/stall/recognize 返回的是「摊位里每行一个物品」的结构化数据
# （name / buy_price / sell_price / column / row），而不是一堆散文字块。
# 这里把 RapidOCR 的散块按版面聚类成「行」，每行配对 物品名 + 价格，输出同款结构。
_PRICE_RE = _re.compile(r'^(\d+(?:\.\d+)?)\s*([万wW]?)$')


def _price_value(text: str):
    """价格文本 → 数值（统一为「万」）。

    - 带「万」后缀：'80万' -> 80.0
    - 不带后缀：摊位 UI 显示的都是**原始游戏币**（如 645000 / 3555），一律 ÷10000 换算成万
      （645000 -> 64.5；3555 -> 0.3555）。不用「数值大小」猜单位——3555 这种小数字
      曾经被误当成「3555 万」，实际是 3555 游戏币。
    非价格返回 None。
    """
    m = _PRICE_RE.match((text or '').strip())
    if not m:
        return None
    val = float(m.group(1))
    if not m.group(2):
        val = round(val / 10000.0, 4)
    return val


def parse_harvest_items(blocks: list) -> list:
    """把 OCR 文字块解析成结构化收货价条目（物品名 ↔ 价格 配对）。

    摊位有两种常见版面，这里统一处理：
    1) **网格摊位**（如召唤兽类/兽决）：4 列 × N 行，每格「名称」在上、「单价 数字」在下。
       此时按「列对齐 + 正下方最近价格」配对，纵向窗口由行距自适应（行距×0.7）。
    2) **列表摊位 / 合并块**：名称与价格同块或同行，块内直接拆价。
    另外会过滤表头/页脚 UI 文案（单价、数量、摊主、ID、购买…）与底部控制栏。
    """
    if not blocks:
        return []
    allb = [b for b in blocks if (b.get('text') or '').strip()]
    if not allb:
        return []

    # 注意：区域裁切只在 recognize 里做一次（可能还做了放大）。
    # 这里**绝不能**再按坐标裁一遍——若上游已裁切+放大，坐标空间已变，二次裁切会把半边物品切掉。

    # 0) 丢掉底部控制栏（数量/物品类/摊主/ID/购买…），防止页脚文字被当成物品
    footer_y = _detect_footer_band(allb)
    if footer_y is not None:
        allb = [b for b in allb if b.get('y', 0) < footer_y - 8]
        if not allb:
            return []

    # 0.5) 丢掉摊位招牌（标题栏）：与「切换模式 / 观看图鉴」同一行的那一排。
    # 招牌是摊主自己写的广告（如「兽决画魂66伤」），**不是物品**，
    # 但它块内自带数字，会被 inline 拆价误判成一个「物品名+价格」→ 整行排除。
    _CTRL_NORM = {'切换模式', '观看图鉴'}
    ctrl_ys = [b.get('y', 0) for b in allb if _norm(b.get('text') or '') in _CTRL_NORM]
    title_y = _median(ctrl_ys) if ctrl_ys else None

    # 1) 分类：物品名块 / 价格块
    names: list = []
    prices: list = []
    for b in allb:
        t = (b.get('text') or '').strip()
        # 标题栏整行排除（25px 容差：招牌与控件同 y，物品行至少差 60px）
        if title_y is not None and abs(b.get('y', 0) - title_y) <= 25:
            continue
        if _is_ui_noise(t):
            continue
        has_cn = bool(_re.search(r'[一-鿿A-Za-z]', t))
        if not has_cn:
            v = _price_value(t)
            if v is not None and v > 0:
                prices.append({'x': b.get('x', 0), 'y': b.get('y', 0),
                               'value': v, 'text': t, 'score': b.get('score', 0.0),
                               'prio': b.get('prio', 1)})
            continue
        # 含中文：可能是「物品名+价格」合并块，从块内拆出价格
        inline = None
        name_text = t
        # 但若整块本身就是登记在册的物品名（精确命中 / 钟灵石「N级+特效」/ 别名），
        # 就不做 inline 拆价 —— 否则钟灵石纯数字特效名（如「1级163」）结尾的「163」
        # 会被 `_last_inline_price` 当成价格，名字被削成「1级」再被 UI 噪音（\d+级）
        # 过滤掉，整行丢失（实测：163 系列全丢、参天古木/烈火燎原正常）。
        _mt = normalize_item_name(t)
        _is_pure_name = bool(_mt.get('matched')) and (
            _mt.get('match_method') in ('zs-level', 'alias')
            or str(_mt.get('match_method', '')).endswith('exact'))
        if _is_pure_name:
            if _is_ui_noise(name_text):
                continue
            names.append({'text': name_text, 'x': b.get('x', 0), 'y': b.get('y', 0),
                          'score': b.get('score', 0.0), 'inline': None})
            continue
        m = _last_inline_price(t)
        if m:
            sub = m.group(0)
            val = _price_value(sub)
            if val is not None and val > 0:
                inline = {'x': b.get('x', 0), 'y': b.get('y', 0),
                          'value': val, 'text': sub, 'score': b.get('score', 0.0)}
                rest = (t[:m.start()] + t[m.end():]).strip()
                if rest:
                    name_text = rest
        if not name_text or _is_ui_noise(name_text):
            continue
        names.append({'text': name_text, 'x': b.get('x', 0), 'y': b.get('y', 0),
                      'score': b.get('score', 0.0), 'inline': inline})

    if not names:
        return []

    # 2) 配对：每个物品名 → 正下方、同列的最近价格
    max_dy, max_dx = _estimate_pair_window(names, prices)
    used: set = set()
    items: list = []
    for ri, n in enumerate(sorted(names, key=lambda a: (a['y'], a['x']))):
        p = n['inline']
        if p is None:
            best = None
            for j, pr in enumerate(prices):
                if j in used:
                    continue
                dy = pr['y'] - n['y']
                dx = abs(pr['x'] - n['x'])
                if 0 < dy <= max_dy and dx <= max_dx:
                    # prio 惩罚：整图那遍的价格(prio=0)优先于裁切放大的(prio=1)；
                    # 只有当整图没识别出该价格时，才退用裁切那遍的。
                    cost = dy * 2 + dx + pr.get('prio', 1) * 80
                    if best is None or cost < best[0]:
                        best = (cost, j, pr)
            if best is None:
                continue        # 配不到价格 → 不是物品（标题/页脚/杂字），丢弃
            used.add(best[1])
            p = best[2]

        # 3) 黏连物品名 → 按类目词典切分为多个规范物品
        seg = _segment_names(n['text'])
        split = len(seg) > 1
        for nm_text in seg:
            nm = normalize_item_name(nm_text)
            items.append({
                'name': nm_text,
                'item_name': nm['item_name'],
                'category': nm['category'],
                'parent': nm['parent'],
                'icon': nm.get('icon', ''),
                'matched': nm['matched'],
                'match_method': nm['match_method'],
                'match_score': nm['match_score'],
                'price_text': p['text'],
                'price': p['value'],
                'score': p['score'],
                'row': ri,
                'col': 0,
                'split': split,
            })
    return items


def detect_stall_kind(blocks: list) -> str:
    """判断摊位类型：'buy'=收购摊位（单价即收货价）；'sell'=出售摊位（单价即出货价）。

    依据摊位 UI 文案：
    - 收购摊位：有「摊主的收购项目」/「卖出」按钮 → 对方在收货 → 单价 = 收货价
    - 出售摊位：有「购买」按钮 → 对方在出货 → 单价 = 出货价
    """
    txt = ' '.join((b.get('text') or '') for b in blocks)
    if ('收购' in txt) or ('卖出' in txt):
        return 'buy'
    # 出售摊位：有「购买」按钮；或裁掉了按钮但留有品类标签（物品类/藏宝阁类…）
    if '购买' in txt or ('物品类' in txt and '藏宝阁类' in txt):
        return 'sell'
    return ''


_STALL_MARKERS = ('单价', '摊主', '收购', '购买', '卖出', '总价', '藏宝阁类', '物品类', '召唤兽类', '制造类')


def has_stall_markers(blocks: list) -> bool:
    """画面里是否有摊位界面的特征文案，用来判断「这一帧到底是不是摊位」。"""
    txt = ' '.join((b.get('text') or '') for b in blocks)
    return any(m in txt for m in _STALL_MARKERS)


def detect_stall_owner(blocks: list):
    """从摊位界面提取 (摊主名, 摊位ID)，用于价格溯源。

    收购摊位标题栏：「摊主 泪依言欣。」「ID 29035765」
    出售摊位底部栏：「摊主」「素颜ω如天」「ID」「31062504」
    做法：定位「摊主」/「ID」标签块，取其右侧同一行最近的文字块；
    标签与值被 OCR 合成一块时（如「ID 29035765」）走兜底解析。
    """
    owner, sid = '', ''

    def right_of(labels, accept=None):
        for lb in labels:
            ly, lx = lb.get('y', 0), lb.get('x', 0)
            cands = [c for c in blocks
                     if c.get('x', 0) > lx and abs(c.get('y', 0) - ly) <= 22
                     and (c.get('text') or '').strip()]
            if accept:
                cands = [c for c in cands if accept((c.get('text') or '').strip())]
            if cands:
                return min(cands, key=lambda c: c['x'] - lx)['text'].strip()
        return ''

    owner = right_of([b for b in blocks if _norm(b.get('text') or '') == '摊主'])
    sid = right_of([b for b in blocks if _norm(b.get('text') or '') == 'id'],
                   accept=lambda t: bool(_re.fullmatch(r'\d{5,}', t)))
    # 兜底：标签和值被合成一块（「摊主泪依言欣。」/「ID29035765」）
    if not owner:
        for b in blocks:
            t = (b.get('text') or '').strip()
            if t.startswith('摊主') and len(t) > 2:
                owner = t[2:].strip(' 。.、')
                break
    if not sid:
        for b in blocks:
            m = _re.match(r'^(?:id|ID)\s*(\d{5,})$', (b.get('text') or '').strip())
            if m:
                sid = m.group(1)
                break
    return owner, sid


# 摆摊窗口**标题栏**上的固定文案：招牌（摊主自写的品类名/广告语）就夹在它们中间，
# 如「切换模式  ▲内丹内丹▲  观看图鉴」。用这两句当锚点定位最稳。
_STALL_TITLE_ANCHOR_NORM = ('切换模式', '观看图鉴')

# 招牌两端的下拉三角 / 装饰符（「▲内丹内丹▲」→「内丹内丹」）
_STALL_NAME_TRIM = ' \t▲▼◀▶△▽◆◇■□●○★☆※·、'


def _clean_stall_name(t: str) -> str:
    """清掉招牌两端的下拉三角/装饰符，保留「」引号等正文符号。"""
    return _re.sub(r'^[' + _re.escape(_STALL_NAME_TRIM) + r']+|'
                   r'[' + _re.escape(_STALL_NAME_TRIM) + r']+$', '', t or '').strip()


def detect_stall_name(blocks: list, region: list = None) -> str:
    """提取摊位招牌（摊主自写的广告语 / 品类名，如「25W收163五行」「「购」钟灵石」「内丹内丹」）。

    实测有**两种版面**，必须都兼容（老逻辑只认 B，遇到 A 会串到背景别人的摊位）：

    A. **摆摊窗口**（自己的/查看别人的摆摊界面）：窗口标题栏固定写着
       「切换模式 … 观看图鉴」，招牌夹在中间（如「▲内丹内丹▲」）；
       而「摊主 / ID」在窗口**底部表单区**（实测 y=496，远在物品格下方）。
       → 用标题栏那两句当锚点，取同行内非 UI 的那块。

    B. **收购窗口**：招牌紧贴在「摊主 / ID」标签行的**正上方**（实测 30~70px）。
       → 以「摊主」行为锚点向上找；**必须排除与摊主/ID 同一排的块**（那是昵称/ID 数值）。

    C. 兜底：摊位物品区（region）顶边上下不远处、水平落在摊位窗口内的非 UI 文本。

    坑1：整图里还能看到附近其它玩家的摊位招牌（「收健步如飞」「低端宝宝装」…），
         它们集中在**屏幕最左侧一列**（x 远小于摊位窗口左边界）→ 用 region 水平范围卡掉。
         旧逻辑用 region ±60 的宽松容差，正好把这一列放进来（内丹帧取到了「低端宝宝装」）。
    坑2：「摊主」标签有时与值被 OCR 合成一块（「摊主薇风雪01」），旧逻辑用 `== '摊主'`
         精确匹配会直接 return ''（163 帧两例招牌因此丢失）→ 改为 startswith 匹配。

    没招牌（摊主没写）时返回空串，不影响入库。
    """
    rx0 = rx1 = ry0 = None
    if region and len(region) >= 4:
        rx0, rx1, ry0 = float(region[0]), float(region[2]), float(region[1])

    def in_panel(b) -> bool:
        """水平落在摊位窗口内（容差收紧到 12px，挡住屏幕最左侧的背景摊位招牌列）。"""
        if rx0 is None:
            return True
        x = b.get('x', 0)
        return (rx0 - 12) <= x <= (rx1 + 12)

    def usable(b) -> bool:
        t = (b.get('text') or '').strip()
        if len(t) < 2:
            return False
        if not _re.search(r'[一-鿿A-Za-z]', t):        # 必须有中文或字母
            return False
        if _re.fullmatch(r'[\d.,:：\s]+[万Ww]?', t):   # 纯价格 / 纯数字（ID、坐标）
            return False
        if _is_ui_noise(t):                            # 界面固定文案（含「更多」「关注」…）
            return False
        n = _norm(t)
        if n.startswith('摊主') or n in ('id', '摊位id'):   # 摊主行本身及其数值
            return False
        return True

    # ---- A. 标题栏锚点法（摆摊窗口版面）----
    for a in [b for b in blocks if _norm(b.get('text') or '') in _STALL_TITLE_ANCHOR_NORM]:
        ay, ax = a.get('y', 0), a.get('x', 0)
        # 同行容差压到 12px：标题栏文字 y 基本一致（实测 152/154），
        # 而窗口上方紧邻的背景招牌（「元宵」y=138）差 16px，会被这一条挡住。
        row = [b for b in blocks
               if abs(b.get('y', 0) - ay) <= 12 and b.get('x', 0) > ax
               and usable(b) and in_panel(b)]
        if row:
            # 取锚点右侧最近的那块（标题栏里招牌紧邻「切换模式」）
            return _clean_stall_name(str(min(row, key=lambda b: b['x'] - ax).get('text') or ''))

    # ---- B. 「摊主 / ID」行正上方（收购窗口版面）----
    owner_bs = [b for b in blocks if _norm(b.get('text') or '').startswith('摊主')]
    if owner_bs:
        ly = min(b.get('y', 0) for b in owner_bs)
        row_ys = [b.get('y', 0) for b in owner_bs]
        cands = [b for b in blocks
                 if ly - 80 <= b.get('y', 0) <= ly - 5
                 and usable(b) and in_panel(b)
                 and not any(abs(b.get('y', 0) - y) <= 24 for y in row_ys)]
        if cands:
            # 取最靠近摊主行的那块（招牌紧贴在摊主行上方）
            return _clean_stall_name(str(max(cands, key=lambda b: b.get('y', 0)).get('text') or ''))

    # ---- C. 摊位区顶边附近兜底 ----
    if ry0 is not None:
        cands = [b for b in blocks
                 if ry0 - 80 <= b.get('y', 0) <= ry0 + 14 and usable(b) and in_panel(b)]
        if cands:
            return _clean_stall_name(str(max(cands, key=lambda b: b.get('y', 0)).get('text') or ''))

    return ''


def detect_server_hint(blocks: list) -> str:
    """轻量探测截图里的区服信息（对标 mhxyai 从标题栏取 server）。

    仅作低置信度提示，正式入库以 UI 里用户确认的服务器为准。命中形如
    「XX区/XX服/XX网」的文字块即返回。
    """
    for b in sorted(blocks, key=lambda x: x.get('y', 0)):
        t = (b.get('text') or '').strip()
        if _re.search(r'[区服网]', t) and _re.search(r'[一-鿿A-Za-z]', t):
            return t
    return ''


def _ocr_to_blocks(engine, img) -> list:
    """跑一次 OCR，把结果转成带中心坐标的文字块列表（按版面顺序：先行后列）。"""
    import numpy as np
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
    blocks.sort(key=lambda b: (round(b["y"] / 20), b["x"]))
    return blocks


# ===== 调试用：每次识别落盘原图/裁切图 + stdout 详细日志 =====
# 日志落点（launchd）：backend/logs/harvest.stdout.log
# 调试阶段常开；不需要时把 DEBUG_SAVE / DEBUG_LOG 改成 False 即可（无需删代码）。
DEBUG_SAVE = True
DEBUG_LOG = True
DEBUG_DIR = os.path.join(os.path.dirname(__file__), "debug_shots")
DEBUG_KEEP = 300          # 只保留最近 N 张，避免调试目录无限增长


def _dbg(*parts) -> None:
    """调试日志：即时 flush，否则 launchd 重定向下会攒着不落盘。"""
    if DEBUG_LOG:
        print("[harvest-dbg]", *parts, flush=True)


def _dbg_save(img, tag: str) -> str:
    """保存调试图到 DEBUG_DIR，返回文件名；超量自动删最旧。"""
    if not DEBUG_SAVE:
        return "(未开启)"
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        name = f"{time.strftime('%Y%m%d_%H%M%S')}_{int(time.time() * 1000) % 1000:03d}_{tag}.jpg"
        import cv2 as _cv
        _cv.imwrite(os.path.join(DEBUG_DIR, name), img)
        fs = sorted(f for f in os.listdir(DEBUG_DIR) if f.endswith('.jpg'))
        for extra in fs[:-DEBUG_KEEP]:          # 保留最近 DEBUG_KEEP 张
            try:
                os.remove(os.path.join(DEBUG_DIR, extra))
            except OSError:
                pass
        return name
    except Exception as e:
        return f"保存失败:{e}"


# ===== 遮挡自检 =====
# 捕获源若选了「整个屏幕」，盖在游戏上的本网页会被一起拍进去，OCR 出来的文字一半是
# 本页 UI（收货均价 / 截图并识别 / 默认服务器…），导致候选条目乱七八糟。
# 这里检测画面里是否出现本页特征文案，命中 ≥2 个即判定「被本页遮挡」，交给前端提示/跳过。
_PAGE_MARKERS = (
    '摆摊收售价采集', '摊位截图采集', '收货均价', '最高收货价', '最低出货价', '出货均价',
    '截图并识别', '自动采集', '默认服务器', '默认分类', '物品分类', '条样本', '每页 15 条',
    '清样本', '应用到未匹配行', '最新采集时间', '样本数',
)


def detect_occlusion(blocks: list):
    """返回 (是否遮挡, 命中的特征词列表)。"""
    txt = ' '.join(str(b.get('text') or '') for b in blocks)
    hits = [m for m in _PAGE_MARKERS if m in txt]
    return len(hits) >= 2, hits


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

    h, w = img.shape[:2]

    # 调试：落盘原图
    orig_file = _dbg_save(img, "orig")
    _dbg(f"收到图片 {w}x{h} {len(data)}B → debug_shots/{orig_file}")

    # ---- 第一遍：整图 OCR + 自动定位摊位格子区域 ----
    blocks = _ocr_to_blocks(engine, img)
    region = detect_stall_region(blocks)
    # 摊主名/摊位ID 取自**整图这一遍**：标题栏/底部栏可能被后面的裁切切掉
    stall_owner, stall_id = detect_stall_owner(blocks)
    # 摊位招牌（广告名）：必须以「摊主」行为锚点取，否则会串到画面里附近其它摊位的招牌
    stall_name = detect_stall_name(blocks, region)
    _dbg(f"第1遍OCR {len(blocks)}块 | region={[round(v, 1) for v in region] if region else None}"
         f" | owner={stall_owner!r} id={stall_id!r}")
    _dbg("  文本: " + " | ".join(str(b.get("text", "")) for b in blocks))

    # 整图这一遍单独留一份：摊位**类型/区服/特征文案**必须用整图判定——
    # 裁切放大后只保留物品格，「购买」按钮/品类标签/标题栏都被切掉，
    # 用它判类型会把「出售摊位」误判成未知（stall_kind 空）。
    blocks_full = blocks

    # ---- 第二遍：裁到摊位区、放大 2× 再识别一遍（小字物品名更准）----
    # 整窗截图上摊位文字偏小，直接整图 OCR 会漏字/串字（如 盾气→盾）；放大后显著改善。
    if region is not None:
        rx0, ry0, rx1, ry1 = region
        pad = 8
        cx0, cy0 = max(0, int(rx0) - pad), max(0, int(ry0) - pad)
        cx1, cy1 = min(w, int(rx1) + pad), min(h, int(ry1) + pad)
        if cx1 - cx0 >= 40 and cy1 - cy0 >= 40:
            crop = img[cy0:cy1, cx0:cx1]
            if max(crop.shape[:2]) <= 900:      # 只放大小图；大图本身够清晰
                crop = cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
            crop_file = _dbg_save(crop, "crop")   # 调试：落盘实际识别用的裁切图
            try:
                b2 = _ocr_to_blocks(engine, crop)
            except Exception:
                b2 = []
            _dbg(f"第2遍OCR(裁切 {cx1 - cx0}x{cy1 - cy0} → {crop.shape[1]}x{crop.shape[0]})"
                 f" {len(b2)}块 | 采用={len(b2) >= 3} → debug_shots/{crop_file}")
            _dbg("  文本: " + " | ".join(str(b.get("text", "")) for b in b2))
            # 已经定位到摊位，裁切放大的这一遍更可信 → 优先采用
            if len(b2) >= 3:
                # 但**数字价格**要回用整图这一遍：放大后白字深底的价格反而易被误读
                # （实测 900000 → 000006），整图那遍的同一个价格是准的。
                # 给整图价格打 prio=0、裁切价格 prio=1，配对时优先选整图的（见 parse 的 cost）。
                sx = crop.shape[1] / max(1, (cx1 - cx0))     # 放大倍率（未放大则 =1）
                sy = crop.shape[0] / max(1, (cy1 - cy0))
                for b in b2:
                    b['prio'] = 1
                for b in blocks_full:
                    t = (b.get('text') or '').strip()
                    if _re.search(r'[一-鿿A-Za-z]', t):
                        continue                                 # 只要纯数字（价格）
                    if _price_value(t) is None:
                        continue
                    x, y = b.get('x', 0), b.get('y', 0)
                    if cx0 <= x <= cx1 and cy0 <= y <= cy1:      # 落在摊位区内才映射
                        b2.append({'text': t, 'score': b.get('score', 0.0),
                                   'x': (x - cx0) * sx, 'y': (y - cy0) * sy, 'prio': 0})
                b2.sort(key=lambda b: (round(b.get('y', 0) / 20), b.get('x', 0)))
                # 兜底：裁切放大那一遍偶尔会漏掉排版密集的行（同行带数字 / 紧贴界面文案），
                # 而整图 OCR 往往已识别到这些名字。把整图里落在摊位区内、能命中规范表的
                # 物品名块也并入（坐标映射进 crop 空间），避免摊位只识别半截。
                # 去重：与 crop 已识别块（映射回原图坐标）距离过近则跳过，避免重复条目。
                _existing = {(round(b.get('x', 0) / sx) + cx0, round(b.get('y', 0) / sy) + cy0)
                             for b in b2 if _re.search(r'[一-鿿A-Za-z]', b.get('text', ''))}
                for b in blocks_full:
                    t = (b.get('text') or '').strip()
                    if not _re.search(r'[一-鿿A-Za-z]', t):
                        continue
                    x, y = b.get('x', 0), b.get('y', 0)
                    if not (cx0 <= x <= cx1 and cy0 <= y <= cy1):
                        continue
                    if any(abs(x - ex) <= 12 and abs(y - ey) <= 12 for ex, ey in _existing):
                        continue
                    r = normalize_item_name(t)
                    if r.get('matched') and r.get('parent'):
                        b2.append({'text': t, 'score': b.get('score', 0.0),
                                   'x': (x - cx0) * sx, 'y': (y - cy0) * sy, 'prio': 2})
                blocks = b2

    items = parse_harvest_items(blocks)                    # 物品解析用裁切放大这一遍
    server_hint = detect_server_hint(blocks_full)          # 区服/类型/特征都用整图这一遍
    stall_kind = detect_stall_kind(blocks_full)            # buy=收购摊位(收货价) / sell=出售摊位(出货价)

    # 没检测到摊位界面（如只是游戏主画面/聊天窗）→ 一条都不返回，避免自动采集误入库
    stall_detected = bool(items) and (
        detect_stall_region(blocks_full) is not None or has_stall_markers(blocks_full)
    )
    if not stall_detected:
        items = []

    # 遮挡自检：画面里出现本页 UI 文案 → 捕获源选了「整个屏幕」而不是「游戏窗口」
    occluded, occ_hits = detect_occlusion(blocks)
    if occluded:
        _dbg(f"⚠️ 画面疑似被本页遮挡（命中 {occ_hits}）—— 共享时请选「游戏窗口」，"
             f"不要选「整个屏幕」；选窗口后即使被本页盖住也能识别到窗口内容")

    _dbg(f"解析 items={len(items)}: " + ", ".join(
        f"{it.get('item_name')}={it.get('price')}({it.get('category') or '未分类'})" for it in items))
    _dbg(f"结果 server_hint={server_hint!r} stall_kind={stall_kind} stall_detected={stall_detected}"
         f" | 丢弃的物品名(疑似界面文案): "
         + ", ".join(str(b.get("text", "")) for b in blocks
                     if _is_ui_noise(str(b.get("text", ""))) and str(b.get("text", "")).strip()))

    return {
        "success": True,
        "size": [w, h],
        "server_hint": server_hint,
        "stall_kind": stall_kind,
        "stall_detected": stall_detected,
        "stall_owner": stall_owner,
        "stall_id": stall_id,
        "stall_name": stall_name,
        "region": [round(v, 1) for v in region] if region else None,
        "occluded": occluded,                 # True=画面被本页遮挡，结果不可信
        "occlusion_hits": occ_hits,
        "items": items,
        "blocks": blocks,
    }


@app.get("/api/harvest/health")
def health():
    return {"success": True, "service": "harvest"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)
