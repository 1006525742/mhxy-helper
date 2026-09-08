#!/usr/bin/env python3
"""记账本后端服务 - 简化版"""
import json
import re
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "jizhang_data.json"
ICON_DIR = BASE_DIR / "static" / "icons"

# 确保目录存在
DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="梦幻记账本")

# 添加CORS和编码支持
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 物品自动分类规则
CATEGORY_RULES = {
    "五宝": ["定魂珠", "夜光珠", "金刚石", "龙鳞", "避水珠"],
    "宝石": ["月亮石", "太阳石", "黑宝石", "红玛瑙", "光芒石", "神秘石", "舍利子", "翡翠石", "星辉石", "朱雀石"],
    "道具": ["超级金柳露", "金柳露", "彩果", "玫瑰", "康乃馨", "百合", "树苗", "海马", "大瓶子", "小瓶子", "月华露", "金丹", "如意丹", "碧藕", "珍珠", "分解符", "特赦令牌", "归墟", "残卷", "玄天残卷", "法宝任务书", "储灵袋", "盒子"],
    "兽决": ["高级魔兽要诀", "低级魔兽要诀", "高级召唤兽内丹", "低级召唤兽内丹", "附魔宝珠"],
    "药品": [],
    "烹饪": [],
    "装备": ["60武器", "70武器", "80武器", "60装备", "70装备", "80装备", "灵饰书", "召唤兽装备图册"],
    "其他": ["修炼果", "灵石", "炼妖石", "元灵晶石", "符石卷轴", "1级符石", "变身卡", "古琴", "唢呐", "木鱼", "琵琶", "笛子", "编钟"]
}

def get_category(name: str) -> str:
    """根据物品名自动识别类别"""
    for cat, names in CATEGORY_RULES.items():
        for n in names:
            if n in name or name in n:
                return cat
    return "其他"

def load_data() -> dict:
    """加载本地数据"""
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except:
            pass
    return {"items": [], "server": "无与伦比-梦幻西游"}

def save_data(data: dict):
    """保存本地数据"""
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

class ItemModel(BaseModel):
    name: str
    price: float
    category: Optional[str] = None
    icon: Optional[str] = None
    type: str = "buy"  # buy 或 sell

class UpdateModel(BaseModel):
    id: int
    buyPrice: Optional[float] = None
    sellPrice: Optional[float] = None
    category: str

# 挂载静态文件
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

