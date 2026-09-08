#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成藏宝阁服务器开服时间/服龄映射表 cbg_server_ages.json。

数据源：
  1. 官方开服时间表（老服，GBK）：
     https://xyq.163.com/skill/2012/11/13/4895_349629.html
  2. 第三方新服开服表（2016-2026 新服，UTF-8）：
     https://m.mshouyou.com/xinqu/mhxy.html
  3. 藏宝阁服务器列表（server_id 递增，与开服时间强正相关）：
     https://cbg-xyq.res.netease.com/js/server_list_data.js

策略：
  1. 服务器名精确匹配官方表(老服) + 第三方表(新服) -> 精确开服日期
  2. 撞名(大雁塔: 官方2003老服 vs 第三方畅玩服2025)按 server_id 区分
  3. 未匹配的用 server_id 相邻锚点线性插值(剔除合服异常锚点: 城隍庙/华夏)
  4. 按开服日期分三档: old(3年以上) / mid(1-3年) / new(1年内)
     边界: 3年=2023-08-20, 1年=2025-08-20

输出: 前端 public/cbg_server_ages.json
  { "<server_id>": {"name": "...", "date": "YYYY-MM-DD", "age": "old|mid|new", "source": "official|third|interp"} }
"""
import json
import re
import sys
from datetime import date, datetime

try:
    import requests
except ImportError:
    print('需要 requests: pip install requests', file=sys.stderr)
    sys.exit(1)

OFFICIAL_URL = 'https://xyq.163.com/skill/2012/11/13/4895_349629.html'
THIRD_URL = 'https://m.mshouyou.com/xinqu/mhxy.html'
SERVER_LIST_URL = 'https://cbg-xyq.res.netease.com/js/server_list_data.js'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}


def fetch(url, binary=False):
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    if binary:
        return r.content
    # 显式按 UTF-8 解码（部分源未返回 charset，requests 会误判为 ISO-8859-1）
    r.encoding = 'utf-8'
    return r.text


def strip_tags(html):
    t = re.sub(r'<[^>]+>', ' ', html)
    t = re.sub(r'&nbsp;|&#160;', ' ', t)
    return re.sub(r'\s+', ' ', t)


def parse_official(html_bytes):
    """官方开服表：大区 服务器 2008-05-09-12:00 -> {name: date}"""
    s = html_bytes.decode('gbk', errors='ignore')
    text = strip_tags(s)
    out = {}
    for name, d in re.findall(r'([\u4e00-\u9fa5]{2,8})\s+(\d{4}-\d{2}-\d{2})-\d{1,2}:\d{2}', text):
        out.setdefault(name, d)
    return out


def parse_third(html):
    """第三方新服表：大区【服务器】 2024年4月24日 -> {name: date}"""
    text = strip_tags(html)
    out = {}
    for _area, srv, y, m, d in re.findall(
        r'([\u4e00-\u9fa5]{2,8})【([\u4e00-\u9fa5]{2,8})】\s*(\d{4})年(\d{1,2})月(\d{1,2})日', text):
        out.setdefault(srv, f'{y}-{int(m):02d}-{int(d):02d}')
    return out


def parse_server_list(js_text):
    """藏宝阁 server_list_data.js -> [(server_id, name, area_name)]"""
    m = re.search(r'server_data\s*=\s*(\{.*\})\s*;?\s*$', js_text, re.S)
    data = json.loads(m.group(1))
    servers = []
    for area_id, area in data.items():
        area_name = area[0][0]
        for sv in area[1]:
            servers.append((int(sv[0]), sv[1], area_name))
    return servers


def classify_age(d):
    if d < '2023-08-20':
        return 'old'   # 3年以上
    if d < '2025-08-20':
        return 'mid'   # 1到3年
    return 'new'       # 1年内


def main():
    print('抓取数据源...')
    official = parse_official(fetch(OFFICIAL_URL, binary=True))
    third = parse_third(fetch(THIRD_URL))
    server_list = parse_server_list(fetch(SERVER_LIST_URL))
    print(f'  官方表 {len(official)} 条，第三方表 {len(third)} 条，藏宝阁服务器 {len(server_list)} 个')

    # 撞名冲突检测
    conflicts = [n for n in set(official) & set(third)
                 if abs(int(official[n][:4]) - int(third[n][:4])) > 1]
    print(f'  撞名(日期差>1年): {conflicts}')

    # 精确匹配 + 记录 source
    rows = []  # dict(id, name, area, date, source)
    for sid, name, area in server_list:
        d = None
        src = None
        # 撞名特殊处理：大雁塔 官方2003 优先(老服)；其余名字官方优先
        if name in official and name in third:
            # 按 server_id 判断：id<900 大概率老服用官方，否则用第三方
            if sid < 900:
                d, src = official[name], 'official'
            else:
                d, src = third[name], 'third'
        elif name in official:
            d, src = official[name], 'official'
        elif name in third:
            d, src = third[name], 'third'
        rows.append({'id': sid, 'name': name, 'area': area, 'date': d, 'source': src})

    # 插值：正常锚点 = 精确匹配且排除合服异常(大id但老日期)
    def is_normal(r):
        return r['date'] is not None and not (r['id'] >= 900 and r['date'] < '2015-01-01')

    anchors = sorted([(r['id'], r['date']) for r in rows if is_normal(r)])
    removed = sum(1 for r in rows if r['date'] and not is_normal(r))
    print(f'  精确锚点 {len(anchors)} 个，剔除合服异常 {removed} 个')

    def interp(sid):
        left = right = None
        for kid, kd in anchors:
            if kid <= sid:
                left = (kid, kd)
            if kid >= sid and right is None:
                right = (kid, kd)
        if left and right and left[0] != right[0]:
            yl = datetime.strptime(left[1], '%Y-%m-%d').toordinal()
            yr = datetime.strptime(right[1], '%Y-%m-%d').toordinal()
            return date.fromordinal(int(round(yl + (yr - yl) * (sid - left[0]) / (right[0] - left[0])))).isoformat()
        return left[1] if left else (right[1] if right else None)

    # 补插值 + 分档
    from collections import Counter
    # 重复 server_id（合服导致）：同一 id 多个名字，取「最新开服时间」作为该服的服龄
    # （合服后藏宝阁以合并后服务器为准，开服时间取较新者）
    by_id = {}
    for r in rows:
        if r['date'] is None:
            r['date'] = interp(r['id'])
            r['source'] = 'interp'
        key = str(r['id'])
        if key not in by_id or r['date'] > by_id[key]['date']:
            by_id[key] = r

    result = {}
    for key, r in by_id.items():
        result[key] = {
            'name': r['name'],
            'area': r['area'],
            'date': r['date'],
            'age': classify_age(r['date']),
            'source': r['source'],
        }

    src_cnt = Counter(v['source'] for v in result.values())
    age_cnt = Counter(v['age'] for v in result.values())
    print(f'  来源分布: {dict(src_cnt)}')
    print(f'  三档分布: {dict(age_cnt)}')

    out_path = sys.argv[1] if len(sys.argv) > 1 else \
        '/Users/zhy/mhxy-helper/frontend/public/cbg_server_ages.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f'已写入 {out_path}（{len(result)} 个服务器）')


if __name__ == '__main__':
    main()
