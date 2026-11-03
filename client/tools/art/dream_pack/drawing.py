"""Small pixel tools. Every source pixel is authored on the native grid; no AI/API."""
from __future__ import annotations
import math
from PIL import Image, ImageDraw, ImageFont

INK = '#24313e'
PAPER = '#f2e6bd'
BLUE = '#345b76'
GOLD = '#efbd70'


def canvas(size=(48, 48)):
    image = Image.new('RGBA', size)
    return image, ImageDraw.Draw(image)


def polygon(d, points, fill, outline=INK, width=1):
    pts = [(round(x), round(y)) for x, y in points]
    d.polygon(pts, fill=fill)
    if outline:
        d.line(pts + pts[:1], fill=outline, width=width, joint='curve')


def ellipse(d, bounds, fill, outline=INK, width=1):
    d.ellipse(tuple(round(v) for v in bounds), fill=fill, outline=outline, width=width)


def line(d, points, fill, width=1):
    d.line([(round(x), round(y)) for x, y in points], fill=fill, width=width, joint='curve')


def cubic(points, count=20):
    a, b, c, e = points
    result = []
    for i in range(count + 1):
        t = i / count
        u = 1 - t
        result.append((u**3*a[0] + 3*u*u*t*b[0] + 3*u*t*t*c[0] + t**3*e[0],
                       u**3*a[1] + 3*u*u*t*b[1] + 3*u*t*t*c[1] + t**3*e[1]))
    return result


def arc(d, center, radii, begin, end, color, width=1, samples=32):
    points = [(center[0] + math.cos(begin+(end-begin)*i/samples)*radii[0],
               center[1] + math.sin(begin+(end-begin)*i/samples)*radii[1])
              for i in range(samples+1)]
    line(d, points, color, width)


def resize(image, size):
    return image.resize(size, Image.Resampling.NEAREST)


def fade(image, alpha):
    image = image.copy()
    image.putalpha(image.getchannel('A').point(lambda a: round(a * alpha)))
    return image


def font(size=12):
    for path in ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/arial.ttf']:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def stars(d, seed=1, size=(320, 180), color='#c8d5cf', count=55):
    # Integer hash instead of global randomness, so every rebuild is byte-identical.
    for i in range(count):
        x = (i*73 + seed*41) % size[0]
        y = (i*i*11 + seed*19) % size[1]
        d.point((x, y), fill=color)
        if i % 9 == 0:
            line(d, [(x-1, y), (x+1, y)], color)


def sheet(frames, columns):
    w, h = frames[0].size
    image = Image.new('RGBA', (w*columns, h*math.ceil(len(frames)/columns)))
    for i, frame in enumerate(frames):
        image.alpha_composite(frame, (i % columns*w, i//columns*h))
    assert max(image.size) <= 2048
    return image


def checker(size, step=8):
    image = Image.new('RGBA', size, '#d9dfd5')
    d = ImageDraw.Draw(image)
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if (x//step + y//step) % 2:
                d.rectangle((x, y, x+step-1, y+step-1), fill='#c4cfc4')
    return image
