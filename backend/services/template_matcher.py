#!/usr/bin/env python3
"""坐标识别模块 - 整合 menghuan_ocr 的模板匹配方案（性能优化版）

核心思路（来自 menghuan_ocr）：
1. 通过 HSV 颜色过滤提取坐标文本区域（黄色文字）
2. 用模板匹配识别地图名称（傲来国、宝象国等）
3. 用数字模板匹配识别坐标数字（0-9）
4. 用分隔符模板（dh=逗号）区分 x 和 y 坐标

模板来源：https://github.com/yuanci1996/menghuan_ocr

性能优化：
1. 精简缩放比例列表（从19个减少到8个常用比例）
2. 缓存缩放后的图像，避免重复计算
3. 优化匹配顺序，优先匹配高概率缩放
4. 减少不必要的图像拷贝
"""
import os
import cv2
import numpy as np
import logging
from pathlib import Path
from functools import lru_cache

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent  # backend 目录
TEMPLATE_DIR = BASE_DIR / "data" / "templates"

# 地图名称缩写 -> 全名 的映射
MAP_KEYS = [
    ('傲来国', 'alg'),
    ('宝象国', 'bxg'),
    ('长寿村', 'csc'),
    ('大唐境外', 'dtjw'),
    ('东海湾', 'dhw'),
    ('建邺城', 'jyc'),
    ('江南野外', 'jnyw'),
    ('女儿村', 'nec'),
    ('普陀山', 'pts'),
    ('五庄观', 'wzg'),
    ('西凉女国', 'xlng'),
    ('朱紫国', 'zzg'),
]

# 缩放比例（根据实测：15px文字 + 50px模板 = 3.3x理论值，实测4.0x最佳）
OPTIMIZED_SCALES = [4.0]
EXTENDED_SCALES = [4.0]
FAST_SCALES = [4.0]

# 默认缩放比例（放大截图去匹配模板）- 保留向后兼容
DEFAULT_SCALES = OPTIMIZED_SCALES


def safe_int(value, default=None):
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


# 全局模板缓存
_template_cache = {}

# 缓存成功匹配的 scale，下次优先尝试
# key: 模板名称 (如 "朱紫国", "数字0") -> scale
# 预初始化默认值，第一次匹配就能直接用最优 scale
_scale_cache = {
    # 地图名称
    "傲来国": 8.0,
    "宝象国": 8.0,
    "长寿村": 8.0,
    "大唐境外": 8.0,
    "东海湾": 8.0,
    "建邺城": 8.0,
    "江南野外": 8.0,
    "女儿村": 8.0,
    "普陀山": 8.0,
    "五庄观": 8.0,
    "西凉女国": 8.0,
    "朱紫国": 8.0,
    # 数字
    "数字0": 8.0,
    "数字1": 8.0,
    "数字2": 8.0,
    "数字3": 8.0,
    "数字4": 8.0,
    "数字5": 8.0,
    "数字6": 8.0,
    "数字7": 8.0,
    "数字8": 8.0,
    "数字9": 8.0,
    "数字dh": 8.0,
}

def clear_caches():
    """清空所有缓存（字体变化后调用）"""
    global _template_cache, _scale_cache
    _template_cache = {}
    _scale_cache = {}
    print("[模板匹配] 已清空模板缓存和scale缓存")

def _load_template(template_path):
    """加载模板并缓存"""
    if template_path not in _template_cache:
        template = cv2.imread(str(template_path), cv2.IMREAD_GRAYSCALE)
        if template is not None:
            _template_cache[template_path] = template
        else:
            return None
    return _template_cache.get(template_path)


