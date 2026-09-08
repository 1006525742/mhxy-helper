#!/usr/bin/env python3
"""怪物数据同步脚本 - 将数据和图片下载到本地"""
import json
import httpx
from pathlib import Path
import asyncio

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
IMAGES_DIR = BASE_DIR / "static" / "images" / "monsters"

# 确保目录存在
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

API_BASE = "https://api.xyq2.com/index.php"

async def fetch_api(module: str, action: str, params: dict = None):
    """调用API"""
    url = f"{API_BASE}/{module}/{action}"
    default_params = {"token": "", "headers_provider": "weixin", "is_mobile": "1"}
    if params:
        default_params.update(params)

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        resp = await client.get(url, params=default_params)
        return json.loads(resp.content.decode('utf-8'))

async def download_image(url: str, filename: str):
    """下载图片"""
    if not url:
        return

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                image_path = IMAGES_DIR / filename
                image_path.write_bytes(resp.content)
                print(f"[OK] 下载图片: {filename}")
                return str(image_path.relative_to(BASE_DIR / "static"))
    except Exception as e:
        print(f"[FAIL] 图片下载失败: {url} - {e}")
    return None

async def sync_monsters():
    """同步所有怪物数据"""
    print("=" * 50)
    print("开始同步怪物数据...")
    print("=" * 50)

    # 1. 获取怪物列表
    print("\n[1] 获取怪物列表...")
    list_result = await fetch_api("content_font/monster", "listall")

    if list_result.get("code") != 1:
        print("获取列表失败!")
        return

    monsters = list_result["data"]["list"]
    checkpoint_list = list_result["data"]["checkpoint_list"]
    checkpoint_data_list = list_result["data"]["checkpoint_data_list"]

    print(f"找到 {len(monsters)} 个怪物")

    # 2. 获取每个怪物的详情并下载图片
    print("\n[2] 获取详情并下载图片...")
    monsters_detail = []

    for i, m in enumerate(monsters):
        monster_id = m["id"]
        print(f"\n处理怪物 [{i+1}/{len(monsters)}] ID={monster_id} {m['title']}")

        # 获取详情
        detail_result = await fetch_api("content_font/monster", "detail", {"id": monster_id})

        if detail_result.get("code") == 1:
            info = detail_result["data"]["info"]
            peculiarity_list = detail_result["data"]["peculiarity_list"]
            video_url = detail_result["data"].get("ay_PlayURL") or info.get("video_id")

            # 下载图片
            image_url = info.get("image")
            if image_url:
                # 从URL提取文件名
                original_filename = image_url.split("/")[-1]
                local_filename = f"monster_{monster_id}_{original_filename}"
                local_path = await download_image(image_url, local_filename)

                if local_path:
                    info["image_local"] = f"/static/{local_path}"

            monsters_detail.append({
                "info": info,
                "peculiarity_list": peculiarity_list,
                "video_url": video_url
            })
        else:
            # 详情获取失败，使用列表数据
            monsters_detail.append({
                "info": m,
                "peculiarity_list": [],
                "video_url": ""
            })

        # 避免请求过快
        await asyncio.sleep(0.2)

    # 3. 保存数据到本地JSON
    print("\n[3] 保存数据到本地...")

    local_data = {
        "list": monsters,
        "checkpoint_list": checkpoint_list,
        "checkpoint_data_list": checkpoint_data_list,
        "monsters_detail": monsters_detail,
        "sync_time": str(Path(__file__).stat().st_mtime if Path(__file__).exists() else "")
    }

    data_file = DATA_DIR / "monsters.json"
    data_file.write_text(json.dumps(local_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] 数据保存到: {data_file}")

    # 统计
    images_count = len(list(IMAGES_DIR.glob("*")))
    print("\n" + "=" * 50)
    print("同步完成!")
    print(f"怪物数量: {len(monsters)}")
    print(f"详情数量: {len(monsters_detail)}")
    print(f"图片数量: {images_count}")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(sync_monsters())