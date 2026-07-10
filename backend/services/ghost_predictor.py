#!/usr/bin/env python3
"""抓鬼预测模块 - 整合 menghuan_ocr 的地图坐标标注和象限预测功能

功能：
1. 根据坐标在地图上标注位置
2. 预测小鬼可能出现的象限区域
"""
import os
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent  # backend 目录
MAPS_DIR = BASE_DIR / "data" / "maps"

# 地图信息配置（来自 menghuan_ocr）
# 格式：显示名称 -> [缩写列表, 宽度, 高度, 图片文件名, 特殊颜色]
MAP_CONFIGS = {
    '傲来国': {
        'names': ['傲来国', '傲来', '来国', '傲', '来'],
        'width': 224,
        'height': 150,
        'file': 'alg.png',
        'area_color': (255, 100, 100, 80)  # RGBA - 半透明红色，更淡
    },
    '宝象国': {
        'names': ['宝象国', '宝象', '象国', '宝', '象'],
        'width': 160,
        'height': 120,
        'file': 'bxg.png',
        'area_color': (255, 0, 0, 128)
    },
    '长寿村': {
        'names': ['长寿村', '长寿', '寿村', '长', '寿'],
        'width': 160,
        'height': 210,
        'file': 'csc.png',
        'area_color': (255, 0, 0, 128)
    },
    '大唐境外': {
        'names': ['大唐境外', '大唐', '唐境外', '境外', '大', '唐', '境'],
        'width': 640,
        'height': 120,
        'file': 'dtjw.png',
        'area_color': (255, 0, 0, 128)
    },
    '建邺城': {
        'names': ['建邺城', '建邺', '邺城', '建', '邺'],
        'width': 288,
        'height': 144,
        'file': 'jyc.png',
        'area_color': (255, 0, 0, 128)
    },
    '江南野外': {
        'names': ['江南野外', '江南', '南野外', '野外', '江', '南', '野'],
        'width': 160,
        'height': 120,
        'file': 'jnyw.png',
        'area_color': (255, 0, 0, 128)
    },
    '女儿村': {
        'names': ['女儿村', '女儿', '儿村', '儿'],
        'width': 130,
        'height': 144,
        'file': 'nec.png',
        'area_color': (255, 0, 0, 128)
    },
    '普陀山': {
        'names': ['普陀山', '普陀', '陀山', '普', '陀'],
        'width': 95,
        'height': 72,
        'file': 'pts.png',
        'area_color': (255, 0, 0, 128)
    },
    '五庄观': {
        'names': ['五庄观', '五庄', '庄观', '五', '庄'],
        'width': 100,
        'height': 75,
        'file': 'wzg.png',
        'area_color': (255, 0, 0, 128)
    },
    '西凉女国': {
        'names': ['西凉女国', '西凉', '凉女国', '西', '凉', '女国'],
        'width': 163,
        'height': 124,
        'file': 'xlng.png',
        'area_color': (255, 0, 0, 128)
    },
    '朱紫国': {
        'names': ['朱紫国', '朱紫', '紫国', '朱', '紫'],
        'width': 191,
        'height': 120,
        'file': 'zzg.png',
        'area_color': (255, 0, 0, 128)
    },
}

# 额外支持地图名（宝图坐标中出现的）
EXTRA_MAP_NAMES = {
    '长寿郊外': '长寿村',  # 归类到长寿村
    '江南野外': '江南野外',
}


