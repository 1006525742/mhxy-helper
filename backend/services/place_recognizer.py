#!/usr/bin/env python3
"""地名识别模块 - 使用训练好的 PP-OCRv5 模型

识别逻辑：
1. HSV 颜色过滤提取黄色文字
2. 使用训练好的 place_v5 模型识别地名
"""
import logging
import cv2
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
MODELS_DIR = BASE_DIR / "models"
PLACE_MODEL_DIR = MODELS_DIR / "place_v5_onnx"
PLACE_DICT_PATH = MODELS_DIR / "place_dict.txt"

# 全局引擎实例（延迟加载）
_place_engine = None


def get_place_engine():
    """获取地名识别引擎"""
    global _place_engine
    if _place_engine is None:
        try:
            from paddleocr import PaddleOCR

            _place_engine = PaddleOCR(
                text_recognition_model_dir=str(PLACE_MODEL_DIR),
                use_angle_cls=False,
                lang="ch"
            )
            logger.info(f"地名识别引擎初始化完成 (模型: {PLACE_MODEL_DIR})")
        except Exception as e:
            logger.error(f"地名引擎初始化失败: {e}")
            return None
    return _place_engine


def get_yellow_text_mask(image):
    """HSV 颜色过滤提取黄色文字"""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # 黄色范围
    mask1 = cv2.inRange(hsv, np.array([20, 30, 120]), np.array([35, 255, 255]))
    mask2 = cv2.inRange(hsv, np.array([35, 30, 180]), np.array([45, 255, 255]))
    return cv2.bitwise_or(mask1, mask2)


def recognize_place(image, debug=False):
    """识别图片中的地名

    Args:
        image: BGR 图像
        debug: 是否打印调试信息

    Returns:
        str: 识别到的地名，失败返回空字符串
    """
    engine = get_place_engine()
    if engine is None:
        return ''

    try:
        # 缩小图片加速识别
        h, w = image.shape[:2]
        if h > 300:
            scale_factor = 300.0 / h
            image = cv2.resize(image, None, fx=scale_factor, fy=scale_factor)

        # 尝试黄色提取
        mask = get_yellow_text_mask(image)
        mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)

        # OCR 识别
        result = engine.ocr(mask_bgr)

        if result is None or len(result) == 0:
            # 尝试原图
            result = engine.ocr(image)

        if result is None or len(result) == 0:
            return ''

        # 提取识别结果
        texts = []
        for item in result:
            if item and len(item) >= 1:
                for sub_item in item:
                    if len(sub_item) >= 2:
                        text = sub_item[1][0] if isinstance(sub_item[1], tuple) else sub_item[1]
                        texts.append(text)
                        if debug:
                            logger.debug(f"地名识别: '{text}'")

        if not texts:
            return ''

        # 合并文本
        full_text = ''.join(texts)

        if debug:
            logger.info(f"地名识别结果: '{full_text}'")

        return full_text

    except Exception as e:
        logger.error(f"地名识别失败: {e}")
        return ''


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    engine = get_place_engine()
    if engine:
        print("✅ 地名识别引擎初始化成功")
        print(f"   模型目录: {PLACE_MODEL_DIR}")
        print(f"   字典文件: {PLACE_DICT_PATH}")
