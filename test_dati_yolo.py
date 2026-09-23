#!/usr/bin/env python3
"""测试答题助手 YOLO 检测 + 答案识别"""
import json
import sys
from pathlib import Path
import io

try:
    import cv2
    import numpy as np
    from PIL import Image
    import requests
    import onnxruntime as ort
except ImportError as e:
    print(f"缺少依赖: {e}")
    sys.exit(1)

# YOLO 类别
DATI_CLASSES = ['签到答题', '安全问答', '梦幻课堂', '科举']

def nms(boxes, threshold=0.5):
    """非极大值抑制"""
    if not boxes:
        return []

    boxes = sorted(boxes, key=lambda x: x['conf'], reverse=True)
    keep = []

    while boxes:
        best = boxes.pop(0)
        keep.append(best)

        def iou(a, b):
            x1 = max(a['x1'], b['x1'])
            y1 = max(a['y1'], b['y1'])
            x2 = min(a['x2'], b['x2'])
            y2 = min(a['y2'], b['y2'])
            inter = max(0, x2 - x1) * max(0, y2 - y1)
            area_a = (a['x2'] - a['x1']) * (a['y2'] - a['y1'])
            area_b = (b['x2'] - b['x1']) * (b['y2'] - b['y1'])
            return inter / (area_a + area_b - inter) if (area_a + area_b - inter) > 0 else 0

        boxes = [b for b in boxes if iou(best, b) <= threshold]

    return keep


