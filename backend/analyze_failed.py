#!/usr/bin/env python3
"""分析失败图片的OCR原始结果"""
import cv2
from services.rapidocr_recognizer import get_ocr_engine
import os

failed_files = [
    '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/images/frame_0164.png',
    '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/images/frame_0165.png',
    '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/images/frame_0170.png',
]

engine = get_ocr_engine()

for f in failed_files:
    img = cv2.imread(f)
    print(f'\n=== {os.path.basename(f)} 尺寸: {img.shape[:2]} ===')

    result = engine(img)
    if result and result[0]:
        for item in result[0]:
            if isinstance(item, list) and len(item) >= 3:
                bbox, text, conf = item[0], item[1], item[2]
                print(f'  "{text}" ({conf:.2f}) bbox: {bbox}')
    else:
        print('  无OCR结果')