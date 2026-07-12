#!/usr/bin/env python3
"""地名识别模块 - 使用训练好的 PP-OCRv4 ONNX 模型"""
import logging
import math
import cv2
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
# 模型路径（新训练的 place_rec.onnx）
PLACE_ONNX_PATH = BASE_DIR / "models" / "place.onnx"
PLACE_DICT_PATH = BASE_DIR / "models" / "place_dict.txt"

# 全局模型实例
_place_model = None
_dict_chars = None


def load_dict():
    """加载字典"""
    global _dict_chars
    if _dict_chars is None:
        with open(PLACE_DICT_PATH, 'r', encoding='utf-8') as f:
            # PaddleOCR 格式：index 0 = blank，字符从 index 1 开始
            _dict_chars = ['blank'] + [line.strip() for line in f if line.strip()]
        logger.info(f"字典加载完成: {len(_dict_chars)} 字符 (含 blank)")
    return _dict_chars


def get_place_model():
    """加载地名识别 ONNX 模型"""
    global _place_model
    if _place_model is None:
        try:
            import onnxruntime as ort
            _place_model = ort.InferenceSession(str(PLACE_ONNX_PATH))
            logger.info(f"地名识别模型加载成功: {PLACE_ONNX_PATH}")
        except Exception as e:
            logger.error(f"地名识别模型加载失败: {e}")
            return None
    return _place_model


def resize_norm_img(img, image_shape=(3, 48, 320)):
    """PaddleOCR 标准预处理：保持宽高比缩放 + 归一化到 [-1, 1]"""
    imgC, imgH, imgW = image_shape
    h, w = img.shape[:2]
    ratio = w / float(h)
    if math.ceil(imgH * ratio) > imgW:
        resized_w = imgW
    else:
        resized_w = int(math.ceil(imgH * ratio))
    resized_image = cv2.resize(img, (resized_w, imgH))
    resized_image = resized_image.astype('float32')
    resized_image = resized_image.transpose((2, 0, 1)) / 255
    resized_image -= 0.5
    resized_image /= 0.5  # 归一化到 [-1, 1]
    # 右侧 padding 补零
    padding_im = np.zeros((imgC, imgH, imgW), dtype=np.float32)
    padding_im[:, :, 0:resized_w] = resized_image
    return padding_im


def recognize_place(image):
    """识别图片中的地名

    Args:
        image: BGR 图像

    Returns:
        str: 识别出的地名，失败返回空字符串
    """
    model = get_place_model()
    dict_chars = load_dict()
    if model is None or dict_chars is None:
        return ''

    try:
        # PaddleOCR 标准预处理
        norm_img = resize_norm_img(image, (3, 48, 320))
        tensor = np.expand_dims(norm_img, 0)

        # 推理
        input_name = model.get_inputs()[0].name
        output = model.run(None, {input_name: tensor})[0]

        # output shape: (batch, seq_len, dict_size) → 取第一个 batch
        if len(output.shape) == 3:
            output = output[0]

        # CTC 解码
        result = ctc_decode(output, dict_chars)

        logger.info(f"地名识别结果: '{result}'")
        return result

    except Exception as e:
        logger.error(f"地名识别失败: {e}")
        return ''


def ctc_decode(output, dict_chars):
    """CTC 解码

    Args:
        output: 模型输出 (seq_len, dict_size)
        dict_chars: 字符列表 (index 0 = blank)

    Returns:
        str: 解码后的文本
    """
    indices = output.argmax(axis=1)

    text = []
    last_idx = 0

    for idx in indices:
        idx = int(idx)
        # 跳过 blank (索引 0) 和重复
        if idx != 0 and idx != last_idx:
            if idx < len(dict_chars):
                text.append(dict_chars[idx])
        last_idx = idx

    return ''.join(text)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # 测试
    import sys
    if len(sys.argv) > 1:
        img = cv2.imread(sys.argv[1])
        result = recognize_place(img)
        print(f"识别结果: '{result}'")
    else:
        print("用法: python place_recognizer.py <图片路径>")
