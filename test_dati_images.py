#!/usr/bin/env python3
"""测试答题助手：YOLO检测 + solve-image API"""
import io
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
import onnxruntime as ort

# YOLO 配置 (与前端 onnxYolo.ts 对齐)
MODEL_PATH = Path(__file__).parent / "frontend/public/models/dati_best.onnx"
INPUT_SIZE = 480
CONF_THRESHOLD = 0.4
NMS_THRESHOLD = 0.5
CLASS_NAMES = ['c0', 'c1', 'c2', 'c3']

def letterbox(img, target_size):
    """保持宽高比缩放，四周填灰114"""
    h, w = img.shape[:2]
    scale = min(target_size / w, target_size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    pad_x = (target_size - nw) // 2
    pad_y = (target_size - nh) // 2
    canvas = np.full((target_size, target_size, 3), 114, dtype=np.uint8)
    canvas[pad_y:pad_y+nh, pad_x:pad_x+nw] = resized
    return canvas, scale, pad_x, pad_y

def preprocess(img):
    """Letterbox + CHW RGB 归一化"""
    lb, scale, px, py = letterbox(img, INPUT_SIZE)
    rgb = cv2.cvtColor(lb, cv2.COLOR_BGR2RGB)
    tensor = rgb.astype(np.float32) / 255.0
    tensor = tensor.transpose(2, 0, 1)  # HWC -> CHW
    return tensor[np.newaxis, ...], scale, px, py

def nms(boxes, threshold):
    """非极大值抑制"""
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda x: x['conf'], reverse=True)
    keep = []
    while boxes:
        best = boxes.pop(0)
        keep.append(best)
        boxes = [b for b in boxes if iou(best, b) <= threshold]
    return keep

def iou(a, b):
    ax1, ay1, ax2, ay2 = a['x1'], a['y1'], a['x2'], a['y2']
    bx1, by1, bx2, by2 = b['x1'], b['y1'], b['x2'], b['y2']
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    aa = (ax2 - ax1) * (ay2 - ay1)
    ba = (bx2 - bx1) * (by2 - by1)
    return inter / (aa + ba - inter) if (aa + ba - inter) > 0 else 0

def run_yolo(img):
    """运行 YOLO 推理，返回检测框列表"""
    session = ort.InferenceSession(str(MODEL_PATH))
    tensor, scale, px, py = preprocess(img)
    out_name = session.get_outputs()[0].name
    out = session.run([out_name], {'images': tensor})[0]

    # 输出 shape: [1, 4+nc, anchors] 或 [1, anchors, 4+nc]
    dims = out.shape
    if dims[1] < dims[2]:
        # [1, channels, anchors]: out[0, ch, anchor]
        transpose = True
    else:
        # [1, anchors, channels]: out[0, anchor, ch]
        transpose = False

    # 统一转成 [anchors, channels] 方便索引
    mat = out[0].T if transpose else out[0]
    num_anchors, channels = mat.shape

    h, w = img.shape[:2]
    boxes = []
    for i in range(num_anchors):
        cx, cy, bw, bh = mat[i, 0], mat[i, 1], mat[i, 2], mat[i, 3]

        # 找最大类别置信度
        class_confs = mat[i, 4:]
        cid = int(np.argmax(class_confs))
        max_conf = float(class_confs[cid])

        if max_conf > CONF_THRESHOLD:
            # 模型坐标 -> 原图坐标 (letterbox 反算)
            ox = (cx - px) / scale
            oy = (cy - py) / scale
            x1 = max(0, min(w, ox - bw / 2))
            y1 = max(0, min(h, oy - bh / 2))
            x2 = max(0, min(w, ox + bw / 2))
            y2 = max(0, min(h, oy + bh / 2))
            boxes.append({
                'x1': int(x1), 'y1': int(y1), 'x2': int(x2), 'y2': int(y2),
                'conf': float(max_conf), 'class_id': int(cid),
                'class_name': CLASS_NAMES[cid] if cid < len(CLASS_NAMES) else f'c{cid}'
            })

    return nms(boxes, NMS_THRESHOLD)

