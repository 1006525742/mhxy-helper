#!/usr/bin/env python3
"""一次性补下载：把已入库但缺少 local_thumb 的物品缩略图抓到本机 thumbs/。

按缩略图 URL 哈希命名，相同 URL（同款物品）只存一份。
"""
import hashlib
import sqlite3
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / "data" / "cbg.db"
THUMBS = BASE / "thumbs"
THUMBS.mkdir(parents=True, exist_ok=True)


def download(thumb_url):
    try:
        req = urllib.request.Request(
            thumb_url,
            headers={
                "Referer": "https://xyq.cbg.163.com/",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read()
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            ext = "png"
        elif data[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif data[:6] in (b"GIF87a", b"GIF89a"):
            ext = "gif"
        else:
            ext = "img"
        h = hashlib.sha1(thumb_url.encode("utf-8")).hexdigest()[:16]
        fn = f"t_{h}.{ext}"
        (THUMBS / fn).write_bytes(data)
        return fn
    except Exception as e:
        print("  FAIL", thumb_url, e)
        return None


conn = sqlite3.connect(str(DB))
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT eid, thumb_url, local_thumb FROM captured_item WHERE thumb_url IS NOT NULL"
).fetchall()
# 按 URL 去重：相同 URL 只抓一次，所有引用它的物品都指向同一文件
seen = {}
done = 0
for r in rows:
    url = r["thumb_url"]
    if url in seen:
        fn = seen[url]
    else:
        fn = download(url)
        seen[url] = fn
    if fn and fn != r["local_thumb"]:
        conn.execute("UPDATE captured_item SET local_thumb=? WHERE eid=?", (fn, r["eid"]))
        done += 1
        print("  OK", r["eid"], "->", fn)
conn.commit()
conn.close()
print(f"处理完成：{len(seen)} 个唯一图片，更新 {done} 条记录")