def pyramid_template_matching(image, template, scales=None, threshold=0.8, proximity_threshold=5, debug_name="", fast_mode=False):
    """多尺度金字塔模板匹配（性能优化版）

    Args:
        image: 待匹配的灰度图
        template: 模板灰度图
        scales: 缩放因子列表
        threshold: 匹配阈值（0~1）
        proximity_threshold: 去重距离阈值（像素）
        debug_name: 调试用的模板名称
        fast_mode: 快速模式，只尝试最常用的缩放比例

    Returns:
        list: [(位置, 尺寸, 缩放比例, 匹配分数), ...]
    """
    import time
    t_start = time.time()

    # 快速模式：只尝试最常用的缩放比例
    if fast_mode:
        scales = FAST_SCALES
    elif scales is None:
        scales = OPTIMIZED_SCALES

    # 如果有缓存的 scale，优先尝试
    if debug_name and debug_name in _scale_cache:
        cached_scale = _scale_cache[debug_name]
        # 把缓存的 scale 放到最前面
        scales = [cached_scale] + [s for s in scales if s != cached_scale]

    matched_objects = []

    # 计算最小需要的缩放比例
    img_h, img_w = image.shape[:2]
    tmpl_h, tmpl_w = template.shape[:2]
    min_scale_h = tmpl_h / img_h if img_h > 0 else 1
    min_scale_w = tmpl_w / img_w if img_w > 0 else 1
    min_scale = max(min_scale_h, min_scale_w)

    valid_scales = [s for s in scales if s >= min_scale]
    valid_scales.sort(reverse=True)

    match_count = 0
    for scale in valid_scales:
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)

        if new_h < tmpl_h or new_w < tmpl_w:
            continue

        t_resize_start = time.time()
        resized_image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        t_resize_end = time.time()

        t_match_start = time.time()
        result = cv2.matchTemplate(resized_image, template, cv2.TM_CCOEFF_NORMED)
        t_match_end = time.time()

        match_count += 1

        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

        if max_val >= threshold:
            original_loc = (int(max_loc[0] / scale), int(max_loc[1] / scale))
            original_size = (int(tmpl_w / scale), int(tmpl_h / scale))

            matched_objects.append((
                original_loc,
                original_size,
                scale,
                float(max_val)
            ))

            # 缓存成功的 scale，下次优先使用
            if debug_name:
                _scale_cache[debug_name] = scale

            t_total = time.time() - t_start
            cached_marker = " (缓存命中)" if valid_scales[0] == scale and debug_name in _scale_cache else ""
            print(f"  [模板匹配] {debug_name}: 匹配成功! scale={scale:.1f}, score={max_val:.2f}, "
                  f"尝试{match_count}次, 总耗时{t_total*1000:.1f}ms{cached_marker}")
            return matched_objects

    t_total = time.time() - t_start
    # 只在非快速模式或耗时较长时打印失败日志
    if not fast_mode or t_total > 50:
        print(f"  [模板匹配] {debug_name}: 未匹配, 尝试{match_count}次, 耗时{t_total*1000:.1f}ms")

    return matched_objects


def pyramid_template_matching_all(image, template, scales=None, threshold=0.8, proximity_threshold=5, debug_name=""):
    """多尺度金字塔模板匹配（返回所有匹配结果，用于数字匹配）

    Args:
        image: 待匹配的灰度图
        template: 模板灰度图
        scales: 缩放因子列表
        threshold: 匹配阈值（0~1）
        proximity_threshold: 去重距离阈值（像素）
        debug_name: 调试用的模板名称

    Returns:
        list: [(位置, 尺寸, 缩放比例, 匹配分数), ...]
    """
    import time
    t_start = time.time()

    if scales is None:
        scales = OPTIMIZED_SCALES

    matched_objects = []
    matched_locations = np.empty((0, 2), dtype=int)

    img_h, img_w = image.shape[:2]
    tmpl_h, tmpl_w = template.shape[:2]
    min_scale_h = tmpl_h / img_h if img_h > 0 else 1
    min_scale_w = tmpl_w / img_w if img_w > 0 else 1
    min_scale = max(min_scale_h, min_scale_w)

    valid_scales = [s for s in scales if s >= min_scale]
    valid_scales.sort(reverse=True)

    for scale in valid_scales:
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)

        if new_h < tmpl_h or new_w < tmpl_w:
            continue

        resized_image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        result = cv2.matchTemplate(resized_image, template, cv2.TM_CCOEFF_NORMED)
        locations = np.where(result >= threshold)

        for loc in zip(*locations[::-1]):
            original_loc = (int(loc[0] / scale), int(loc[1] / scale))

            # 去重：检查是否与已有匹配位置过近
            if len(matched_locations) > 0:
                diff = np.abs(matched_locations - original_loc)
                if np.all(diff <= proximity_threshold, axis=1).any():
                    continue

            matched_objects.append((
                original_loc,
                (int(tmpl_w / scale), int(tmpl_h / scale)),
                scale,
                float(result[loc[1], loc[0]])
            ))
            matched_locations = np.vstack([matched_locations, np.array([original_loc])])

        # 找到匹配后立即停止
        if len(matched_objects) > 0:
            break

    t_total = time.time() - t_start
    if matched_objects:
        print(f"  [模板匹配] {debug_name}: 找到{len(matched_objects)}个匹配, 耗时{t_total*1000:.1f}ms")
    else:
        print(f"  [模板匹配] {debug_name}: 未匹配, 耗时{t_total*1000:.1f}ms")

    return matched_objects


