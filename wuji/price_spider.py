#!/usr/bin/env python3
"""价格爬虫 - 从梦幻抓鬼工具箱小程序API获取价格数据，支持多服务器和历史记录"""
import requests
import json
import urllib3
from pathlib import Path
from datetime import datetime

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "jizhang_data.json"
HISTORY_FILE = BASE_DIR / "data" / "price_history.json"
ICON_DIR = BASE_DIR / "static" / "icons"
API_URL = "https://mhapi.zyungame.com/mh/server/prices"

SERVERS = ["梦幻西游", "紫禁之巅", "紫禁城", "兰亭序", "生日快乐", "钓鱼岛", "2008", "珍宝阁", "将军", "大唐官府", "曲阜孔庙", "沂水雪山"]

# API名称 -> 图标文件名映射（统一映射到基础图标）
ICON_MAPPING = {
    # 附魔 -> 附魔宝珠（没有150级）
    "80附魔": "附魔宝珠", "100附魔": "附魔宝珠", "110附魔": "附魔宝珠",
    "120附魔": "附魔宝珠", "130附魔": "附魔宝珠", "140附魔": "附魔宝珠",
    # 珍珠 -> 珍珠
    "60珍珠": "珍珠", "70珍珠": "珍珠", "80珍珠": "珍珠", "90珍珠": "珍珠",
    "100珍珠": "珍珠", "110珍珠": "珍珠", "120珍珠": "珍珠",
    "130珍珠": "珍珠", "140珍珠": "珍珠", "150珍珠": "珍珠", "160珍珠": "珍珠",
    # 炼妖石 -> 炼妖石（75、85、95、105、115、125、135）
    "75炼妖石": "炼妖石", "85炼妖石": "炼妖石", "95炼妖石": "炼妖石",
    "105炼妖石": "炼妖石", "115炼妖石": "炼妖石", "125炼妖石": "炼妖石", "135炼妖石": "炼妖石",
    # 晶石 -> 元灵晶石
    "60晶石": "元灵晶石", "80晶石": "元灵晶石", "100晶石": "元灵晶石",
    "120晶石": "元灵晶石", "140晶石": "元灵晶石",
    # 灵饰书
    "60戒指书": "灵饰书", "80戒指书": "灵饰书",
    "100戒指书": "灵饰书", "120戒指书": "灵饰书", "140戒指书": "灵饰书",
    "60耳饰书": "灵饰书", "80耳饰书": "灵饰书",
    "100耳饰书": "灵饰书", "120耳饰书": "灵饰书", "140耳饰书": "灵饰书",
    # 武器书 -> 制造指南书
    "60 级剑书": "制造指南书", "80 级剑书": "制造指南书", "100 级剑书": "制造指南书", "120 级剑书": "制造指南书", "140 级剑书": "制造指南书",
    "60 级宝珠书": "制造指南书", "80 级宝珠书": "制造指南书", "100 级宝珠书": "制造指南书", "120 级宝珠书": "制造指南书", "140 级宝珠书": "制造指南书",
    "60 级弓书": "制造指南书", "80 级弓书": "制造指南书", "100 级弓书": "制造指南书", "120 级弓书": "制造指南书", "140 级弓书": "制造指南书",
    "60 级扇书": "制造指南书", "80 级扇书": "制造指南书", "100 级扇书": "制造指南书", "120 级扇书": "制造指南书", "140 级扇书": "制造指南书",
    "100 级头盔书": "制造指南书", "120 级头盔书": "制造指南书", "140 级头盔书": "制造指南书",
    # 装备武器
    "60 装备": "60装备", "80 装备": "80装备", "任意60灵饰": "灵饰书",
    "任意70防具": "70装备", "任意70武器": "70武器", "任意80灵饰": "灵饰书",
    "60 武器": "60武器", "80 武器": "80武器",
    # 兽决 -> 兽决（通用图标）
    "必杀": "兽决", "连击": "兽决", "吸血": "兽决", "感知": "兽决",
    "强力": "兽决", "防御": "兽决", "幸运": "兽决", "反击": "兽决",
    "反震": "兽决", "夜战": "兽决", "鬼魂术": "兽决", "神迹": "兽决",
    "冥思": "兽决", "再生": "兽决", "隐身": "兽决", "魔之心": "兽决",
    "法术连击": "兽决", "法术暴击": "兽决", "法术波动": "兽决",
    "毒": "兽决", "驱鬼": "兽决", "敏捷": "兽决", "飞行": "兽决",
    "慧根": "兽决", "永恒": "兽决", "精神集中": "兽决",
    "否定信仰": "兽决", "招架": "兽决", "迟钝": "兽决",
    "神佑复生": "兽决", "偷袭": "兽决", "吸收": "兽决",
    "小法": "兽决", "进击必杀": "兽决", "进击法暴": "兽决", "合纵": "兽决", "盾气": "兽决",
    "法术抵抗": "兽决", "垃圾兽诀": "兽决",
    # 内丹 -> 低级召唤兽内丹（通用图标）
    "矫健": "低级召唤兽内丹", "静岳": "低级召唤兽内丹", "灵身": "低级召唤兽内丹", "灵光": "低级召唤兽内丹",
    "狂怒": "低级召唤兽内丹", "连环": "低级召唤兽内丹", "阴伤": "低级召唤兽内丹", "撞击": "低级召唤兽内丹",
    "深思": "低级召唤兽内丹", "擅咒": "低级召唤兽内丹", "无畏": "低级召唤兽内丹", "圣洁": "低级召唤兽内丹",
    "协力": "低级召唤兽内丹", "迅敏": "低级召唤兽内丹", "坚甲": "低级召唤兽内丹", "钢化": "低级召唤兽内丹",
    "愤恨": "低级召唤兽内丹", "慧心": "低级召唤兽内丹", "狙刺": "低级召唤兽内丹", "淬毒": "低级召唤兽内丹",
    "遗志": "低级召唤兽内丹", "垃圾内丹": "低级召唤兽内丹", "垃圾高内丹": "高级召唤兽内丹",
    # 灵石 -> 灵石
    "原初魔石·白": "原初魔石", "原初魔石·黑": "原初魔石", "原初魔石·红": "原初魔石",
    "原初魔石·黄": "原初魔石", "原初魔石·蓝": "原初魔石", "原初魔石·绿": "原初魔石", "原初魔石·紫": "原初魔石",
    # 五色灵尘在宝石文件夹
    "五色灵尘": "五色灵尘",
    # 如意丹 -> 如意丹
    "水如意丹": "如意丹", "金如意丹": "如意丹", "火如意丹": "如意丹",
    "木如意丹": "如意丹", "土如意丹": "如意丹",
    # 元宵 -> 元宵
    "躲元宵": "元宵", "防元宵": "元宵", "法元宵": "元宵", "攻元宵": "元宵",
    "体元宵": "元宵", "速元宵": "元宵", "炼兽珍经": "修炼果",
    # 其他
    "变身卡": "变身卡", "变色卡": "变身卡", "垃圾高兽诀": "高级魔兽要诀",
    # 图册类（百炼精铁用图册）
    "100 百炼精铁": "图册", "110 百炼精铁": "图册", "120 百炼精铁": "图册",
    "130 百炼精铁": "图册", "140 百炼精铁": "图册", "150 百炼精铁": "图册",
    # 手镯书
    "100级手镯书": "灵饰书", "120级手镯书": "灵饰书", "140级手镯书": "灵饰书",
    "60级手镯书": "灵饰书", "80级手镯书": "灵饰书",
}