def test_image(img_path: str, backend_url: str = "http://127.0.0.1:8008"):
    """测试单张图片：YOLO检测 + 后端识别"""
    print(f"\n{'='*60}")
    print(f"测试图片: {img_path}")

    img = cv2.imread(img_path)
    if img is None:
        print(f"无法读取图片: {img_path}")
        return

    h, w = img.shape[:2]
    print(f"图片尺寸: {w}x{h}")

    # 1. YOLO 检测（使用 ONNX Runtime）
    try:
        session = ort.InferenceSession("/Users/zhy/mhxy-helper/frontend/public/models/dati_best.onnx")

        # 获取输入尺寸
        input_name = session.get_inputs()[0].name
        input_dims = session.get_inputs()[0].shape
        input_size = input_dims[2]  # NCHW
        print(f"模型输入: {input_name}, shape={input_dims}, size={input_size}")

        # 预处理：letterbox + normalize
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # letterbox 参数
        scale = min(input_size / h, input_size / w)
        new_h, new_w = int(h * scale), int(w * scale)
        pad_h = (input_size - new_h) // 2
        pad_w = (input_size - new_w) // 2

        resized = cv2.resize(img_rgb, (new_w, new_h))
        letterbox = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
        letterbox[pad_h:pad_h+new_h, pad_w:pad_w+new_w] = resized

        # 归一化 + NCHW
        input_tensor = letterbox.astype(np.float32) / 255.0
        input_tensor = input_tensor.transpose(2, 0, 1)[None]  # HWC -> NCHW

        # 推理
        outputs = session.run(None, {input_name: input_tensor})
        output = outputs[0]
        dims = output.shape
        print(f"输出 shape: {dims}")

        # 解析输出 - YOLOv8 输出 shape: [1, 4+nc, num_anchors]
        # dims = (1, 8, 4725) => channels=8, num_anchors=4725
        # 8 = 4(coords) + 4(classes)
        channels = dims[1]
        num_anchors = dims[2]
        num_classes = channels - 4
        print(f"检测到 {num_classes} 个类别, {num_anchors} 个 anchors")

        detections = []
        conf_threshold = 0.4

        for i in range(num_anchors):
            # 读取 cx, cy, w, h (前4个channel)
            cx = output[0, 0, i]
            cy = output[0, 1, i]
            bw = output[0, 2, i]
            bh = output[0, 3, i]

            # 找最大类别置信度 (后 num_classes 个channel)
            max_class_conf = 0
            class_id = 0
            for c in range(num_classes):
                conf = output[0, 4 + c, i]
                if conf > max_class_conf:
                    max_class_conf = conf
                    class_id = c

            if max_class_conf > conf_threshold:
                # 模型网格坐标 -> 原图坐标 (letterbox 反变换)
                x1 = (cx - bw / 2 - pad_w) / scale
                y1 = (cy - bh / 2 - pad_h) / scale
                x2 = (cx + bw / 2 - pad_w) / scale
                y2 = (cy + bh / 2 - pad_h) / scale

                detections.append({
                    'x1': max(0, min(w, x1)),
                    'y1': max(0, min(h, y1)),
                    'x2': max(0, min(w, x2)),
                    'y2': max(0, min(h, y2)),
                    'conf': float(max_class_conf),
                    'class_id': class_id,
                    'class_name': DATI_CLASSES[class_id] if class_id < len(DATI_CLASSES) else f"class_{class_id}"
                })

        # NMS
        detections = nms(detections, 0.5)

        if detections:
            det = detections[0]
            print(f"\n🎯 YOLO 检测结果:")
            print(f"   类别: {det['class_name']} (class_id={det['class_id']})")
            print(f"   置信度: {det['conf']:.2%}")
            print(f"   边界框: ({det['x1']:.0f}, {det['y1']:.0f}) -> ({det['x2']:.0f}, {det['y2']:.0f})")
            print(f"   尺寸: {det['x2']-det['x1']:.0f} x {det['y2']-det['y1']:.0f}")
        else:
            print("\n❌ YOLO 未检测到答题面板")

        # 2. 调用后端识别答案
        panel = f"{det['x1']:.1f},{det['y1']:.1f},{det['x2']:.1f},{det['y2']:.1f}" if detections else ""

        with open(img_path, 'rb') as f:
            files = {'img': ('test.png', f, 'image/png')}
            data = {'panel': panel} if panel else {}
            resp = requests.post(f"{backend_url}/api/dati/solve-image", files=files, data=data, timeout=30)

        result = resp.json()

        if result.get('success'):
            print(f"\n📝 OCR 选项: {result.get('options', [])}")

            scores = result.get('scores', [])
            if scores:
                print(f"\n🏆 匹配得分:")
                for i, s in enumerate(scores[:4]):
                    marker = "✅" if i == 0 else "  "
                    print(f"   {marker} {s['name']}: NCC={s.get('ncc', 0):.4f}, 相对分={s.get('score', 0):.2%}")

            best = result.get('best', {})
            letter = result.get('best_letter', '')
            if best.get('name'):
                print(f"\n✨ 最终答案: {letter} - {best['name']}")
            else:
                print(f"\n⚠️ 未能识别正确答案")
        else:
            print(f"\n❌ 后端识别失败: {result.get('error', '未知错误')}")

        # 3. 绘制可视化
        output_path = Path(img_path).parent / f"yolo_test_{Path(img_path).name}"
        vis_img = img.copy()

        # 绘制 YOLO 框（黄色）
        for det in detections[:1]:
            x1, y1, x2, y2 = int(det['x1']), int(det['y1']), int(det['x2']), int(det['y2'])
            cv2.rectangle(vis_img, (x1, y1), (x2, y2), (0, 255, 255), 2)
            label = f"{det['class_name']} {det['conf']:.0%}"
            cv2.putText(vis_img, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

        # 绘制图标框（绿色）
        if result.get('icon_box'):
            ib = result['icon_box']
            ix1 = int(ib['x1'] * w)
            iy1 = int(ib['y1'] * h)
            ix2 = int(ib['x2'] * w)
            iy2 = int(ib['y2'] * h)
            cv2.rectangle(vis_img, (ix1, iy1), (ix2, iy2), (0, 255, 0), 2)
            cv2.putText(vis_img, "Icon", (ix1, iy1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        # 绘制答案红框
        if result.get('success') and result.get('answer_box'):
            ab = result['answer_box']
            ax, ay, aw, ah = int(ab['x']), int(ab['y']), int(ab['w']), int(ab['h'])
            cv2.rectangle(vis_img, (ax, ay), (ax+aw, ay+ah), (0, 0, 255), 3)
            letter = result.get('best_letter', '?')
            cv2.putText(vis_img, f"Answer: {letter}", (ax, ay - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

        cv2.imwrite(str(output_path), vis_img)
        print(f"\n📸 可视化结果已保存: {output_path}")

        return detections, result

    except Exception as e:
        print(f"处理失败: {e}")
        import traceback
        traceback.print_exc()
        return [], {}


if __name__ == "__main__":
    test_images = [
        "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-02-10.png",
        "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-04-58.png",
        "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-05-50.png",
        "/Users/zhy/Pictures/dialog_Snipaste_2026-09-08_23-09-05.png",
    ]

    for img in test_images:
        if Path(img).exists():
            test_image(img)