def get_yellow_text_mask(image, colorblind_mode=1):
    """通过 HSV 颜色过滤提取文字区域

    Args:
        image: BGR图像
        colorblind_mode: 1=黄色模式, 2=红色模式, 3=绿色模式

    Returns:
        二值化掩码图像
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    if colorblind_mode == 1:
        # 黄色（放宽阈值以适应屏幕共享失真）
        mask1 = cv2.inRange(hsv, np.array([20, 30, 120]), np.array([35, 255, 255]))
        # 扩大黄色范围（偏亮黄）
        mask2 = cv2.inRange(hsv, np.array([35, 30, 180]), np.array([45, 255, 255]))
        return cv2.bitwise_or(mask1, mask2)
    elif colorblind_mode == 2:
        # 红色
        return cv2.inRange(hsv, np.array([170, 100, 100]), np.array([180, 255, 255]))
    else:
        # 绿色 (H范围35-85，放宽阈值)
        return cv2.inRange(hsv, np.array([30, 40, 80]), np.array([90, 255, 255]))


def recognize_coord_from_image(image, scales=None, threshold=0.7):
    """从任务栏截图识别坐标（性能优化版）

    优化措施：
    1. 使用模板缓存，避免重复读取文件
    2. 使用优化的金字塔匹配函数
    3. 减少不必要的图像拷贝

    Args:
        image: BGR 图像（通常是任务栏截图区域）
        scales: 缩放因子列表
        threshold: 匹配阈值（默认0.7，云版本可降低到0.6提高容错）

    Returns:
        tuple: (地图名, x坐标, y坐标)
    """
    if scales is None:
        scales = OPTIMIZED_SCALES

    # 如果截图太大，先缩小到合理尺寸
    h, w = image.shape[:2]
    if h > 300:
        scale_factor = 300.0 / h
        image = cv2.resize(image, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_AREA)
        logger.debug(f"截图缩小: {w}x{h} -> {image.shape[1]}x{image.shape[0]}")

    # 尝试不同颜色模式（黄色、绿色）
    for color_mode in [1, 3]:
        # 1. 提取文字区域
        mask = get_yellow_text_mask(image, colorblind_mode=color_mode)
        gray = mask

        color_name = "黄色" if color_mode == 1 else "绿色"
        logger.debug(f"尝试{color_name}模式检测")

        # 2. 先尝试匹配【坐标】标签定位坐标行
        zuobiao_location = None
        zuobiao_path = TEMPLATE_DIR / "zuobiao.png"
        zuobiao_template = _load_template(zuobiao_path)
        if zuobiao_template is not None:
            matched = pyramid_template_matching(gray, zuobiao_template, scales=scales, threshold=0.7)
            if matched:
                (x, y), (w, h), _, _ = matched[0]
                zuobiao_location = [x, y, w, h]
                logger.debug(f"匹配到【坐标】标签, 位置: ({x},{y})")

        # 3. 匹配地图名称（先用快速模式，失败再用完整模式）
        map_location = None
        print(f"[开始匹配地图名称]")

        # 第一轮：快速模式，只尝试最常用的缩放比例
        for map_name, map_key in MAP_KEYS:
            template_path = TEMPLATE_DIR / f"{map_key}.png"
            template = _load_template(template_path)
            if template is None:
                continue

            matched = pyramid_template_matching(gray, template, scales=scales, threshold=0.7, debug_name=map_name, fast_mode=True)
            if matched:
                (x, y), (w, h), _, _ = matched[0]
                map_location = [x, y, w, h, map_name]
                logger.debug(f"匹配到地图: {map_name}, 位置: ({x},{y})")
                break

        # 第二轮：如果快速模式失败，再用完整模式
        if map_location is None:
            print(f"[快速匹配失败，尝试完整匹配]")
            for map_name, map_key in MAP_KEYS:
                template_path = TEMPLATE_DIR / f"{map_key}.png"
                template = _load_template(template_path)
                if template is None:
                    continue

                matched = pyramid_template_matching(gray, template, scales=EXTENDED_SCALES, threshold=0.7, debug_name=map_name)
                if matched:
                    (x, y), (w, h), _, _ = matched[0]
                    map_location = [x, y, w, h, map_name]
                    logger.debug(f"匹配到地图: {map_name}, 位置: ({x},{y})")
                    break

        # 如果匹配到地图，跳出颜色循环
        if map_location:
            break

    if map_location is None:
        logger.debug("未匹配到地图名称")
        return '', 0, 0

    # 4. 匹配数字和分隔符
    gray_cleared = gray.copy()

    if zuobiao_location:
        # 宝图弹窗模式
        gray_cleared[map_location[1]:map_location[1] + map_location[3],
                     map_location[0]:map_location[0] + map_location[2]] = 0
        gray_cleared[zuobiao_location[1]:zuobiao_location[1] + zuobiao_location[3],
                     zuobiao_location[0]:zuobiao_location[0] + zuobiao_location[2]] = 0
        row_top = max(0, zuobiao_location[1] - 5)
        row_bottom = min(gray_cleared.shape[0], zuobiao_location[1] + zuobiao_location[3] + 20)
        row_image = gray_cleared[row_top:row_bottom, :]
        x_offset = 0
    else:
        # 任务栏模式
        gray_cleared[map_location[1]:map_location[1] + map_location[3] * 2,
                     map_location[0]:map_location[0] + map_location[2]] = 0
        row_top = max(0, map_location[1] - 5)
        row_bottom = min(gray_cleared.shape[0], map_location[1] + map_location[3] + 5)
        row_image = gray_cleared[row_top:row_bottom, :]
        x_offset = map_location[0]

    # 匹配数字（统一阈值0.8，参考原项目）
    print(f"[开始匹配数字]")
    num_locations = []  # (x, y, key)
    for i in ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'dh']:
        template_path = TEMPLATE_DIR / f"{i}.png"
        template = _load_template(template_path)
        if template is None:
            continue

        matched = pyramid_template_matching_all(row_image, template, scales=OPTIMIZED_SCALES, threshold=0.8, debug_name=f"数字{i}")
        if matched:
            for matched_object in matched:
                (x, y), (w, h), _, _ = matched_object
                num_locations.append((x + x_offset, y, i))

    if not num_locations:
        logger.debug("未匹配到数字")
        return map_location[4], 0, 0

    # 5. 先找逗号位置
    dh_positions = [(x, y) for (x, y, key) in num_locations if key == 'dh']

    if not dh_positions:
        logger.debug("未找到逗号分隔符")
        return map_location[4], 0, 0

    # 6. 按x位置排序并解析坐标（不再过滤距离）
    sorted_data = sorted(num_locations, key=lambda item: item[0])

    split_index = next((i for i, (x, y, key) in enumerate(sorted_data) if key == 'dh'), None)

    if split_index is not None:
        part1 = sorted_data[:split_index]
        part2 = sorted_data[split_index + 1:]
    else:
        part1 = sorted_data
        part2 = []

    location_x = ''.join([key for (x, y, key) in part1])
    location_y_raw = ''.join([key for (x, y, key) in part2])

    # Y坐标部分如果包含逗号，只取逗号后面的数字部分
    if 'dh' in location_y_raw:
        # 取最后一个逗号后面的内容
        location_y = location_y_raw.split('dh')[-1]
    else:
        location_y = location_y_raw

    x_val = safe_int(location_x, 0)
    y_val = safe_int(location_y, 0)

    logger.info(f"模板匹配结果: 地图={map_location[4]}, x={location_x}({x_val}), y={location_y}({y_val})")
    return map_location[4], x_val, y_val


def recognize_coord_from_popup(img, x1, y1, x2, y2, scales=None):
    """从 YOLO 检测到的 coord_popup 区域识别坐标（性能优化版）

    与 recognize_coord_from_image 不同，这个函数处理的是宝图弹窗中的坐标文本。

    Args:
        img: BGR 全屏图像
        x1, y1, x2, y2: coord_popup 检测区域坐标
        scales: 缩放因子列表

    Returns:
        dict: {"map": 地图名, "x": x坐标, "y": y坐标, "raw": 原始文本} 或 None
    """
    if scales is None:
        scales = OPTIMIZED_SCALES

    # 裁剪弹窗区域
    popup = img[int(y1):int(y2), int(x1):int(x2)]
    if popup.size == 0:
        return None

    popup_h, popup_w = popup.shape[:2]
    logger.debug(f"coord_popup 尺寸: {popup_w}x{popup_h}")

    # 尝试方案1：直接在弹窗区域用 HSV 过滤 + 模板匹配
    mask = get_yellow_text_mask(popup)
    result_v1 = _match_coord_in_mask(mask, scales)

    if result_v1 and result_v1[0]:
        map_name, x_val, y_val = result_v1
        return {"map": map_name, "x": x_val, "y": y_val, "method": "template_hsv"}

    # 方案2：如果弹窗区域太小，尝试在原图更大区域匹配
    expanded_y2 = min(int(y2) + 80, img.shape[0])
    expanded = img[int(y1):expanded_y2, int(x1):int(x2)]
    if expanded.size > 0:
        mask2 = get_yellow_text_mask(expanded)
        result_v2 = _match_coord_in_mask(mask2, scales)
        if result_v2 and result_v2[0]:
            map_name, x_val, y_val = result_v2
            return {"map": map_name, "x": x_val, "y": y_val, "method": "template_hsv_expanded"}

    # 方案3：使用灰度图直接匹配数字
    gray = cv2.cvtColor(popup, cv2.COLOR_BGR2GRAY)
    result_v3 = _match_digits_in_gray(gray, scales)
    if result_v3:
        return result_v3

    return None


def _match_coord_in_mask(mask, scales):
    """在 HSV 掩码图像中匹配地图名和数字坐标（性能优化版）

    Args:
        mask: 二值化掩码图
        scales: 缩放因子

    Returns:
        tuple: (地图名, x, y) 或 (None, None, None)
    """
    if scales is None:
        scales = OPTIMIZED_SCALES

    logger.debug(f"HSV mask 尺寸: {mask.shape}")

    # 匹配地图名称
    map_location = None
    for map_name, map_key in MAP_KEYS:
        template_path = TEMPLATE_DIR / f"{map_key}.png"
        template = _load_template(template_path)
        if template is None:
            continue

        matched = pyramid_template_matching(mask, template, scales=scales, threshold=0.5)
        if matched:
            (x, y), (w, h), _, _ = matched[0]
            map_location = [x, y, w, h, map_name]
            logger.debug(f"HSV mask匹配到地图: {map_name}, 位置: ({x},{y})")
            break

    if map_location is None:
        return None, None, None

    # 清除地图区域，匹配数字
    mask_cleared = mask.copy()
    y_top = max(0, map_location[1] - 5)
    y_bottom = min(mask_cleared.shape[0], map_location[1] + map_location[3] + 5)
    mask_cleared[map_location[1]:map_location[1] + map_location[3],
                 map_location[0]:map_location[0] + map_location[2]] = 0

    row_image = mask_cleared[y_top:y_bottom, :]

    num_locations = []
    for i in ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'dh']:
        template_path = TEMPLATE_DIR / f"{i}.png"
        template = _load_template(template_path)
        if template is None:
            continue

        matched = pyramid_template_matching_all(row_image, template, scales=scales, threshold=0.8)
        if matched:
            for m in matched:
                (x, y), (w, h), _, _ = m
                num_locations.append((x, i))

    if not num_locations:
        return map_location[4], 0, 0

    sorted_data = sorted(num_locations, key=lambda item: item[0])
    split_index = next((i for i, (x, key) in enumerate(sorted_data) if key == 'dh'), None)

    if split_index is not None:
        part1 = sorted_data[:split_index]
        part2 = sorted_data[split_index + 1:]
    else:
        part1 = sorted_data
        part2 = []

    location_x = ''.join([key for (x, key) in part1])
    location_y = ''.join([key for (x, key) in part2])

    return map_location[4], safe_int(location_x, 0), safe_int(location_y, 0)


def _match_digits_in_gray(gray, scales):
    """在灰度图中匹配坐标标签、地图名和数字（性能优化版）

    Args:
        gray: 灰度图
        scales: 缩放因子

    Returns:
        dict 或 None
    """
    if scales is None:
        scales = OPTIMIZED_SCALES

    # 反转灰度图
    gray_inverted = 255 - gray

    # 1. 先匹配【坐标】标签
    zuobiao_location = None
    zuobiao_template = _load_template(TEMPLATE_DIR / "zuobiao.png")
    if zuobiao_template is not None:
        matched = pyramid_template_matching(gray_inverted, zuobiao_template, scales=scales, threshold=0.5)
        if matched:
            (x, y), (w, h), _, _ = matched[0]
            zuobiao_location = [x, y, w, h]
            logger.debug(f"灰度图匹配到【坐标】标签, 位置: ({x},{y})")

    # 2. 匹配地图名称
    map_location = None
    for map_name, map_key in MAP_KEYS:
        template = _load_template(TEMPLATE_DIR / f"{map_key}.png")
        if template is None:
            continue

        matched = pyramid_template_matching(gray_inverted, template, scales=scales, threshold=0.5)
        if matched:
            (x, y), (w, h), _, _ = matched[0]
            map_location = [x, y, w, h, map_name]
            logger.debug(f"灰度图匹配到地图: {map_name}, 位置: ({x},{y})")
            break

    # 3. 匹配数字（统一阈值0.8）
    num_locations = []
    for i in ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'dh']:
        template = _load_template(TEMPLATE_DIR / f"{i}.png")
        if template is None:
            continue

        matched = pyramid_template_matching_all(gray_inverted, template, scales=scales, threshold=0.8)
        if matched:
            for m in matched:
                (x, y), (w, h), _, _ = m
                num_locations.append((x, i))

    if not num_locations:
        if map_location:
            return {
                "map": map_location[4],
                "x": 0,
                "y": 0,
                "method": "template_gray",
                "matched": []
            }
        return None

    sorted_data = sorted(num_locations, key=lambda item: item[0])
    logger.debug(f"灰度匹配数字: {sorted_data}")

    split_index = next((i for i, (x, key) in enumerate(sorted_data) if key == 'dh'), None)

    if split_index is not None:
        part1 = sorted_data[:split_index]
        part2 = sorted_data[split_index + 1:]
    else:
        part1 = sorted_data
        part2 = []

    location_x = ''.join([key for (x, key) in part1])
    location_y = ''.join([key for (x, key) in part2])

    if location_x or location_y or map_location:
        return {
            "map": map_location[4] if map_location else None,
            "x": safe_int(location_x, 0),
            "y": safe_int(location_y, 0),
            "method": "template_gray",
            "matched": sorted_data
        }
    return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    logger.info("模板匹配坐标识别模块")
    logger.info(f"模板目录: {TEMPLATE_DIR}")

    # 检查模板文件
    templates = list(TEMPLATE_DIR.glob("*.png"))
    logger.info(f"已有模板 ({len(templates)}):")
    for t in sorted(templates):
        img = cv2.imread(str(t), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            logger.info(f"  {t.name}: {img.shape}")
        else:
            logger.warning(f"  {t.name}: 无法读取")
