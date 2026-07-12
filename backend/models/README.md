# 地名识别模型 (place_rec)

基于 PaddleOCR PP-OCRv4 训练的地名识别模型，用于抓鬼助手的地名兜底识别。

## 模型信息

| 项目 | 值 |
|------|-----|
| 算法 | PP-OCRv4 (SVTR_LCNet) |
| 训练轮数 | 194 epochs |
| 验证集准确率 | 99.99% |
| ONNX 测试准确率 | 100% (14/14) |
| 模型大小 | 7.3 MB |
| 输入尺寸 | 3 × 48 × 320 |

## 文件位置

```
backend/models/
├── place.onnx      # ONNX 模型文件
└── place_dict.txt  # 字典文件 (30 字符)
```

## 字典内容

```
五 傲 儿 南 唐 国 城 境 外 大 女 宝 寿 山 庄 建 普 朱 村 来 梁 江 紫 西 观 象 邺 野 长 陀
```

支持的地图名：
- 傲来国、宝象国、长寿村、大唐境外、东海湾
- 建邺城、江南野外、女儿村、普陀山、五庄观
- 西梁女国、朱紫国

## 使用方法

### Python 调用

```python
import cv2
from services.place_recognizer import recognize_place

# 读取图片
image = cv2.imread("screenshot.png")

# 识别地名
map_name = recognize_place(image)
print(f"识别结果: {map_name}")
```

### 预处理说明

模型使用 PaddleOCR 标准预处理：

```python
import numpy as np
import cv2
import math

def resize_norm_img(img, image_shape=(3, 48, 320)):
    """保持宽高比缩放 + 归一化到 [-1, 1]"""
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
```

### ONNX Runtime 推理

```python
import onnxruntime as ort
import numpy as np

# 加载模型
session = ort.InferenceSession("models/place.onnx")

# 加载字典
with open("models/place_dict.txt", "r", encoding="utf-8") as f:
    chars = ['blank'] + [line.strip() for line in f if line.strip()]

# 预处理
norm_img = resize_norm_img(image)
tensor = np.expand_dims(norm_img, 0)

# 推理
output = session.run(None, {"x": tensor})[0]

# CTC 解码
indices = output[0].argmax(axis=-1)
text = []
last_idx = 0
for idx in indices:
    idx = int(idx)
    if idx != 0 and idx != last_idx:
        if idx < len(chars):
            text.append(chars[idx])
    last_idx = idx
result = ''.join(text)
```

## 训练方法

### 训练数据

训练数据位于原项目 `/Users/zhy/mh-996cajd/mhxy_web/data/ocr_dataset/`：

```
place_train_aug.txt  # 训练集 (134 张，数据增强后)
place_val.txt        # 验证集 (14 张)
place_dict.txt       # 字典 (30 字符)
```

### 训练命令

```bash
cd /Users/zhy/mh-996cajd/mhxy_web

# 训练
python3 PaddleOCR_tools/tools/train.py -c output/place_rec_aug/config.yml

# 验证
python3 PaddleOCR_tools/tools/eval.py -c output/place_rec_aug/config.yml \
  -o Global.pretrained_model=output/place_rec_aug/best_accuracy

# 导出推理模型
python3 PaddleOCR_tools/tools/export_model.py -c output/place_rec_aug/config.yml \
  -o Global.pretrained_model=output/place_rec_aug/best_accuracy \
     Global.save_inference_dir=output/place_rec_aug/inference

# 转换 ONNX
python3 -c "
import paddle2onnx
paddle2onnx.export(
    model_filename='output/place_rec_aug/inference/inference.json',
    params_filename='output/place_rec_aug/inference/inference.pdiparams',
    save_file='output/place_rec_aug/place_rec.onnx',
    opset_version=12
)
"
```

### 训练结果

```
[2026/07/12 07:20:09] ppocr INFO: acc:0.9999992857147959
[2026/07/12 07:20:09] ppocr INFO: norm_edit_dis:1.0
[2026/07/12 07:20:09] ppocr INFO: fps:5.4944770079783725
```

## 触发条件

在抓鬼助手后端 `rapidocr_recognizer.py` 中，当 PP-OCRv6 识别到坐标但未识别到地图名时，触发地名识别模型兜底：

```python
# 如果 OCR 未识别到地图名，但坐标识别到了，调用地名识别模型兜底
if not map_name and x_val and y_val:
    try:
        from services.place_recognizer import recognize_place
        map_name = recognize_place(image)
        if map_name and map_name in VALID_MAP_NAMES:
            logger.info(f"地名识别兜底: '{map_name}'")
    except Exception as e:
        logger.warning(f"地名识别兜底失败: {e}")
```

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-12 | 初始版本，基于 PP-OCRv4 训练，准确率 99.99% |