#!/usr/bin/env python3
"""P0: 图像放大测试"""
import cv2
import os
import re
from services.rapidocr_recognizer import recognize_coord_from_image

data_file = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/train_list.txt'
data_dir = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset'

def preprocess_upscale(img, target_height=64):
    """放大到指定高度"""
    h, w = img.shape[:2]
    if h < target_height:
        scale = target_height / h
        return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return img

methods = {
    '原图': lambda x: x,
    '放大64px': lambda x: preprocess_upscale(x, 64),
    '放大96px': lambda x: preprocess_upscale(x, 96),
}

results = {m: [] for m in methods}

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

    for method_name, preprocess in methods.items():
        processed = preprocess(img)
        map_name, x, y = recognize_coord_from_image(processed)
        if not (map_name == expected_map and x == expected_x and y == expected_y):
            results[method_name].append(parts[0])

print('=== P0: 图像放大测试 ===')
print(f'总测试: {len(lines)}')
for method_name in methods:
    err = len(results[method_name])
    acc = 100 * (len(lines) - err) / len(lines)
    print(f'{method_name:12s}: 错误 {err:3d}, 准确率 {acc:.1f}%')