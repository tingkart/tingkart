"""Turn a portrait into ASCII art for the neofetch card.

Usage: python3 scripts/ascii.py photo.jpg
Writes assets/ascii_light.txt and assets/ascii_dark.txt.
Run it once. The build script reads the text files.
"""
import sys, colorsys
from PIL import Image, ImageOps, ImageFilter

COLS, ROWS = 78, 44
RAMP = " .'`^,:;-~=+<>!i|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"

im = Image.open(sys.argv[1]).convert("RGB")
color = im.resize((COLS, ROWS), Image.LANCZOS)
gray = im.convert("L").filter(ImageFilter.UnsharpMask(4, 180, 2))
gray = ImageOps.equalize(gray).resize((COLS, ROWS), Image.LANCZOS)

def build(invert, gamma):
    lines = []
    for y in range(ROWS):
        row = ""
        for x in range(COLS):
            r, g, b = [c / 255 for c in color.getpixel((x, y))]
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            green_bg = 0.13 < h < 0.40 and s > 0.25 and v > 0.42
            post = x > COLS * 0.87 and y < ROWS * 0.62  # grey post at the right edge
            if green_bg or post:
                row += " "
                continue
            lum = gray.getpixel((x, y)) / 255
            density = (lum if invert else 1 - lum) ** gamma
            row += RAMP[min(len(RAMP) - 1, int(density * (len(RAMP) - 1)))]
        lines.append(row.rstrip())
    return "\n".join(lines) + "\n"

open("assets/ascii_dark.txt", "w").write(build(invert=True, gamma=1.3))
open("assets/ascii_light.txt", "w").write(build(invert=False, gamma=2.2))
print("wrote assets/ascii_light.txt and assets/ascii_dark.txt")
