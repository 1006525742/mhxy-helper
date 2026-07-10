#!/usr/bin/env python3
"""PP-OCRv6 错误详细分析"""
import cv2
import os
import re
from services.rapidocr_recognizer import recognize_coord_from_image, get_ocr_engine

data_file = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/train_list.txt'
data_dir = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset'

engine = get_ocr_engine()
errors = []

with open(data_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for line in lines:
    parts = line.strip().split('\t')
    if len(parts) != 2:
        continue

    img_path = os.path.join(data_dir, parts[0])
    expected = parts[1]

    match = re.match(r'([^0-9]+)(\d+)[，,](\d+)', expected)
    if not match:
        continue

    expected_map = match.group(1).strip()
    expected_x = int(match.group(2))
    expected_y = int(match.group(3))

    img = cv2.imread(img_path)
    if img is None:
        continue

    # 获取 OCR 原始结果
    result = engine(img)
    ocr_raw = []
    if hasattr(result, 'txts'):
        for txt, score in zip(result.txts, result.scores):
            ocr_raw.append(f"'{txt}' ({score:.2f})")

    # 获取最终识别结果
    map_name, x, y = recognize_coord_from_image(img)

    is_correct = (map_name == expected_map and x == expected_x and y == expected_y)

    if not is_correct:
        errors.append({
            'file': parts[0],
            'expected': f'{expected_map} ({expected_x},{expected_y})',
            'actual': f'{map_name} ({x},{y})',
            'ocr_raw': ocr_raw,
            'expected_map': expected_map,
            'actual_map': map_name,
            'expected_x': expected_x,
            'expected_y': expected_y,
            'actual_x': x,
            'actual_y': y,
        })

print(f'=== PP-OCRv6 SMALL 错误详情（共 {len(errors)} 个）=== \n')

for i, e in enumerate(errors, 1):
    print(f'{i}. {e["file"]}')
    print(f'   期望: {e["expected"]}')
    print(f'   实际: {e["actual"]}')
    print(f'   OCR原始: {", ".join(e["ocr_raw"])}')

    # 分析错误原因
    if e["actual_map"] == '' and e["expected_map"]:
        print(f'   原因: 地图名未识别')
    elif e["actual_map"] != e["expected_map"]:
        print(f'   原因: 地图名错误 ({e["actual_map"]} vs {e["expected_map"]})')
    elif e["actual_x"] != e["expected_x"] or e["actual_y"] != e["expected_y"]:
        print(f'   原因: 坐标错误')
    print()