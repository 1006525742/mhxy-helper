#!/usr/bin/env python3
"""测试投影法 + 模板匹配的集成效果"""
from pathlib import Path
import requests
import cv2
import numpy as np
import onnxruntime as ort

DATI_CLASSES = ['签到答题', '安全问答', '梦幻课堂', '科举']

test_images = [
    "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-02-10.png",
    "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-04-58.png",
    "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-05-50.png",
    "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-09-05.png",
]

backend_url = "http://127.0.0.1:8008"
_session = None

def get_session():
    global _session
    if _session is None:
        _session = ort.InferenceSession("/Users/zhy/mhxy-helper/frontend/public/models/dati_best.onnx")
    return _session

def detect_panel(img_path):
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    session = get_session()
    input_name = session.get_inputs()[0].name
    input_size = session.get_inputs()[0].shape[2]

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    scale = min(input_size / h, input_size / w)
    new_h, new_w = int(h * scale), int(w * scale)
    pad_h = (input_size - new_h) // 2
    pad_w = (input_size - new_w) // 2

    resized = cv2.resize(img_rgb, (new_w, new_h))
    letterbox = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    letterbox[pad_h:pad_h+new_h, pad_w:pad_w+new_w] = resized

    input_tensor = letterbox.astype(np.float32) / 255.0
    input_tensor = input_tensor.transpose(2, 0, 1)[None]

    outputs = session.run(None, {input_name: input_tensor})
    output = outputs[0]
    channels, num_anchors = output.shape[1], output.shape[2]
    num_classes = channels - 4

    detections = []
    for i in range(num_anchors):
        cx, cy = output[0, 0, i], output[0, 1, i]
        bw, bh = output[0, 2, i], output[0, 3, i]
        max_conf, class_id = 0, 0
        for c in range(num_classes):
            conf = output[0, 4 + c, i]
            if conf > max_conf:
                max_conf, class_id = conf, c
        if max_conf > 0.4:
            x1 = (cx - bw/2 - pad_w) / scale
            y1 = (cy - bh/2 - pad_h) / scale
            x2 = (cx + bw/2 - pad_w) / scale
            y2 = (cy + bh/2 - pad_h) / scale
            detections.append({'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                               'conf': float(max_conf), 'class_id': class_id})

    if not detections:
        return None
    return max(detections, key=lambda x: x['conf'])

for img_path in test_images:
    print(f"\n{'='*60}")
    print(f"测试: {Path(img_path).name}")

    panel_det = detect_panel(img_path)
    if panel_det:
        print(f"  YOLO: {DATI_CLASSES[panel_det['class_id']]} ({panel_det['conf']:.0%})")
        panel_str = f"{panel_det['x1']:.1f},{panel_det['y1']:.1f},{panel_det['x2']:.1f},{panel_det['y2']:.1f}"
    else:
        print(f"  YOLO 未检测到面板")
        panel_str = ""

    with open(img_path, 'rb') as f:
        files = {'img': ('test.png', f, 'image/png')}
        data = {'panel': panel_str} if panel_str else {}
        resp = requests.post(f"{backend_url}/api/dati/solve-image", files=files, data=data, timeout=30)

    result = resp.json()

    if result.get('success'):
        print(f"  使用投影法: {result.get('used_projection', False)}")
        print(f"  OCR 选项: {result.get('options', [])}")

        if result.get('proj_boxes'):
            print(f"  投影检测到的选项格:")
            for label, box in result['proj_boxes'].items():
                print(f"    {label}: ({box['x']}, {box['y']}) {box['w']}x{box['h']}")

        scores = result.get('scores', [])
        if scores:
            print(f"  匹配得分:")
            for s in scores[:4]:
                marker = "✅" if s == scores[0] else "  "
                print(f"    {marker} {s['name']}: NCC={s.get('ncc', 0):.4f}")

        best = result.get('best', {})
        letter = result.get('best_letter', '')
        if best.get('name'):
            print(f"  ✨ 最终答案: {letter} - {best['name']}")

        print(f"  耗时: {result.get('time_ms', 0):.0f}ms")
    else:
        print(f"  ❌ 失败: {result.get('error', '未知错误')}")