def find_icon_and_category(name):
    """根据API名称找图标"""
    icon_name = ICON_MAPPING.get(name, name)
    for folder in ICON_DIR.iterdir():
        if folder.is_dir():
            category = folder.name
            for f in folder.glob("*.png"):
                stem = f.stem
                # 精确匹配或前缀匹配（图标名前缀），避免部分字符误匹配
                if stem == icon_name or stem.startswith(icon_name + "_") or icon_name == stem:
                    return f"{category}/{f.name}", category
    for f in ICON_DIR.glob("*.png"):
        stem = f.stem
        if stem == icon_name or stem.startswith(icon_name + "_"):
            return f.name, "其他"
    return "", "其他"

def fetch_prices(server_name):
    try:
        resp = requests.get(API_URL, params={"serverName": server_name}, timeout=10, verify=False)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") == 200:
            api_data = data.get("data", {})
            price_details = api_data.get("priceDetails", [])
            price_date = price_details[0].get("date", "") if price_details else ""
            return api_data, price_date
    except Exception as e:
        print(f"获取{server_name}价格失败: {e}")
    return {}, ""

def load_history():
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except:
            pass
    return {}

def save_history(history):
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")

def sync_all_servers():
    history = load_history()
    result = {"servers": [], "skipped": [], "updated": []}

    for server in SERVERS:
        api_data, price_date = fetch_prices(server)
        if not api_data:
            result["servers"].append({"name": server, "status": "failed"})
            continue

        if price_date and price_date in history and server in history.get(price_date, {}):
            print(f"{server} 的 {price_date} 数据已存在，跳过")
            result["skipped"].append({"server": server, "date": price_date})
            result["servers"].append({"name": server, "status": "skipped", "date": price_date})
            continue

        price_details = api_data.get("priceDetails", [])
        prices = {}
        for item in price_details:
            label = item.get("label", "") or ""
            value = item.get("value", "") or ""
            if "卖" in label:
                continue
            clean_label = label.replace("(卖)", "").replace("（卖）", "").strip()
            try:
                prices[clean_label] = float(value)
            except:
                continue

        if price_date:
            if price_date not in history:
                history[price_date] = {}
            history[price_date][server] = prices

            # 保存金价数据
            yxb_data = api_data.get("yxbPrices", {})
            if yxb_data and yxb_data.get("yxbPrice"):
                history[price_date][f"{server}_yxb"] = {
                    "price": float(yxb_data.get("yxbPrice", 0)),
                    "upDown7": yxb_data.get("upDown7", ""),
                    "upDown1": yxb_data.get("upDown1", ""),
                    "date": yxb_data.get("date", "")
                }

            result["updated"].append({"server": server, "date": price_date, "count": len(prices)})
            result["servers"].append({"name": server, "status": "updated", "date": price_date, "count": len(prices)})
            print(f"{server} {price_date} 已更新 {len(prices)} 个物品")

    save_history(history)
    # 不再同步到记账数据，保持用户数据独立
    # sync_to_jizhang("梦幻西游")
    return result