@dataclass
class MapInfo:
    """地图信息"""
    name: str
    names: List[str] = field(default_factory=list)
    width: int = 0
    height: int = 0
    image_path: str = ""
    area_color: Tuple[int, int, int, int] = (255, 0, 0, 128)

    # 运行时计算的字段
    image_width: int = 0
    image_height: int = 0
    scale_width: float = 1.0
    scale_height: float = 1.0
    background_image: Optional[Image.Image] = None

    border_size: int = 20  # 边框留白（减小以便看清地图）

    def load_image(self):
        """加载地图图片"""
        if not self.image_path or not os.path.exists(self.image_path):
            logger.warning(f"地图图片不存在: {self.image_path}")
            return False

        try:
            image = Image.open(self.image_path).convert("RGBA")
            self.image_width, self.image_height = image.size
            self.scale_width = self.width / self.image_width if self.image_width > 0 else 1
            self.scale_height = self.height / self.image_height if self.image_height > 0 else 1

            # 创建带边框的背景图
            self.background_image = Image.new('RGBA',
                (self.image_width + 2 * self.border_size,
                 self.image_height + 2 * self.border_size),
                (255, 255, 255, 0))
            self.background_image.paste(image, (self.border_size, self.border_size), image)

            # 绘制坐标轴
            self._draw_axis()

            logger.debug(f"加载地图 {self.name}: 图片{self.image_width}x{self.image_height}, "
                        f"缩放{self.scale_width:.2f}x{self.scale_height:.2f}")
            return True
        except Exception as e:
            logger.error(f"加载地图图片失败: {e}")
            return False

    def _draw_axis(self):
        """绘制坐标轴刻度"""
        if not self.background_image:
            return

        draw = ImageDraw.Draw(self.background_image)
        axis_space = 5  # 减小刻度间距
        coordinate_scale = 50

        # X轴刻度
        for i in range(0, self.width + 1, coordinate_scale):
            x = self.border_size + i / self.scale_width
            y = self.border_size + self.image_height
            draw.line((x, y, x, y + axis_space), fill="black", width=1)
            draw.text((x - 5, y + axis_space + 2), str(i), fill="black")

        # X轴末尾
        if self.width % coordinate_scale != 0:
            x = self.border_size + self.width / self.scale_width
            y = self.border_size + self.image_height
            draw.line((x, y, x, y + axis_space), fill="black", width=1)
            draw.text((x - 5, y + axis_space + 2), str(self.width), fill="black")

        # Y轴刻度
        for i in range(0, self.height + 1, coordinate_scale):
            x = self.border_size
            y = self.border_size + self.image_height - i / self.scale_height
            draw.line((x - axis_space, y, x, y), fill="black", width=1)
            draw.text((x - axis_space - 5, y - 5), str(i), fill="black")

        # Y轴末尾
        if self.height % coordinate_scale != 0:
            x = self.border_size
            y = self.border_size + self.image_height - self.height / self.scale_height
            draw.line((x - axis_space, y, x, y), fill="black", width=1)
            draw.text((x - axis_space - 5, y - 5), str(self.height), fill="black")


@dataclass
class GhostPrediction:
    """抓鬼预测结果"""
    map_name: str = ""
    x: int = 0
    y: int = 0
    position_areas: List[int] = field(default_factory=list)  # 可能的象限 [1,2,3,4]
    corner_areas: List[int] = field(default_factory=list)  # 四角规律优先的角落 [1,2,3,4]
    confidence: str = ""
    map_info: Optional[MapInfo] = None
    annotated_image: Optional[Image.Image] = None


