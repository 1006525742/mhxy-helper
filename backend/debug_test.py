#!/usr/bin/env python3
"""诊断测试 - 保存OCR输入图片"""
import cv2
import os
import re
from pathlib import Path
from services.rapidocr_recognizer import recognize_coord_from_image

data_file = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/train_list.txt'
data_dir = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset'

# 只测试前20张，保存诊断图片
count = 0
with open(data_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for line in lines[:20]:
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

    # 开启debug模式
    map_name, x, y = recognize_coord_from_image(img, debug=True)

    is_correct = (map_name == expected_map and x == expected_x and y == expected_y)
    status = "✓" if is_correct else "✗"

    print(f'{parts[0]}: 期望 {expected_map} ({expected_x},{expected_y}), 实际 {map_name} ({x},{y}) {status}')
    count += 1

print(f'\n诊断图片已保存到 /tmp/ocr_debug/')
print(f'请查看这些图片，确认裁剪区域和图片质量是否正确')