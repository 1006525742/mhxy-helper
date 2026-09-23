#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
复刻 jiabanma.com 的地图底图配色（逐像素复现其 CSS 滤镜链）：
  .china-map-base {
    opacity: .68;
    filter: grayscale(1) invert(1) brightness(2.8) contrast(1.45);
    mix-blend-mode: screen;
  }
  .city-map { background: #0c120f; }

我们的 china_map_dark_gold_backup.jpg 是「白底原图反相」的产物（黑底金线），
其灰度 ≈ 原图反相后的灰度（金线灰度 209 → 需还原到 255 基准），
因此直接对其灰度套 brightness(2.8)→contrast(1.45)→screen(#0c120f)→opacity(.68) 即可
得到与对方完全一致的观感。
"""
import os
from PIL import Image, ImageOps

BASE = os.path.dirname(__file__)
SRC  = os.path.join(BASE, 'assets', 'china_map_dark_gold_backup.jpg')   # 金线版（黑底亮线）
OUT  = os.path.join(BASE, 'assets', 'china_map_dark.jpg')
BACKUP_NEON = os.path.join(BASE, 'assets', 'china_map_dark_neon_backup.jpg')

BG = (12, 18, 15)          # 对方 .city-map 的 background #0c120f
BRIGHTNESS, CONTRAST, OPACITY = 2.8, 1.45, 0.68
GOLD_LUMA = 209.0          # 金线 (255,208,92) 的灰度，作为「反相原图 255」的基准

def css_brightness_contrast(v):
    """滤镜链后半段（invert 已隐含在输入里）：brightness(b) → contrast(c)"""
    b = min(255.0, v * BRIGHTNESS)
    c = (b / 255.0 - 0.5) * CONTRAST * 255.0 + 127.5
    return max(0.0, min(255.0, c))

def main():
    im = Image.open(SRC).convert('RGB')
    # 备份当前荧光青绿版
    if not os.path.exists(BACKUP_NEON):
        Image.open(OUT).save(BACKUP_NEON, quality=92)
        print('backup neon ->', BACKUP_NEON)

    gray = ImageOps.grayscale(im)
    # 还原到「原图反相灰度」基准：金线 209 → 255
    gray = gray.point(lambda p: min(255, int(p * 255.0 / GOLD_LUMA)))

    # brightness + contrast（逐像素 LUT）
    lut = [int(round(css_brightness_contrast(v))) for v in range(256)]
    lines = gray.point(lut)                      # 线稿亮度 0-255

    # screen 到 #0c120f，再 opacity .68 与背景混合 → 逐像素合成
    px = lines.load()
    out = Image.new('RGB', im.size, BG)
    po = out.load()
    for y in range(im.height):
        for x in range(im.width):
            v = px[x, y]
            r = int(OPACITY * (255 - (255 - v) * (255 - BG[0]) // 255) + (1 - OPACITY) * BG[0])
            g = int(OPACITY * (255 - (255 - v) * (255 - BG[1]) // 255) + (1 - OPACITY) * BG[1])
            b2 = int(OPACITY * (255 - (255 - v) * (255 - BG[2]) // 255) + (1 - OPACITY) * BG[2])
            po[x, y] = (r, g, b2)

    out.save(OUT, quality=90)
    print('saved ->', OUT, out.size)

if __name__ == '__main__':
    main()