def sync_to_jizhang(server_name="梦幻西游"):
    api_data, price_date = fetch_prices(server_name)
    price_details = api_data.get("priceDetails", [])
    if not price_details:
        print("未获取到价格数据")
        return 0

    existing = {"items": [], "server": ""}
    if DATA_FILE.exists():
        try:
            existing = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except:
            pass

    items = existing.get("items", [])
    count = 0

    for item in price_details:
        label = item.get("label", "") or ""
        value = item.get("value", "") or ""
        date = item.get("date", "") or ""

        if "卖" in label:
            continue

        clean_label = label.replace("(卖)", "").replace("（卖）", "").strip()

        try:
            price = float(value)
        except:
            continue

        icon_path, category = find_icon_and_category(clean_label)

        found = None
        for existing_item in items:
            if existing_item.get("name") == clean_label:
                found = existing_item
                break

        if date:
            parts = date.split("-")
            time_str = f"{int(parts[1])}/{int(parts[2])}" if len(parts) == 3 else date
        else:
            now = datetime.now()
            time_str = f"{now.month}/{now.day}"

        if found:
            found["buyPrice"] = price
            found["time"] = time_str
            if icon_path and not found.get("icon"):
                found["icon"] = icon_path
            if category and category != "其他":
                found["category"] = category
        else:
            max_id = max([i.get("id", 0) for i in items], default=0) + 1
            items.append({
                "id": max_id, "name": clean_label, "buyPrice": price, "sellPrice": None,
                "category": category, "icon": icon_path, "server": server_name, "time": time_str
            })
        count += 1

    existing["items"] = items
    existing["server"] = server_name
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"记账本同步完成，共 {count} 个物品")
    return count

def get_market_prices():
    """获取各服务器最新价格（不要求同一天）"""
    history = load_history()
    if not history:
        return {}

    result = {"servers": {}}
    for server in SERVERS:
        # 找该服务器的最新数据
        for date in sorted(history.keys(), reverse=True):
            if server in history.get(date, {}):
                server_data = {
                    "date": date,
                    "prices": history[date][server]
                }
                # 附带金价数据
                yxb_key = f"{server}_yxb"
                if yxb_key in history.get(date, {}):
                    server_data["yxb"] = history[date][yxb_key]
                result["servers"][server] = server_data
                break

    return result

def get_trends(item_name=None):
    history = load_history()
    if len(history) < 2:
        return {"trends": {}, "message": "历史数据不足"}
    dates = sorted(history.keys())
    latest_date, prev_date = dates[-1], dates[-2]
    trends = {}
    for server in SERVERS:
        latest_prices = history.get(latest_date, {}).get(server, {})
        prev_prices = history.get(prev_date, {}).get(server, {})
        for name, price in latest_prices.items():
            if item_name and name != item_name:
                continue
            prev_price = prev_prices.get(name)
            if prev_price:
                change = ((price - prev_price) / prev_price) * 100
                if name not in trends:
                    trends[name] = {}
                trends[name][server] = {"price": price, "prevPrice": prev_price, "change": round(change, 1)}
    return {"latest_date": latest_date, "prev_date": prev_date, "trends": trends}

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "all":
        result = sync_all_servers()
        print(f"\n同步结果: {json.dumps(result, ensure_ascii=False, indent=2)}")
    else:
        server = sys.argv[1] if len(sys.argv) > 1 else "梦幻西游"
        sync_to_jizhang(server)