class GhostPredictor:
    """抓鬼预测器"""

    def __init__(self):
        self.maps: dict[str, MapInfo] = {}
        self._load_maps()

    def _load_maps(self):
        """加载所有地图信息"""
        for name, config in MAP_CONFIGS.items():
            map_info = MapInfo(
                name=name,
                names=config['names'],
                width=config['width'],
                height=config['height'],
                image_path=str(MAPS_DIR / config['file']),
                area_color=config.get('area_color', (255, 0, 0, 128))
            )
            map_info.load_image()
            self.maps[name] = map_info

        logger.info(f"加载 {len(self.maps)} 个地图")

    def find_map(self, map_name: str) -> Optional[MapInfo]:
        """根据地图名查找地图信息（支持模糊匹配）"""
        if not map_name:
            return None

        # 清理地图名（去除可能的空格和特殊字符）
        map_name = map_name.strip()

        # 先精确匹配
        if map_name in self.maps:
            return self.maps[map_name]

        # 检查额外映射
        if map_name in EXTRA_MAP_NAMES:
            actual_name = EXTRA_MAP_NAMES[map_name]
            return self.maps.get(actual_name)

        # 模糊匹配：检查地图别名
        for name, map_info in self.maps.items():
            # 检查是否匹配别名列表
            for alias in map_info.names:
                if alias in map_name or map_name in alias:
                    return map_info
            # 检查地图名是否包含在输入中
            if name in map_name or map_name in name:
                return map_info

        logger.warning(f"未找到地图: {map_name}")
        return None

    def predict_position_areas(self, x: int, y: int, map_info: MapInfo) -> Tuple[List[int], List[int], str, bool]:
        """预测小鬼可能出现的象限区域（按地图尺寸比例判断）

        象限定义：
            2 | 1
            -----
            3 | 4

        Args:
            x: X坐标
            y: Y坐标
            map_info: 地图信息

        Returns:
            (可能象限列表, 四角优先象限列表, 置信度描述, 是否中间区域)
        """
        # 普陀山和五庄观特殊处理（GUI原版逻辑）
        if map_info.name in ['普陀山', '五庄观']:
            return [3], [], "可信度：100%", False

        position_areas = [2, 1, 3, 4]

        # 按地图尺寸比例计算阈值
        map_w = map_info.width
        map_h = map_info.height
        x_threshold_low = map_w * 0.25   # 25% 左侧边界
        x_threshold_high = map_w * 0.75  # 75% 右侧边界
        y_threshold_low = map_h * 0.25   # 25% 下侧边界
        y_threshold_high = map_h * 0.75  # 75% 上侧边界

        # 判断是否在中间区域
        x_in_middle = x_threshold_low <= x <= x_threshold_high
        y_in_middle = y_threshold_low <= y <= y_threshold_high
        is_middle_area = x_in_middle and y_in_middle

        # 根据坐标比例排除不可能的象限
        if x > x_threshold_high:
            self._remove_from_list(position_areas, [2, 3])  # 排除左侧
        if x < x_threshold_low:
            self._remove_from_list(position_areas, [1, 4])  # 排除右侧
        if y > y_threshold_high:
            self._remove_from_list(position_areas, [3, 4])  # 排除下方
        if y < y_threshold_low:
            self._remove_from_list(position_areas, [2, 1])  # 排除上方

        # 计算置信度
        if len(position_areas) == 1:
            confidence = "可信度：100%"
        elif len(position_areas) == 2:
            confidence = "可信度：50%"
        elif len(position_areas) == 3:
            confidence = "可信度：33%"
        else:
            confidence = "可信度：25%"

        # 四角规律（鬼偏爱往地图角落跑）
        corner_areas = []
        x_corner = []
        y_corner = []

        # x方向偏好（按比例）
        if x > x_threshold_high:
            x_corner = [1, 4]  # 坐标偏右 → 鬼在右侧角落
        elif x < x_threshold_low:
            x_corner = [2, 3]  # 坐标偏左 → 鬼在左侧角落

        # y方向偏好（按比例）
        if y > y_threshold_high:
            y_corner = [1, 2]  # 坐标偏上 → 鬼在上侧角落
        elif y < y_threshold_low:
            y_corner = [3, 4]  # 坐标偏下 → 鬿在下侧角落

        # 取x和y方向偏好的交集 → 最近角落概率最大
        if x_corner and y_corner:
            corner_areas = [a for a in position_areas if a in x_corner and a in y_corner]

        # 如果没有严格交集，取x或y方向的偏好
        if not corner_areas:
            all_corner = set(x_corner + y_corner)
            corner_areas = [a for a in position_areas if a in all_corner]

        # 中间区域：目标点正负25为高命中区域
        if is_middle_area:
            confidence += "（中间区域，高命中: 目标点±25）"
        elif corner_areas:
            corners_str = '/'.join([str(c) for c in corner_areas])
            confidence += f"（四角优先: {corners_str}）"

        return position_areas, corner_areas, confidence, is_middle_area

    def _remove_from_list(self, lst: list, values: list):
        """从列表中移除多个值"""
        for v in values:
            if v in lst:
                lst.remove(v)

    def predict(self, map_name: str, x: int, y: int) -> GhostPrediction:
        """预测小鬼位置

        Args:
            map_name: 地图名
            x: X坐标
            y: Y坐标

        Returns:
            GhostPrediction 预测结果
        """
        prediction = GhostPrediction(map_name=map_name, x=x, y=y)

        # 查找地图
        map_info = self.find_map(map_name)
        if not map_info:
            prediction.confidence = "未找到地图信息"
            return prediction

        prediction.map_info = map_info

        # 预测象限
        areas, corner_areas, confidence, is_middle_area = self.predict_position_areas(x, y, map_info)
        prediction.position_areas = areas
        prediction.corner_areas = corner_areas
        prediction.confidence = confidence

        # 标注地图
        prediction.annotated_image = self._draw_coordinate_on_map(
            map_info, x, y, areas, corner_areas, is_middle_area
        )

        return prediction

    def _draw_coordinate_on_map(self, map_info: MapInfo, x: int, y: int,
                                 position_areas: List[int],
                                 corner_areas: List[int] = None,
                                 is_middle_area: bool = False) -> Optional[Image.Image]:
        """在地图上标注坐标位置

        Args:
            map_info: 地图信息
            x: X坐标
            y: Y坐标
            position_areas: 预测的象限区域
            corner_areas: 四角规律优先的角落区域（蒙版更深）
            is_middle_area: 是否在中间区域（目标点±25高命中）

        Returns:
            标注后的地图图片
        """
        if corner_areas is None:
            corner_areas = []

        if not map_info.background_image:
            return None

        # 复制背景图
        image = map_info.background_image.copy()
        draw = ImageDraw.Draw(image)

        # 地图区域边界（不含边框刻度）
        map_left = map_info.border_size
        map_top = map_info.border_size
        map_right = map_info.border_size + map_info.image_width
        map_bottom = map_info.border_size + map_info.image_height

        # 计算在图片上的位置
        px = x / map_info.scale_width + map_info.border_size
        py = map_info.image_height + map_info.border_size - y / map_info.scale_height

        # 确保标记点在地图区域内
        px = max(map_left, min(map_right, px))
        py = max(map_top, min(map_bottom, py))

        # 计算标记框大小（适配地图缩放）
        side = 30 / ((map_info.scale_width + map_info.scale_height) / 2)

        # 绘制象限蒙版（裁剪到地图区域）
        area_overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
        area_draw = ImageDraw.Draw(area_overlay)

        if is_middle_area:
            # 中间区域：绘制目标点±25的高命中区域（浅黄色蒙版）
            # 将±25转换为图片坐标
            offset_px = 25 / map_info.scale_width
            offset_py = 25 / map_info.scale_height

            high_hit_rect = (
                px - offset_px,
                py - offset_py,
                px + offset_px,
                py + offset_py
            )
            high_hit_rect = self._clip_rect_to_map(high_hit_rect, map_left, map_top, map_right, map_bottom)
            # 浅黄色半透明蒙版（高命中区域）
            area_draw.rectangle(high_hit_rect, fill=(255, 255, 100, 100))
        else:
            # 非中间区域：绘制象限蒙版
            for quadrant in position_areas:
                rect = self._get_quadrant_rect(px, py, side, quadrant)
                rect = self._clip_rect_to_map(rect, map_left, map_top, map_right, map_bottom)
                if quadrant in corner_areas:
                    # 四角优先区域：深红色
                    area_draw.rectangle(rect, fill=(255, 0, 0, 180))
                else:
                    # 普通预测区域：浅黄色半透明
                    area_draw.rectangle(rect, fill=(255, 255, 100, 80))

        image = Image.alpha_composite(image, area_overlay)

        # 绘制黄色方框标记当前位置（在蒙版之上）
        draw2 = ImageDraw.Draw(image)
        box_rect = self._clip_rect_to_map(
            (px - side, py - side, px + side, py + side),
            map_left, map_top, map_right, map_bottom
        )
        draw2.rectangle(box_rect, outline="yellow", width=2)

        # 绘制中心坐标点（黄色圆点）
        point_radius = side * 0.15
        point_rect = self._clip_rect_to_map(
            (px - point_radius, py - point_radius, px + point_radius, py + point_radius),
            map_left, map_top, map_right, map_bottom
        )
        draw2.ellipse(point_rect, fill="yellow")

        # 在标记旁边写坐标文字（确保不超出边界）
        text_x = px + side + 4
        text_y = py - 8
        if text_x > map_right - 60:
            text_x = px - side - 60
        if text_y < map_top:
            text_y = py + 4

        text = f"({x},{y})"
        draw2.text((text_x, text_y), text, fill="red")

        return image

    def _clip_rect_to_map(self, rect, map_left, map_top, map_right, map_bottom):
        """裁剪矩形到地图区域内"""
        x1, y1, x2, y2 = rect
        x1 = max(map_left, min(map_right, x1))
        y1 = max(map_top, min(map_bottom, y1))
        x2 = max(map_left, min(map_right, x2))
        y2 = max(map_top, min(map_bottom, y2))
        return (x1, y1, x2, y2)

    def _get_quadrant_rect(self, px, py, side, quadrant):
        """获取象限对应的矩形区域"""
        if quadrant == 1:  # 右上
            return (px, py - side, px + side, py)
        elif quadrant == 2:  # 左上
            return (px - side, py - side, px, py)
        elif quadrant == 3:  # 左下
            return (px - side, py, px, py + side)
        elif quadrant == 4:  # 右下
            return (px, py, px + side, py + side)
        return (0, 0, 0, 0)

    def get_map_list(self) -> List[str]:
        """获取支持的地图列表"""
        return list(self.maps.keys())


