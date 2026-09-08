#!/usr/bin/env python3
"""RapidOCR 坐标+地名识别模块 - 使用 PP-OCRv6

识别逻辑：
1. 使用 PP-OCRv6 SMALL 模型（更准确）
2. 直接对原图进行 OCR 识别
"""
import logging
import re
import cv2
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
MODELS_DIR = BASE_DIR / "models"

# 全局引擎实例（延迟加载，按 use_cls 区分缓存）
_ocr_engine = None            # 默认引擎，方向分类器(CLS)开启——抓鬼等通用场景使用
_ocr_engine_no_cls = None     # 关闭 CLS 的引擎——宝图/分图场景使用（文字永远正放）

# 最近一次识别的诊断信息（供路由层在日志里补充展示）
_last_recognize_debug: dict = {}


# ============ 默认地图名清单（抓鬼 11 图，向后兼容） ============
# 各服务（抓鬼/宝图）可通过 recognize_coord_from_image 参数传入各自清单
DEFAULT_MAP_NAMES = [
    '傲来国', '傲莱国',  # 莱→来
    '宝象国', '玉象国',  # 宝→玉
    '长寿村',
    '大唐境外', '天唐境外',  # 大→天
    '东海湾',
    '建邺城', '建邮城', '邮城', '邺城', '建业城',  # 邺→邮/业 误识
    '江南野外',
    '女儿村', '安儿村', '安几村',  # 女→安，儿→几
    '普陀山',
    '五庄观', '庄观',  # 被拆分
    '西凉女国', '西梁女国', '西粱女国', '西梁安国', '西女国', '梁女国', '女国',  # 安→女，缺少"西"/"梁"，简称"女国"
    '朱紫国', '朱华国',  # 紫→华
]

DEFAULT_MAP_NAME_NORMALIZE = {
    '傲来国': '傲来国',
    '傲莱国': '傲来国',
    '宝象国': '宝象国',
    '玉象国': '宝象国',
    '长寿村': '长寿村',
    '大唐境外': '大唐境外',
    '天唐境外': '大唐境外',
    '东海湾': '东海湾',
    '建邺城': '建邺城',
    '建邮城': '建邺城',
    '邮城': '建邺城',
    '邺城': '建邺城',
    '建业城': '建邺城',
    '江南野外': '江南野外',
    '女儿村': '女儿村',
    '安儿村': '女儿村',
    '安几村': '女儿村',
    '普陀山': '普陀山',
    '五庄观': '五庄观',
    '庄观': '五庄观',
    '西凉女国': '西梁女国',
    '西梁女国': '西梁女国',
    '西粱女国': '西梁女国',
    '西梁安国': '西梁女国',
    '西女国': '西梁女国',
    '梁女国': '西梁女国',
    '女国': '西梁女国',
    '朱紫国': '朱紫国',
    '朱华国': '朱紫国',
}



def get_ocr_engine(use_cls: bool = True):
    """获取 OCR 引擎（PP-OCRv6 SMALL）。

    use_cls=True  使用带方向分类器(CLS)的默认引擎——抓鬼等通用场景（兼容原有行为）。
    use_cls=False 关闭方向分类器——宝图/分图场景专用：游戏内文字永远正放，CLS 只会
                 误判颜色/方向（曾导致 frame_0744 原图被当成反色读成乱码），且额外耗推理时间。

    两个引擎各自延迟加载、独立缓存，互不影响。
    """
    global _ocr_engine, _ocr_engine_no_cls
    if use_cls:
        cache = _ocr_engine
    else:
        cache = _ocr_engine_no_cls
    if cache is not None:
        return cache

    try:
        from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

        engine = RapidOCR(
            params={
                # 检测模型 → PP-OCRv6 SMALL
                "Det.ocr_version": OCRVersion.PPOCRV6,
                "Det.model_type": ModelType.SMALL,
                "Det.engine_type": EngineType.ONNXRUNTIME,
                "Det.lang_type": LangDet.CH,

                # 识别模型 → PP-OCRv6 SMALL
                "Rec.ocr_version": OCRVersion.PPOCRV6,
                "Rec.model_type": ModelType.SMALL,
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.lang_type": LangRec.CH,

                # 方向分类器(CLS)开关：抓鬼默认开启；宝图关闭
                "Global.use_cls": use_cls,
            }
        )
        if use_cls:
            _ocr_engine = engine
        else:
            _ocr_engine_no_cls = engine
        logger.info(f"OCR引擎初始化完成 (PP-OCRv6 SMALL, use_cls={use_cls})")
        return engine
    except Exception as e:
        logger.error(f"OCR引擎初始化失败: {e}")
        return None


