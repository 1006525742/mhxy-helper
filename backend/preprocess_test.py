#!/usr/bin/env python3
"""预处理方法对比测试"""
import cv2
import numpy as np
import os
import re
from services.rapidocr_recognizer import recognize_coord_from_image

data_file = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/train_list.txt'
data_dir = '/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset'

def preprocess_sharpen(img):
    """锐化"""
    kernel = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
    return cv2.filter2D(img, -1, kernel)

def preprocess_grayscale(img):
    """灰度化"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

def preprocess_contrast(img):
    """对比度增强"""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    l = clahe.apply(l)
    lab = cv2.merge((l, a, b))
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

methods = {
    'original': lambda x: x,
    'sharpen': preprocess_sharpen,
    'grayscale': preprocess_grayscale,
    'contrast': preprocess_contrast,
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

print('=== 预处理方法对比 ===')
print(f'总测试: {len(lines)}')
for method_name in methods:
    err = len(results[method_name])
    acc = 100 * (len(lines) - err) / len(lines)
    print(f'{method_name:12s}: 错误 {err:3d}, 准确率 {acc:.1f}%')