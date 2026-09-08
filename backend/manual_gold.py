#!/usr/bin/env python3
"""手动更新区服金价（本地运维工具，不是 Web 接口，不会暴露给外网）。

用法:
    /usr/bin/python3 manual_gold.py 梦幻西游 218
    /usr/bin/python3 manual_gold.py 梦幻西游 218 紫禁之巅 225 金榜题名 220
    /usr/bin/python3 manual_gold.py 梦幻西游=218 紫禁之巅:225
    /usr/bin/python3 manual_gold.py --date 2026-08-29 梦幻西游 218   # 指定行情日期(默认今天)

说明:
    被手动更新的区服会写入 manual=true / manualPrice / manualDate，
    后端自动采集(每6小时)时只有上游行情日期比 manualDate 更新才会覆盖，否则保留手动值。
    若源站哪天恢复了更新(日期比手动日期新)，会自动改用源站值并清除 manual 标记。
"""
import json
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "gold_prices.json"
STALE_DAYS = 7  # 需与 backend_gold.py 的 STALE_DAYS 保持一致


def parse_pairs(args):
    """解析 区服/金价 对，支持 '区服 金价' / '区服=金价' / '区服:金价'"""
    pairs = []
    i = 0
    while i < len(args):
        s = args[i]
        if i + 1 < len(args):
            try:
                pairs.append((s, float(args[i + 1])))
                i += 2
                continue
            except ValueError:
                pass
        if "=" in s:
            k, v = s.split("=", 1)
            pairs.append((k.strip(), float(v)))
        elif ":" in s:
            k, v = s.split(":", 1)
            pairs.append((k.strip(), float(v)))
        else:
            print(f"错误: 无法解析参数 {s!r}（应为 区服 金价）")
            return None
        i += 1
    return pairs


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0

    man_date = None
    if args[0] == "--date":
        if len(args) < 2:
            print("错误: --date 后需要日期 (YYYY-MM-DD)")
            return 1
        man_date = args[1]
        args = args[2:]
        try:
            datetime.strptime(man_date, "%Y-%m-%d")
        except ValueError:
            print(f"错误: 日期格式应为 YYYY-MM-DD，收到 {man_date}")
            return 1

    pairs = parse_pairs(args)
    if not pairs:
        print("错误: 没有提供 区服 金价")
        return 1

    if not DATA_FILE.exists():
        print(f"错误: 数据文件不存在 {DATA_FILE}")
        return 1

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    eff_date = man_date or datetime.now().strftime("%Y-%m-%d")

    index = {r.get("server"): r for r in data.get("servers", [])}
    updated, missing = [], []
    for name, price in pairs:
        rec = index.get(name)
        if not rec:
            missing.append(name)
            continue
        was_stale = bool(rec.get("stale"))
        rec["manual"] = True
        rec["manualPrice"] = price
        rec["manualDate"] = eff_date
        rec["manualUpdatedAt"] = now
        rec["yxbPrice"] = price
        rec["date"] = eff_date
        try:
            dt = datetime.strptime(eff_date, "%Y-%m-%d").date()
            rec["ageDays"] = (datetime.now().date() - dt).days
            rec["stale"] = rec["ageDays"] > STALE_DAYS
        except Exception:
            rec["ageDays"], rec["stale"] = None, None
        if was_stale and not rec.get("stale"):
            data["staleCount"] = max(0, data.get("staleCount", 0) - 1)
            data["freshCount"] = data.get("freshCount", 0) + 1
        updated.append((name, price))

    if updated:
        data["updatedAt"] = now
        data["manualCount"] = sum(1 for r in data.get("servers", []) if r.get("manual"))
        DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"手动日期: {eff_date}")
    for name, price in updated:
        print(f"  ✓ {name} → {price:.2f} 万")
    for name in missing:
        print(f"  ✗ {name} 不在数据中(区服名不匹配)")
    print(f"手动标记区服总数: {data.get('manualCount', 0)}")
    return 0 if updated else 1


if __name__ == "__main__":
    sys.exit(main())
