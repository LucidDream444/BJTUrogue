"""Shared raster drawing helpers for the photo-referenced campus art pack.

These helpers are build-time Pillow code, not game runtime dependencies.
Draw at native resolution; export enlargements with nearest-neighbor only.
"""
from __future__ import annotations

import random
from PIL import Image, ImageDraw

SIZE = 128
ANCHOR = (64, 108)
P = {
    'ink': '#252C2D', 'steel': '#303638', 'steel_light': '#515A5D',
    'steel_dark': '#1E2529', 'silver': '#A9B2AF', 'silver_light': '#E6E8DC',
    'silver_shadow': '#626F70', 'wood': '#C9AB68', 'wood_light': '#E1CB92',
    'wood_shadow': '#917143', 'wood_edge': '#B48B48', 'wood_dark': '#645036',
    'blue': '#4386B6', 'blue_light': '#77A7C9', 'blue_shadow': '#28516F',
    'blue_dark': '#203E55', 'curtain': '#465E78', 'curtain_light': '#71849A',
    'curtain_shadow': '#2C3E51', 'wall': '#D4D2C6', 'wall_light': '#E8E6DD',
    'wall_shadow': '#AAAFA6', 'tile': '#C5C1B4', 'tile_light': '#DBD8CB',
    'tile_shadow': '#A3A699', 'grout': '#969A90', 'concrete': '#7D807A',
    'concrete_light': '#A1A49C', 'concrete_shadow': '#595E5B',
    'stone': '#444B48', 'stone_light': '#6E7770', 'stone_shadow': '#2D3432',
    'brick': '#A96149', 'brick_light': '#C4866C', 'brick_shadow': '#754432',
    'mortar': '#B2A698', 'chalkboard': '#284B43', 'chalk_light': '#486D5E',
    'chalk_dark': '#1C3533', 'cream': '#DEDDD2', 'white': '#F0F0DF',
    'brown': '#554232', 'brown_light': '#7B6042', 'brown_dark': '#322F2A',
    'green': '#358457', 'green_light': '#96D59A', 'red': '#8D3C32',
    'red_light': '#B86049', 'stair': '#BFC1BA', 'stair_light': '#E0E0D6',
    'stair_shadow': '#939992',
}


def canvas() -> Image.Image:
    return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))


def tint(color, amount=0):
    """Shift RGB by a fixed small amount without changing alpha."""
    from PIL import ImageColor
    rgba = ImageColor.getcolor(color, 'RGBA') if isinstance(color, str) else color
    return tuple(max(0, min(255, n + amount)) for n in rgba[:3]) + (rgba[3] if len(rgba) > 3 else 255,)


def speckle(image, rect, colors, seed=0, density=.06):
    rng = random.Random(seed)
    d = ImageDraw.Draw(image)
    x0, y0, x1, y1 = [int(n) for n in rect]
    for _ in range(int((x1-x0)*(y1-y0)*density)):
        x, y = rng.randrange(x0, x1), rng.randrange(y0, y1)
        if image.getpixel((x, y))[3]:
            d.point((x, y), fill=rng.choice(colors))


def grain(image, rect, seed=0):
    rng = random.Random(seed)
    d = ImageDraw.Draw(image)
    x0, y0, x1, y1 = [int(n) for n in rect]
    for y in range(y0+2, y1-1, 3):
        x = rng.randrange(x0+1, max(x0+2, x1-6))
        d.line((x, y, min(x1-2, x+rng.randrange(4, 14)), y), fill=tint(P['wood'], -10))


def tube(d, points, width=3):
    """Crisp stepped stainless pipe with a narrow reflected highlight."""
    d.line(points, fill=P['silver_shadow'], width=width+2)
    d.line(points, fill=P['silver'], width=width)
    d.line([(x-1, y-1) for x,y in points], fill=P['silver_light'], width=1)


def paste_at(image, sprite, point, anchor=ANCHOR, scale=1):
    if scale != 1:
        sprite = sprite.resize((sprite.width*scale, sprite.height*scale), Image.Resampling.NEAREST)
    image.alpha_composite(sprite, (int(point[0]-anchor[0]*scale), int(point[1]-anchor[1]*scale)))
