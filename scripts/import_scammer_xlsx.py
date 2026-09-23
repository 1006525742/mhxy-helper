#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《疑似骗子名单.xlsx》清洗成骗子名单模块的结构化数据。

输出: backend/data/scammer.json
  {
    "updatedAt": "...",
    "notice": "...",
    "records": [ {...}, ... ],
    "rules": [ "..." ]      # 「商人」sheet 的群规说明
  }

用法:
    /usr/bin/python3 scripts/import_scammer_xlsx.py [xlsx路径]

注意:
  - 原表备注「红色是被多人说是骗子」，但实测 76 行里 73 行都是红色（整表默认样式），
    该标记已失效，因此风险等级改由「同 ID 重复举报 + 关键词（一直在骗/多人被骗）」推算。
  - 敏感字段（微信/微信号/提供人微信）单独落在 sensitive 子对象里，
    后端默认只回打码值，前端点「显示」时才单独请求明文。
"""
import os
import re
import sys
import json
import datetime
from collections import defaultdict

import openpyxl

XLSX = sys.argv[1] if len(sys.argv) > 1 else "/Users/zhy/Documents/疑似骗子名单(3).xlsx"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "backend", "data", "scammer.json")

# Excel 序列号日期基准（Windows 1900 系统，含闰年 bug 偏移）
EXCEL_EPOCH = datetime.datetime(1899, 12, 30)

HIGH_RISK_KEYWORDS = ["一直在骗", "多人被骗", "多人说", "圈钱跑路", "洗了我的号", "洗劫"]

PHONE_RE = re.compile(r"(?<!\d)(1[3-9]\d{9})(?!\d)")


def clean(v):
    """单元格值 -> 去噪后的字符串（None/空 -> ''）"""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).replace("\u2005", " ").replace("\xa0", " ").strip()
    return "" if s.lower() in ("none", "nan") else s


def parse_time(v):
    """把各种奇葩时间写法归一化成 (原始串, ISO日期串)"""
    raw = clean(v)
    if not raw:
        return "", ""

    # 1) Excel 日期序列号（45537 之类）
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 30000 < float(v) < 60000:
        try:
            d = EXCEL_EPOCH + datetime.timedelta(days=float(v))
            return raw, d.strftime("%Y-%m-%d")
        except Exception:
            return raw, ""

    # 2) 文本里抠 年/月/日
    m = re.search(r"(20\d{2})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})", raw)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return raw, f"{y:04d}-{mo:02d}-{d:02d}"

    # 3) 只有 月/日（默认按表内年份补全失败，留空 ISO）
    return raw, ""


def split_sensitive(detail):
    """从「骗人经过」里把手机号拎出来，正文里打码，避免明文躺在大段文本里"""
    if not detail:
        return detail, []
    phones = PHONE_RE.findall(detail)
    if phones:
        detail = PHONE_RE.sub(lambda m: m.group(1)[:3] + "****" + m.group(1)[-4:], detail)
    return detail, phones


def make_record(category, name, game_id, level, wechat, wechat_id, item,
                time_raw, reporter, reporter_wechat, detail, seq):
    detail, phones = split_sensitive(detail)
    _, time_iso = parse_time(time_raw)
    rec = {
        "id": f"{category}-{seq:03d}",
        "category": category,
        "name": clean(name),
        "gameId": clean(game_id),
        "level": clean(level),
        "type": clean(item),                 # 骗术 / 行为类型
        "time": clean(time_raw),             # 原始描述
        "timeISO": time_iso,                 # 归一化日期（可能为空）
        "reporter": clean(reporter),         # 提供人游戏昵称（公开）
        "detail": clean(detail),
        "sensitive": {                       # 敏感字段，后端默认返回打码值
            "wechat": clean(wechat),
            "wechatId": clean(wechat_id),
            "reporterWechat": clean(reporter_wechat),
            "phones": phones,
        },
        "source": "import",
        "verified": False,
        "risk": "normal",
        "createdAt": "",
    }
    return rec


def read_scammer_sheet(ws):
    """疑似骗子：A列='骗子帮派' 的行是帮派（列含义不同），其余是个人/队伍"""
    records, gangs = [], []
    seq = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        if all(c is None or str(c).strip() == "" for c in row):
            continue
        if clean(row[0]) == "骗子帮派":
            gangs.append({
                "id": f"gang-{len(gangs) + 1:03d}",
                "category": "gang",
                "name": clean(row[1]),             # 帮派名
                "gameId": "",
                "level": "",
                "type": clean(row[9]) or "不发奖励",  # J 列
                "time": "",
                "timeISO": "",
                "reporter": clean(row[8]),
                "detail": clean(row[10]),
                "sensitive": {"wechat": "", "wechatId": "", "reporterWechat": "", "phones": []},
                "extra": {
                    "gangNo": clean(row[2]),        # 54号帮
                    "leader": clean(row[3]),        # 帮主
                    "leaderInfo": clean(row[4]),
                    "vice": clean(row[6]),          # 副帮
                    "viceInfo": clean(row[7]),
                },
                "source": "import",
                "verified": False,
                "risk": "high",
                "createdAt": "",
            })
            continue
        # 有些记录只有微信没有游戏名/ID（例如「洗了我的号」那条），不能丢
        if not any(clean(c) for c in (row[1], row[2], row[4], row[5])):
            continue
        seq += 1
        # 名字为空时用微信号兜底，保证列表里能显示一条
        name = clean(row[1]) or clean(row[4]) or clean(row[5]) or "(未提供昵称)"
        records.append(make_record(
            "scammer", name, row[2], row[3], row[4], row[5],
            row[6], row[7], row[8], row[9], row[10], seq,
        ))
    return records, gangs


def read_afk_sheet(ws):
    """挂机不看号：A=名字 B=ID C=等级 D=场景(对应 type) E=时间 F=经过"""
    out = []
    seq = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        if not clean(row[0]) and not clean(row[1]):
            continue
        seq += 1
        out.append(make_record(
            "afk", row[0], row[1], row[2], "", "",
            row[3], row[4], "", "", row[5], seq,
        ))
    return out


def read_blacklist_sheet(ws):
    """黑名单：A=名字 B=ID C=等级 D=事项 E=时间 F=经过"""
    out = []
    seq = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not clean(row[0]) and not clean(row[1]):
            continue
        seq += 1
        out.append(make_record(
            "blacklist", row[0], row[1], row[2], "", "",
            row[3], row[4], "", "", row[5], seq,
        ))
    return out


def read_rules_sheet(ws):
    """商人：不是名单，是散人交流群的收售规则说明"""
    rules = []
    for row in ws.iter_rows(values_only=True):
        cells = [clean(c) for c in row if clean(c)]
        if len(cells) >= 2:
            rules.append({"k": cells[0], "v": " ".join(cells[1:])})
        elif len(cells) == 1 and clean(row[1]) is not None:
            pass
    # 首行是群名标题
    return rules


def mark_risk(records):
    """风险等级：同一游戏 ID/名字被多次举报，或经过里出现高危关键词 → high"""
    by_id, by_name = defaultdict(int), defaultdict(int)
    for r in records:
        if r["gameId"]:
            by_id[r["gameId"]] += 1
        if r["name"]:
            by_name[r["name"]] += 1
    for r in records:
        dup = (r["gameId"] and by_id[r["gameId"]] > 1) or (r["name"] and by_name[r["name"]] > 1)
        hit = any(k in (r["detail"] or "") for k in HIGH_RISK_KEYWORDS)
        if dup or hit:
            r["risk"] = "high"
    return records


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    print("sheets:", wb.sheetnames)

    scammers, gangs = read_scammer_sheet(wb["疑似骗子"])
    afk = read_afk_sheet(wb["挂机不看号"])
    black = read_blacklist_sheet(wb["黑名单"])
    rules = read_rules_sheet(wb["商人"])

    records = mark_risk(gangs + scammers + afk + black)

    notice = ("名单来自玩家自发举报，仅作组队/交易前风险提示，不构成对任何人的定性结论。"
              "骗子会改名字，请务必核对曾用名与游戏 ID；线下交易风险自负。"
              "发现骗子请联系：Sims_88888")

    data = {
        "updatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "notice": notice,
        "rules": rules,
        "records": records,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    stat = defaultdict(int)
    for r in records:
        stat[r["category"]] += 1
    high = sum(1 for r in records if r["risk"] == "high")
    print(f"写入 {OUT}")
    print("分类统计:", dict(stat))
    print(f"高风险(重复举报/关键词命中): {high} 条")
    print(f"总记录: {len(records)} 条，群规 {len(rules)} 条")


if __name__ == "__main__":
    main()
