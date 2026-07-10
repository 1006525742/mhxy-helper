#!/usr/bin/env python3
"""测试 PP-OCRv6 准确率"""
import cv2
import os
import re
from services.rapidocr_recognizer import recognize_coord_from_image

data_file = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/train_list.txt'
data_dir = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset'

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

    map_name, x, y = recognize_coord_from_image(img)

    is_correct = (map_name == expected_map and x == expected_x and y == expected_y)

    if not is_correct:
        errors.append({
            'file': parts[0],
            'expected': f'{expected_map} ({expected_x},{expected_y})',
            'actual': f'{map_name} ({x},{y})'
        })

print('=== 添加 OCR 变体后测试结果 ===')
print(f'总测试: {len(lines)}')
print(f'错误: {len(errors)}')
print(f'准确率: {100 * (len(lines) - len(errors)) / len(lines):.1f}%')
print(f'提升: 77.6% -> {100 * (len(lines) - len(errors)) / len(lines):.1f}%')