# 全局预测器实例
_predictor: Optional[GhostPredictor] = None

def get_predictor() -> GhostPredictor:
    """获取预测器单例"""
    global _predictor
    if _predictor is None:
        _predictor = GhostPredictor()
    return _predictor


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

    predictor = get_predictor()

    # 测试预测
    print("支持的地图:", predictor.get_map_list())

    # 测试：长寿村 (100, 80) - 边缘区域
    result = predictor.predict("长寿村", 100, 80)
    print(f"\n预测结果: {result.map_name} ({result.x}, {result.y})")
    print(f"可能象限: {result.position_areas}")
    print(f"置信度: {result.confidence}")

    # 测试：长寿村 (80, 105) - 中间区域 (160x210的地图, 25%-75%范围)
    result2 = predictor.predict("长寿村", 80, 105)
    print(f"\n预测结果: {result2.map_name} ({result2.x}, {result2.y})")
    print(f"可能象限: {result2.position_areas}")
    print(f"置信度: {result2.confidence}")

    # 测试：江南野外 (80, 60)
    result3 = predictor.predict("江南野外", 80, 60)
    print(f"\n预测结果: {result3.map_name} ({result3.x}, {result3.y})")
    print(f"可能象限: {result3.position_areas}")
    print(f"置信度: {result3.confidence}")