def call_solve_image(img_path):
    """调用 /api/dati/solve-image API"""
    import urllib.request
    url = "http://127.0.0.1:8008/api/dati/solve-image"
    with open(img_path, 'rb') as f:
        img_data = f.read()

    boundary = "----dati"
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"img\"; filename=\"test.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n".encode()
        + img_data
        + f"\r\n--{boundary}--\r\n".encode()
    )

    req = urllib.request.Request(url, data=body,
                                  headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)

def draw_results(img_path, detections, solve_result, output_path):
    """绘制结果并保存"""
    img = cv2.imread(str(img_path))
    h, w = img.shape[:2]

    # 绘制 YOLO 检测框 (黄色虚线)
    for d in detections:
        x1, y1, x2, y2 = d['x1'], d['y1'], d['x2'], d['y2']
        # 虚线效果
        color = (0, 184, 230)  # BGR 黄色
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        label = f"{d['class_name']} {d['conf']*100:.0f}%"
        cv2.putText(img, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    # 绘制答题面板框 (如果 API 返回)
    if solve_result.get('success'):
        # 面板 (黄色虚线)
        panel_rel = {'x1': 0.157, 'y1': 0.278, 'x2': 0.837, 'y2': 0.727}
        px1, py1 = int(w * panel_rel['x1']), int(h * panel_rel['y1'])
        px2, py2 = int(w * panel_rel['x2']), int(h * panel_rel['y2'])
        cv2.rectangle(img, (px1, py1), (px2, py2), (0, 184, 230), 2)
        cv2.putText(img, "Answer Panel", (px1, py1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 184, 230), 2)

        # 图标框 (绿色)
        if solve_result.get('icon_box'):
            ib = solve_result['icon_box']
            ix1, iy1 = int(w * ib['x1']), int(h * ib['y1'])
            ix2, iy2 = int(w * ib['x2']), int(h * ib['y2'])
            cv2.rectangle(img, (ix1, iy1), (ix2, iy2), (160, 230, 46), 3)  # 绿色
            cv2.putText(img, "Icon", (ix1, iy1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (160, 230, 46), 2)

        # 答案红框
        if solve_result.get('answer_box'):
            ab = solve_result['answer_box']
            pad = 5
            ax = max(0, ab['x'] - pad)
            ay = max(0, ab['y'] - pad)
            aw = ab['w'] + pad * 2
            ah = ab['h'] + pad * 2
            cv2.rectangle(img, (ax, ay), (ax + aw, ay + ah), (82, 82, 255), 3)  # 红色
            label = f"ANSWER: {solve_result['best_letter']} - {solve_result['best']['name']}"
            cv2.putText(img, label, (ax, ay - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (82, 82, 255), 2)

    cv2.imwrite(str(output_path), img)
    print(f"  Saved: {output_path}")

def main():
    test_dir = Path("/Users/zhy/Pictures")
    output_dir = Path("/Users/zhy/mhxy-helper/test_results")
    output_dir.mkdir(exist_ok=True)

    images = sorted(test_dir.glob("dialog_Snipaste*.png"))

    for img_path in images:
        print(f"\n=== {img_path.name} ===")

        # 1. YOLO 检测
        img = cv2.imread(str(img_path))
        dets = run_yolo(img)
        print(f"  YOLO 检测: {len(dets)} 个框")
        for d in dets:
            print(f"    [{d['class_name']}] ({d['x1']},{d['y1']})-({d['x2']},{d['y2']}) conf={d['conf']:.2f}")

        # 2. solve-image API
        result = call_solve_image(img_path)
        if result['success']:
            print(f"  API 结果: {result['best_letter']} - {result['best']['name']} (NCC={result['best'].get('ncc', result['best'].get('score')):.3f})")
            print(f"  选项: {result['options']}")
            print(f"  耗时: {result['time_ms']:.0f}ms")
        else:
            print(f"  API 失败: {result.get('error')}")

        # 3. 绘制结果
        out_path = output_dir / f"annotated_{img_path.name}"
        draw_results(img_path, dets, result, out_path)

if __name__ == "__main__":
    main()