def _ocr_pipeline(engine, image, map_names, map_name_normalize, fallback_maps, debug=False):
    """对单张（已预处理）图跑完整 OCR + 解析，返回 (map_name, x, y)。

    抽取自 recognize_coord_from_image，便于对多种预处理结果复用同一套解析逻辑。
    """
    global _last_recognize_debug
    h, w = image.shape[:2]

    # 缩小过大的图片（保持原有逻辑）
    if h > 300:
        scale_factor = 300.0 / h
        image = cv2.resize(image, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_AREA)
        logger.info(f"图片缩小: {h}x{w} -> {image.shape[0]}x{image.shape[1]}")

    # 诊断：保存输入图片
    if debug:
        from datetime import datetime
        debug_dir = Path("/tmp/ocr_debug")
        debug_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%H%M%S_%f")
        cv2.imwrite(str(debug_dir / f"{ts}_input.png"), image)
        logger.info(f"[DEBUG] 保存诊断图片: {debug_dir / ts}_input.png, 尺寸: {image.shape[1]}x{image.shape[0]}")

    try:
        # 直接对原图进行 OCR 识别
        result = engine(image)

        if result is None:
            logger.info("OCR 返回空结果")
            return '', 0, 0

        # 新版 RapidOCR 3.9+ 返回 RapidOCROutput 对象
        texts = []

        # 检查是否是新版 RapidOCROutput 对象
        if hasattr(result, 'txts') and hasattr(result, 'scores'):
            # 新版 API: RapidOCROutput
            txts = result.txts
            scores = result.scores

            if txts and scores:
                for text, conf in zip(txts, scores):
                    texts.append((text, conf))
                    logger.info(f"OCR识别: '{text}' ({conf:.2f})")

        elif isinstance(result, tuple) and len(result) == 2:
            # 旧版 API: (boxes, scores)
            boxes, scores = result

            if boxes and isinstance(boxes, list):
                for item in boxes:
                    if isinstance(item, list) and len(item) >= 3:
                        text = str(item[1])  # item = [bbox, text, score]
                        confidence = item[2]
                        texts.append((text, confidence))
                        logger.info(f"OCR识别: '{text}' ({confidence:.2f})")

        if not texts:
            logger.info("texts 为空")
            return '', 0, 0

        full_text = ' '.join([t[0] for t in texts])
        logger.info(f"OCR合并文本: '{full_text}'")

        # 地图名关键词匹配（支持 OCR 误识别的变体）
        # map_names / map_name_normalize 由参数传入（默认值见模块级 DEFAULT_*）
        map_name = ''

        # ===== 鲁棒解析器 =====
        def robust_parse_ocr(text):
            """鲁棒解析 OCR 输出的坐标和地图名"""
            original = text

            # Step 1: 去掉前缀干扰词
            text = re.sub(r'^[去前往到]\s*', '', text)

            # Step 2: 提取后缀信息备用
            suffix_info = re.search(r'附近.*$', text)
            text = re.sub(r'附近.*$', '', text)

            coord_candidates = []

            # 模式1: 数字+逗号/点号+数字 (正常格式)
            # 分隔符类允许逗号/句号/顿号/空格，且可重复出现，
            # 以容忍 OCR 将 (324, 95) 误识为 (324, ,95) 这类多分隔符/空格噪声
            for m in re.finditer(r'(\d{1,3})\s*[,，、.。\s]+(\d{1,3})', text):
                x, y = int(m.group(1)), int(m.group(2))
                if 1 <= x <= 700 and 1 <= y <= 350:
                    coord_candidates.append((x, y, m.start()))
                elif x > 700 and 1 <= (x // 10) <= 700 and 1 <= y <= 350:
                    # 逗号丢失导致 x 与 y 首位数字粘连：如 "(71,24)" 被误识为 "712 24)"
                    # → x=712 超范围，拆出 x//10=71、y 保留 24 即真实坐标 (71,24)
                    logger.info(f"坐标粘连修复: x 由 {x} 拆为 {x // 10} (原文 '{m.group(0)}')")
                    coord_candidates.append((x // 10, y, m.start()))

            # 模式2: 数字+加号+数字
            for m in re.finditer(r'(\d{1,3})\s*\+\s*(\d{1,3})', text):
                x, y = int(m.group(1)), int(m.group(2))
                if 1 <= x <= 700 and 1 <= y <= 350:
                    coord_candidates.append((x, y, m.start()))

            # 模式3: 无分隔符的 4-6 位数字串 (逗号丢失)
            for m in re.finditer(r'(?<!\d)(\d{4,6})(?!\d)', text):
                digits = m.group(1)
                for split_pos in range(2, len(digits) - 1):
                    x, y = int(digits[:split_pos]), int(digits[split_pos:])
                    if 1 <= x <= 700 and 1 <= y <= 350:
                        coord_candidates.append((x, y, m.start()))
                        break

            if not coord_candidates:
                return None, None, None, ''

            # 取最靠前的坐标
            coord_candidates.sort(key=lambda c: c[2])
            x, y, coord_pos = coord_candidates[0]

            # —— 坐标被 OCR 换行/空格截断的修复 ——
            # 现象：游戏 "(592,95)" 被切成两行识别成 "592,9" 与 "2,95)"，
            # 上面只取了最靠前的 (592,9)，把 y 的个位数 "5" 漏掉 → 误成 (592,9)。
            # 当主候选 y 为个位数（游戏纵坐标极少是个位数），且存在另一个
            # 「x 明显不合理(<10，不像真实横坐标)但 y 较大」的候选时，
            # 判定为主候选 y 被截断，采用更长的 y 续接回去。
            if 1 <= y < 10:
                for (_x2, _y2, _p2) in coord_candidates[1:]:
                    if _y2 >= 10 and _x2 < 10:
                        logger.info(f"坐标截断修复: y 由 {y} 续接为 {_y2} (候选 x={_x2} 视为噪声)")
                        y = _y2
                        break

            # Step 4: 提取地图名（坐标之前的中文字符）
            text_before_coord = text[:coord_pos]
            mapname_candidate = re.sub(r'[^一-龥]', '', text_before_coord)

            # 如果地图名太短，尝试从后缀恢复
            if len(mapname_candidate) < 2 and suffix_info:
                suffix_text = suffix_info.group(0)
                extra_chinese = re.sub(r'[^一-龥]', '', suffix_text)
                mapname_candidate = mapname_candidate + extra_chinese

            return x, y, coord_pos, mapname_candidate

        # 合并所有文本用于解析
        full_text_for_parse = ' '.join([t[0] for t in texts])

        # 用鲁棒解析器解析坐标和地图名
        x_val, y_val, coord_pos, mapname_from_ocr = robust_parse_ocr(full_text_for_parse)

        if x_val is not None:
            logger.info(f"鲁棒解析: ({x_val}, {y_val}), 地图名候选: '{mapname_from_ocr}'")
        else:
            x_val, y_val = 0, 0
            logger.info("鲁棒解析未找到坐标")

        # 地图名匹配：从每行 OCR 结果中搜索
        # 取「最长命中」的名称，避免短别名（如'大唐'）抢在完整名（如'大唐国境'）之前误匹配
        map_name = ''
        matched_keyword = ''
        for text, _ in texts:
            best = ''
            for name in map_names:
                if name in text and len(name) > len(best):
                    best = name
            if best:
                map_name = map_name_normalize.get(best, best)
                matched_keyword = best
                logger.info(f"关键词匹配: '{best}' -> '{map_name}' (行: '{text}')")
                break

        # 兜底：关键词未命中，但鲁棒解析拿到了地图名候选，用归一化映射校正 OCR 变体
        # 例如 OCR 把「傲来国」误识为「傲莱国」，候选名「傲莱国」命中归一化表 -> 傲来国
        if not map_name and mapname_from_ocr:
            if mapname_from_ocr in map_name_normalize:
                map_name = map_name_normalize[mapname_from_ocr]
                matched_keyword = mapname_from_ocr
                logger.info(f"地图名候选归一化: '{mapname_from_ocr}' -> '{map_name}'")
            else:
                for _alias, _canon in map_name_normalize.items():
                    if len(_alias) >= 2 and _alias in mapname_from_ocr:
                        map_name = _canon
                        matched_keyword = mapname_from_ocr
                        logger.info(f"地图名候选部分命中: '{mapname_from_ocr}' 含变体 '{_alias}' -> '{map_name}'")
                        break

        # 地名识别兜底模型已移除：该模型误判率高（曾把"傲来国"错判成"朱紫国"），
        # 现仅依赖 OCR 文本关键词 + 变体归一化匹配，地图名不可靠时不强行猜测。

        logger.info(f"最终结果: map_name='{map_name}', x={x_val}, y={y_val}")

        # 综合诊断：把 OCR 到底认到了什么一次性讲清楚，便于排查
        logger.info(
            f"[OCR综合] 原文='{full_text}' | 解析坐标=({x_val},{y_val}) | "
            f"地图候选='{mapname_from_ocr}' | 命中关键词='{matched_keyword}' | "
            f"最终地图='{map_name}'"
        )
        # 缓存诊断信息，供路由层在 [Fentu OCR] 摘要行里带上原文
        _last_recognize_debug = {
            'raw_text': full_text,
            'matched_keyword': matched_keyword,
            'mapname_candidate': mapname_from_ocr,
            'final_map': map_name,
            'x': x_val,
            'y': y_val,
        }

        if map_name or (x_val and y_val):
            logger.info(f"RapidOCR 结果: {map_name} ({x_val},{y_val})")
            return map_name, x_val, y_val

    except Exception as e:
        logger.error(f"OCR失败: {e}")

    return '', 0, 0


def recognize_coord_from_image(image, debug=False,
                               map_names=None, map_name_normalize=None,
                               fallback_maps=None, use_cls: bool = True):
    """使用 RapidOCR 识别坐标和地名。

    Args:
        image: BGR 图像
        debug: 是否保存诊断图片
        map_names: 地图名关键词列表（用于 OCR 文本匹配）。默认为抓鬼的 11 图清单。
        map_name_normalize: OCR 变体 → 标准地图名 的归一化映射。
        fallback_maps: 预留参数（地名识别兜底模型已移除，不再使用）。

    Returns:
        tuple: (地图名, x坐标, y坐标)

    策略：
        1. 先对原图直识（保持既有行为，避免回归）。
        2. 若原图未识别到坐标（如游戏坐标文字为深色/绿色字 + 暗背景，PP-OCRv6 对小数字
           漏读，出现 "江南野外（ ) 101)" 这类坐标丢失），再依次尝试反色、CLAHE 对比度增强
           等预处理兜底，取能解析出坐标的结果（优先带地图名的）。
    """
    # 允许各服务（抓鬼/宝图）传入各自的地图名清单，实现服务分离
    if map_names is None:
        map_names = DEFAULT_MAP_NAMES
    if map_name_normalize is None:
        map_name_normalize = DEFAULT_MAP_NAME_NORMALIZE
    if fallback_maps is None:
        fallback_maps = list(set(DEFAULT_MAP_NAME_NORMALIZE.values()))
    engine = get_ocr_engine(use_cls=use_cls)
    if engine is None:
        return '', 0, 0

    global _last_recognize_debug

    # ===== 第一遍：原图直识 =====
    map_name, x_val, y_val = _ocr_pipeline(
        engine, image, map_names, map_name_normalize, fallback_maps, debug
    )

    # 正常场景：坐标齐全且横纵均合理（均≥10，挖图坐标极少为个位数），直接返回，零回归
    if x_val and y_val and x_val >= 10 and y_val >= 10:
        return map_name, x_val, y_val

    # 记录原图诊断，若后续兜底也无坐标则还原，保证日志与返回一致
    orig_debug = dict(_last_recognize_debug)

    # ===== 兜底预处理变体 =====
    variants = []
    try:
        variants.append(("inverted", cv2.bitwise_not(image)))
    except Exception as e:
        logger.debug(f"反色预处理失败: {e}")
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
        enhanced = clahe.apply(gray)
        variants.append(("clahe", cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)))
    except Exception as e:
        logger.debug(f"CLAHE 预处理失败: {e}")
    try:
        # 绿通道灰度：宝图坐标为深绿字，绿色通道对比度最优（针对深绿色字体优化）。
        # 对照实验(frame_0744 等难点帧)显示绿通道直识 '普陀山(71,24)' 明显优于标准灰度。
        green = image[:, :, 1]
        variants.append(("green", cv2.cvtColor(green, cv2.COLOR_GRAY2BGR)))
    except Exception as e:
        logger.debug(f"绿通道预处理失败: {e}")

    # 收集所有候选（原图 + 各变体），用于跨候选互补
    candidates = [(x_val, y_val, map_name)]
    for vname, vimg in variants:
        vmap, vx, vy = _ocr_pipeline(
            engine, vimg, map_names, map_name_normalize, fallback_maps, debug
        )
        candidates.append((vx, vy, vmap))

    # —— 跨候选互补 ——
    # 背景：RapidOCR 方向分类器(CLS)可能对某些图误判颜色，使原图直识失败
    # （如 frame_0744 原图被反色识别成 '7121120品' → (0,0)），但反色/CLAHE 变体反而
    # 能识别；且不同变体常各漏一部分坐标（某变体 x 准 y 偏、另一变体 y 准 x 偏）。
    # 策略：横坐标取「x≥10 且在游戏范围(≤700)」的候选值；纵坐标取「y≥10 且合理(≤350)」
    # 的候选值；地图名取任一有效候选。把各变体补全的部分拼回完整坐标。
    def _pick(axis, lo, hi):
        # 优先取同时带地图名的候选坐标，避免采用纯坐标误识变体
        for c in candidates:
            if c[axis] and lo <= c[axis] <= hi and c[2]:
                return c[axis]
        for c in candidates:
            if c[axis] and lo <= c[axis] <= hi:
                return c[axis]
        return None

    fx = _pick(0, 10, 700)
    fy = _pick(1, 10, 350)
    fmap = next((c[2] for c in candidates if c[2]), map_name or '')

    if fx is None and fy is None and not fmap:
        # 仍无任何有效坐标：还原原图诊断，返回原图结果（通常仅有地图名）
        _last_recognize_debug = orig_debug
        return map_name, x_val, y_val

    logger.info(
        f"[跨候选互补] 原图=({x_val},{y_val}) 候选={candidates} -> 采用 ({fx},{fy}) 地图='{fmap}'"
    )
    return fmap, fx or x_val, fy or y_val


def recognize_text_from_image(image):
    """使用 RapidOCR 进行通用文字识别

    Args:
        image: BGR 图像 (numpy array)

    Returns:
        str: 识别到的文字，用空格连接多行结果
    """
    engine = get_ocr_engine()
    if engine is None:
        logger.error("OCR引擎未初始化")
        return ""

    try:
        result = engine(image)

        if result is None:
            return ""

        texts = []

        # 新版 RapidOCR 3.9+: RapidOCROutput 对象
        if hasattr(result, 'txts') and hasattr(result, 'scores'):
            txts = result.txts
            if txts:
                for text in txts:
                    if text and isinstance(text, str) and text.strip():
                        texts.append(text.strip())
                        logger.info(f"OCR识别: '{text.strip()}'")

        # 旧版 API: (boxes, scores)
        elif isinstance(result, tuple) and len(result) == 2:
            boxes, scores = result
            if boxes and isinstance(boxes, list):
                for item in boxes:
                    if isinstance(item, list) and len(item) >= 3:
                        text = str(item[1]).strip()
                        if text:
                            texts.append(text)
                            logger.info(f"OCR识别: '{text}'")

        # 按垂直位置排序 (从上到下)
        try:
            if hasattr(result, 'boxes') and result.boxes is not None:
                boxes_data = result.boxes
                # boxes 可能是 list 或 numpy array
                if isinstance(boxes_data, np.ndarray):
                    if boxes_data.size > 0 and len(boxes_data) == len(texts):
                        pairs = list(zip(boxes_data, texts))
                        pairs.sort(key=lambda x: float(x[0][0][1]) if len(x[0]) > 0 else 0)
                        texts = [p[1] for p in pairs]
                elif isinstance(boxes_data, list) and len(boxes_data) > 0:
                    if len(boxes_data) == len(texts):
                        pairs = list(zip(boxes_data, texts))
                        pairs.sort(key=lambda x: x[0][0][1] if len(x[0]) > 0 else 0)
                        texts = [p[1] for p in pairs]
        except Exception as e:
            logger.debug(f"OCR排序跳过: {e}")

        full_text = ' '.join(texts)
        logger.info(f"OCR结果: '{full_text}'")
        return full_text

    except Exception as e:
        logger.error(f"OCR失败: {e}")
        return ""


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    engine = get_ocr_engine()
    if engine:
        print("✅ RapidOCR 引擎初始化成功")