@app.get("/")
async def index():
    """记账本页面"""
    html_path = BASE_DIR / "templates" / "jizhang.html"
    if html_path.exists():
        return HTMLResponse(html_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>页面未找到</h1>")

@app.get("/test")
async def test_page():
    """测试页面"""
    test_path = BASE_DIR / "test_market.html"
    if test_path.exists():
        return HTMLResponse(test_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>测试页面未找到</h1>")

@app.get("/api/data")
async def get_data():
    """获取所有数据"""
    data = load_data()
    # 补充分类信息
    for item in data.get("items", []):
        if not item.get("category"):
            item["category"] = get_category(item["name"])
    return data

@app.post("/api/item")
async def add_item(item: ItemModel):
    """添加/更新物品"""
    data = load_data()

    # 查找同名物品是否存在
    existing = None
    for i in data.get("items", []):
        if i.get("name") == item.name:
            existing = i
            break

    if existing:
        # 更新已存在物品的价格
        if item.type == "buy":
            existing["buyPrice"] = item.price
        else:
            existing["sellPrice"] = item.price
        existing["category"] = item.category or existing.get("category") or get_category(item.name)
        existing["icon"] = item.icon or existing.get("icon")
        existing["time"] = get_time_str()
        save_data(data)
        return {"success": True, "item": existing, "action": "update"}

    # 新增物品
    max_id = max([i.get("id", 0) for i in data.get("items", [])], default=0) + 1
    new_item = {
        "id": max_id,
        "name": item.name,
        "buyPrice": item.price if item.type == "buy" else None,
        "sellPrice": item.price if item.type == "sell" else None,
        "category": item.category or get_category(item.name),
        "icon": item.icon,
        "server": data.get("server", "无与伦比-梦幻西游"),
        "time": get_time_str()
    }
    data["items"].append(new_item)
    save_data(data)
    return {"success": True, "item": new_item, "action": "add"}

@app.put("/api/item")
async def update_item(body: UpdateModel):
    """更新物品价格"""
    data = load_data()
    for item in data.get("items", []):
        if item["id"] == body.id:
            if body.buyPrice is not None:
                item["buyPrice"] = body.buyPrice
            if body.sellPrice is not None:
                item["sellPrice"] = body.sellPrice
            item["category"] = body.category
            item["time"] = get_time_str()
            save_data(data)
            return {"success": True}
    return {"success": False, "error": "物品不存在"}

@app.delete("/api/item/{id}")
async def delete_item(id: int):
    """删除物品"""
    data = load_data()
    data["items"] = [i for i in data.get("items", []) if i["id"] != id]
    save_data(data)
    return {"success": True}

@app.delete("/api/items")
async def clear_items(category: str = None):
    """清空物品（可按分类）"""
    data = load_data()
    if category:
        data["items"] = [i for i in data.get("items", []) if i.get("category") != category]
    else:
        data["items"] = []
    save_data(data)
    return {"success": True}

@app.post("/api/server")
async def set_server(body: dict):
    """设置服务器"""
    data = load_data()
    data["server"] = body.get("server", "")
    for item in data.get("items", []):
        item["server"] = data["server"]
    save_data(data)
    return {"success": True}

@app.get("/api/icons")
async def list_icons():
    """获取图标列表 - 同图标物品合并，点击展开选择具体类型"""
    import sys
    sys.path.insert(0, str(BASE_DIR))
    from price_spider import ICON_MAPPING, SERVERS

    # 物品分组定义（图标名 -> 子类型列表）
    ITEM_VARIANTS = {
        # 附魔宝珠等级（没有150级）
        "附魔宝珠": ["80级", "100级", "110级", "120级", "130级", "140级"],
        # 珍珠等级
        "珍珠": ["60级", "70级", "80级", "90级", "100级", "110级", "120级", "130级"],
        # 炼妖石等级（75、85、95、105、115、125、135）
        "炼妖石": ["75级", "85级", "95级", "105级", "115级", "125级", "135级"],
        # 图册等级
        "图册": ["75级", "85级", "95级", "105级", "115级", "125级", "135级"],
        # 元灵晶石等级
        "元灵晶石": ["60级", "80级", "100级", "120级", "140级"],
        # 灵饰书子类型（戒指、耳饰、手镯、配饰）- 每个60-140级
        "灵饰书_戒指": ["60级", "80级", "100级", "120级", "140级"],
        "灵饰书_耳饰": ["60级", "80级", "100级", "120级", "140级"],
        "灵饰书_手镯": ["60级", "80级", "100级", "120级", "140级"],
        "灵饰书_配饰": ["60级", "80级", "100级", "120级", "140级"],
        # 灵饰属性
        "灵饰": ["速度", "伤害", "防御", "气血"],
        # 如意丹颜色
        "如意丹": ["金", "木", "水", "火", "土"],
        # 元宵类型
        "元宵": ["躲元宵", "防元宵", "法元宵", "攻元宵", "体元宵", "速元宵"],
        # 灵石属性类型
        "灵石": ["速度灵石", "气血晶石", "防御灵石", "伤害晶石"],
        # 原初魔石颜色
        "原初魔石": ["白", "黑", "红", "黄", "蓝", "绿", "紫"],
        # 低级兽决
        "兽决": ["必杀", "连击", "吸血", "感知", "强力", "防御", "幸运", "反击",
                 "反震", "夜战", "鬼魂术", "神迹", "冥思", "再生", "隐身", "魔之心",
                 "法术连击", "法术暴击", "法术波动", "毒", "驱鬼", "敏捷", "飞行",
                 "慧根", "永恒", "精神集中", "否定信仰", "招架", "迟钝",
                 "神佑复生", "偷袭", "吸收", "小法"],
        # 低级内丹
        "低级召唤兽内丹": ["矫健", "静岳", "灵身", "灵光", "狂怒", "连环", "阴伤", "撞击",
                         "深思", "擅咒", "无畏", "圣洁", "协力", "迅敏", "坚甲", "钢化",
                         "愤恨", "慧心", "狙刺", "淬毒"],
    }

    icon_groups = {}
    categories = set()

    # 先扫描图标文件夹
    if ICON_DIR.exists():
        for item in ICON_DIR.iterdir():
            if item.is_dir():
                category = item.name
                categories.add(category)
                for f in item.glob("*.png"):
                    icon_name = f.stem
                    icon_path = f"{category}/{f.name}"

                    # 特殊处理：灵饰书拆分为四个子类型
                    if icon_name == "灵饰书":
                        for sub_type in ["戒指", "耳饰", "手镯", "配饰"]:
                            sub_key = f"{category}_灵饰书_{sub_type}"
                            sub_variants = ["60级", "80级", "100级", "120级", "140级"]
                            icon_groups[sub_key] = {
                                "name": f"灵饰书_{sub_type}",
                                "category": category,
                                "icon": f.name,
                                "path": icon_path,
                                "variants": [{"name": v, "fullName": f"{sub_type}_{v}", "path": icon_path, "sortNum": int(v.replace("级", ""))}
                                             for v in sub_variants]
                            }
                        continue

                    # 特殊处理：制造指南书拆分为武器类型子类型（每个都有100-140级）
                    if icon_name == "制造指南书":
                        weapon_types = ["剑书", "宝珠书", "弓书", "扇书", "头盔书"]
                        for sub_type in weapon_types:
                            sub_key = f"{category}_制造指南书_{sub_type}"
                            icon_groups[sub_key] = {
                                "name": f"制造指南书_{sub_type}",
                                "category": category,
                                "icon": f.name,
                                "path": icon_path,
                                "variants": [{"name": v, "fullName": f"{sub_type}_{v}", "path": icon_path, "sortNum": int(v.replace("级", ""))}
                                             for v in ["100级", "120级", "140级"]]
                            }
                        continue

                    # 用图标名作为key
                    key = f"{category}_{icon_name}"

                    # 检查是否有预定义的变体
                    variants = ITEM_VARIANTS.get(icon_name, [])

                    # 提取等级数值作为sortNum（如"60级" -> 60）
                    def extract_sort_num(v, idx):
                        if "级" in v:
                            return int(v.replace("级", ""))
                        return idx * 20  # 其他类型用索引排序，间隔20

                    icon_groups[key] = {
                        "name": icon_name,
                        "category": category,
                        "icon": f.name,
                        "path": icon_path,
                        "variants": [{"name": v, "fullName": v, "path": icon_path, "sortNum": extract_sort_num(v, i)}
                                     for i, v in enumerate(variants)] if variants else []
                    }

        # 根目录图标
        for f in ICON_DIR.glob("*.png"):
            icon_name = f.stem
            key = f"其他_{icon_name}"
            variants = ITEM_VARIANTS.get(icon_name, [])

            # 提取等级数值作为sortNum（如"60级" -> 60）
            def extract_sort_num(v, idx):
                if "级" in v:
                    return int(v.replace("级", ""))
                return idx * 20  # 其他类型用索引排序，间隔20

            icon_groups[key] = {
                "name": icon_name,
                "category": "其他",
                "icon": f.name,
                "path": f.name,
                "variants": [{"name": v, "fullName": v, "path": f.name, "sortNum": extract_sort_num(v, i)}
                             for i, v in enumerate(variants)] if variants else []
            }
            categories.add("其他")

    # 转换为列表
    icons = list(icon_groups.values())

    # 排序variants
    for icon in icons:
        if icon.get("variants"):
            icon["variants"].sort(key=lambda v: v.get("sortNum", 99999))

    # 按类别和名称排序icons
    icons.sort(key=lambda x: (x.get("category", ""), x.get("name", "")))

    return JSONResponse({"icons": icons, "categories": sorted(categories)})

@app.post("/api/sync")
async def sync_market():
    """手动触发爬虫同步（检查API返回的日期，同天不重复）"""
    import sys
    sys.path.insert(0, str(BASE_DIR))
    from price_spider import sync_all_servers
    result = sync_all_servers()
    return {"success": True, "result": result}

@app.get("/api/market")
async def get_market():
    """获取当前市场价（两个区的最新数据）"""
    import sys
    sys.path.insert(0, str(BASE_DIR))
    from price_spider import get_market_prices
    data = get_market_prices()
    return JSONResponse({"success": True, "data": data}, media_type="application/json; charset=utf-8")

@app.get("/api/trends")
async def get_trends(item_name: str = None):
    """获取涨跌趋势"""
    import sys
    sys.path.insert(0, str(BASE_DIR))
    from price_spider import get_trends
    data = get_trends(item_name)
    return {"success": True, "data": data}

def get_time_str():
    import datetime
    now = datetime.datetime.now()
    return f"{now.month}/{now.day} {now.hour}:{now.minute:02d}"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)