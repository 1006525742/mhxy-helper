#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 china_map_dark.jpg（黑底金线，审图号已保留）重上色为「黑底荧光青绿线 + 外发光」。
基于已有成品做色彩重映射，不重跑去红/涂图例步骤，审图号文字原样保留（合规）。
"""
import os, sys
from PIL import Image, ImageOps, ImageFilter, ImageChops

SRC = os.path.join(os.path.dirname(__file__), 'assets', 'china_map_dark.jpg')

# 荧光青绿三段色：黑(底) → mid(中间调) → white(最亮线)
BLACK = (6, 9, 14)          # 近黑底
MID   = (0, 128, 104)       # 中间调过渡
WHITE = (140, 255, 216)     # 荧光青绿线（略带白心，更"荧光"）

def main():
    im = Image.open(SRC).convert('RGB')
    w, h = im.size
    print('source:', im.size)

    # 1) 灰度 → 重上色（黑底青绿线）
    gray = ImageOps.grayscale(im)
    lines = ImageOps.colorize(gray, black=BLACK, white=WHITE, mid=MID)

    # 2) 外发光：取线稿亮部 mask → 高斯模糊 → 荧光色叠加（screen）
    mask = gray.point(lambda p: 255 if p > 46 else 0)
    glow_alpha = mask.filter(ImageFilter.GaussianBlur(9))
    glow_alpha = glow_alpha.point(lambda p: int(p * 0.85))          # 光晕强度
    glow = Image.new('RGB', im.size, (0, 230, 185))                 # 光晕颜色（青绿）
    lines = Image.composite(ImageChops.screen(lines, glow), lines,
                            Image.new('L', im.size, 0))             # noop 占位
    # screen 混合：以 glow_alpha 为权重把荧光色融进底图
    from PIL import ImageChops as C
    screened = C.screen(lines, glow)
    lines = Image.composite(screened, lines, glow_alpha)

    # 3) 轻微提亮线稿本身（荧光感）
    bright = C.screen(lines, Image.new('RGB', im.size, (0, 26, 20)))
    lines = Image.blend(lines, bright, 0.6)

    out = os.path.join(os.path.dirname(__file__), 'assets', 'china_map_dark.jpg')
    im_backup = out.replace('.jpg', '_gold_backup.jpg')
    if not os.path.exists(im_backup):
        Image.open(SRC).save(im_backup, quality=92)
        print('backup ->', im_backup)
    lines.save(out, quality=90)
    print('saved ->', out, lines.size)

if __name__ == '__main__':
    main()
