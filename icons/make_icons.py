import math
from PIL import Image, ImageDraw

def star_points(cx, cy, r_outer, r_inner, rotation=-90):
    pts = []
    for i in range(10):
        angle = math.radians(rotation + i * 36)
        r = r_outer if i % 2 == 0 else r_inner
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return pts

def make_icon(size):
    scale = 4
    big = size * scale
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = cy = big / 2
    r_outer = big * 0.46
    r_inner = r_outer * 0.42
    pts = star_points(cx, cy, r_outer, r_inner)
    draw.polygon(pts, fill=(245, 166, 35, 255), outline=(179, 111, 0, 255))
    img = img.resize((size, size), Image.LANCZOS)
    return img

for size in (16, 32, 48, 128):
    make_icon(size).save(f"icon{size}.png")

print("done")
