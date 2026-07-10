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

# 全局引擎实例（延迟加载）
_ocr_engine = None


def get_ocr_engine():
    """获取 OCR 引擎（PP-OCRv6 SMALL）"""
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

            _ocr_engine = RapidOCR(
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
                }
            )
            logger.info(f"OCR引擎初始化完成 (PP-OCRv6 SMALL)")
        except Exception as e:
            logger.error(f"OCR引擎初始化失败: {e}")
            return None
    return _ocr_engine


def recognize_coord_from_image(image, debug=False):
    """使用 RapidOCR 直接识别原图坐标和地名

    Args:
        image: BGR 图像
        debug: 是否保存诊断图片

    Returns:
        tuple: (地图名, x坐标, y坐标)
    """
    engine = get_ocr_engine()
    if engine is None:
        return '', 0, 0

    # ===== 预处理 =====
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
        map_name = ''
        # 标准名称 + OCR 常见错误变体
        map_names = [
            '傲来国', '傲莱国',  # 莱→来
            '宝象国', '玉象国',  # 宝→玉
            '长寿村',
            '大唐境外', '天唐境外',  # 大→天
            '东海湾',
            '建邺城', '建邮城', '邺城',  # 邺→邮，缺少"建"
            '江南野外',
            '女儿村', '安儿村', '安几村',  # 女→安，儿→几
            '普陀山',
            '五庄观', '庄观',  # 被拆分
            '西凉女国', '西梁女国', '西粱女国', '西梁安国', '西女国', '梁女国',  # 安→女，缺少"西"/"梁"
            '朱紫国', '朱华国',  # 紫→华
        ]

        # 地图名标准化映射
        map_name_normalize = {
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
            '邺城': '建邺城',
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
            '朱紫国': '朱紫国',
            '朱华国': '朱紫国',
        }

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
            for m in re.finditer(r'(\d{1,3})\s*[,，、.。]\s*(\d{1,3})', text):
                x, y = int(m.group(1)), int(m.group(2))
                if 1 <= x <= 600 and 1 <= y <= 300:
                    coord_candidates.append((x, y, m.start()))

            # 模式2: 数字+加号+数字
            for m in re.finditer(r'(\d{1,3})\s*\+\s*(\d{1,3})', text):
                x, y = int(m.group(1)), int(m.group(2))
                if 1 <= x <= 600 and 1 <= y <= 300:
                    coord_candidates.append((x, y, m.start()))

            # 模式3: 无分隔符的 4-6 位数字串 (逗号丢失)
            for m in re.finditer(r'(?<!\d)(\d{4,6})(?!\d)', text):
                digits = m.group(1)
                for split_pos in range(2, len(digits) - 1):
                    x, y = int(digits[:split_pos]), int(digits[split_pos:])
                    if 1 <= x <= 600 and 1 <= y <= 300:
                        coord_candidates.append((x, y, m.start()))
                        break

            if not coord_candidates:
                return None, None, None, ''

            # 取最靠前的坐标
            coord_candidates.sort(key=lambda c: c[2])
            x, y, coord_pos = coord_candidates[0]

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
        for text, _ in texts:
            for name in map_names:
                if name in text:
                    map_name = map_name_normalize.get(name, name)
                    logger.info(f"关键词匹配: '{name}' -> '{map_name}' (行: '{text}')")
                    break
            if map_name:
                break

        # 如果 OCR 未识别到地图名，但坐标识别到了，调用地名识别模型兜底
        if not map_name and x_val and y_val:
            try:
                from services.place_recognizer import recognize_place
                map_name = recognize_place(image)
                if map_name:
                    logger.info(f"地名识别兜底: '{map_name}'")
            except Exception as e:
                logger.warning(f"地名识别兜底失败: {e}")

        logger.info(f"最终结果: map_name='{map_name}', x={x_val}, y={y_val}")

        if map_name or (x_val and y_val):
            logger.info(f"RapidOCR 结果: {map_name} ({x_val},{y_val})")
            return map_name, x_val, y_val

    except Exception as e:
        logger.error(f"OCR失败: {e}")

    return '', 0, 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    engine = get_ocr_engine()
    if engine:
        print("✅ RapidOCR 引擎初始化成功")