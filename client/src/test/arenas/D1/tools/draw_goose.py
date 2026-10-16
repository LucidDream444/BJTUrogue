"""Photo-referenced domestic goose, locally drawn with Pillow (no image API).

Four torso views + ONE rotating straight neck/head. 24 frames in each atlas:
idle 0..3, waddle 4..11, shoot 12..15, hurt 16..19, fall 20..23.
The white goose photograph supplied by the user guides the silhouette,
small head, orange knob/bill and overlapping pointed feathers. The final
requested neck is 35% longer, with head and bill on its forward centerline.
Native 48px pixel grid, 18 colors, binary alpha, nearest-neighbor 2x export.
Fixed neck root (14,48), bill socket (84,48), native bill faces right.
"""
from pathlib import Path
import math
from PIL import Image, ImageChops, ImageDraw, ImageFont

CLIENT = Path(__file__).resolve().parents[5]
DEST = CLIENT / 'public/assets/sprites/player/goose'
OUT = CLIENT.parent / 'artifacts/goose'
SS = 4
PIVOT = (14, 48)
MOUTH = (84, 48)
# Measure the anatomical neck, excluding the unchanged head and bill.
# Previous upright root (32,82) to head/neck connection (40,54).
BASE_NECK_LENGTH = math.hypot(40-32, 54-82)
NECK_LENGTH = BASE_NECK_LENGTH * 1.35
HEAD_JOIN = PIVOT[0] + NECK_LENGTH
INK = '#647672'
WHITE = '#f8f9ef'
SHADE = '#cdd7d1'
LIGHT = '#ffffff'
ORANGE = '#e99439'
DARK_ORANGE = '#a45b2b'
WING_LINE = '#b5c3bd'
COLORS = ['#28322f', INK, '#8b9e97', WING_LINE, SHADE, '#dfe6dc',
          '#edf1e6', WHITE, LIGHT, DARK_ORANGE, '#c4712d', ORANGE,
          '#f5b44e', '#ffcd72', '#ffe3a0', '#705332', '#e8ecdf', '#d4d9c9']
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([int(color[i:i+2], 16) for color in COLORS for i in (1, 3, 5)]
                   + [0]*(768-len(COLORS)*3))


def curve(commands):
    points = []
    for command in commands:
        if len(command) == 2:
            points.append(command)
        else:
            x0, y0 = points[-1]
            x1, y1, x2, y2, x3, y3 = command
            for step in range(1, 25):
                t = step / 24
                u = 1-t
                points.append((u**3*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t**3*x3,
                               u**3*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t**3*y3))
    return points


class Canvas:
    def __init__(self, size=(96, 96)):
        self.size = size
        self.im = Image.new('RGBA', (size[0]*SS, size[1]*SS))

    def path(self, commands, fill=None, outline=None, width=1):
        points = [(round(x*SS), round(y*SS)) for x, y in curve(commands)]
        d = ImageDraw.Draw(self.im)
        if fill:
            d.polygon(points, fill=fill)
        if outline:
            if fill:
                points.append(points[0])
            d.line(points, fill=outline, width=max(1, round(width*SS)), joint='curve')

    def ellipse(self, box, fill, outline=None, width=1):
        ImageDraw.Draw(self.im).ellipse(tuple(round(v*SS) for v in box),
                                       fill=fill, outline=outline, width=max(1, round(width*SS)))

    def gradient(self, commands, top, bottom, outline=INK, width=1):
        mask = Image.new('L', self.im.size)
        points = [(round(x*SS), round(y*SS)) for x, y in curve(commands)]
        ImageDraw.Draw(mask).polygon(points, fill=255)
        bounds = mask.getbbox()
        if not bounds:
            return
        a = tuple(int(top[i:i+2], 16) for i in (1, 3, 5))
        b = tuple(int(bottom[i:i+2], 16) for i in (1, 3, 5))
        paint = Image.new('RGBA', self.im.size)
        d = ImageDraw.Draw(paint)
        for y in range(bounds[1], bounds[3]):
            t = (y-bounds[1]) / max(1, bounds[3]-bounds[1]-1)
            d.line((bounds[0], y, bounds[2], y), fill=tuple(round(v*(1-t)+w*t) for v, w in zip(a, b))+(255,))
        self.im.alpha_composite(Image.composite(paint, Image.new('RGBA', self.im.size), mask))
        if outline:
            self.path(commands, outline=outline, width=width)

    def clip(self, alpha):
        self.im.putalpha(ImageChops.multiply(self.im.getchannel('A'), alpha))

    def finish(self):
        small = self.im.resize((self.size[0]//2, self.size[1]//2), Image.Resampling.LANCZOS)
        pixels = small.convert('RGB').quantize(palette=PALETTE, dither=Image.Dither.NONE).convert('RGBA')
        pixels.putalpha(small.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
        return pixels.resize(self.size, Image.Resampling.NEAREST)


def foot(c, x, y, ankle=6):
    # Short ankle and a forward-pointing, three-toed web; not a round shoe.
    c.path([(x-1, y-ankle), (x+2, y-ankle), (x+2, y-1), (x+10, y+1),
            (x+7, y+3), (x+3, y+2), (x+1, y+4), (x-2, y+2),
            (x-6, y+2), (x-5, y), (x-1, y-1)], fill=ORANGE, outline=DARK_ORANGE, width=.9)
    c.path([(x-3, y+.2), (x+2, y, x+5, y+1, x+7, y+1)], outline='#ffcd72', width=1)
    c.path([(x+1, y), (x+2, y+2)], outline='#c4712d', width=.7)


def body(direction, frame):
    run = 4 <= frame < 12
    beat = math.sin((frame-4)*math.tau/8) if run else 0
    idle = [0, -.3, -.7, -.3][frame % 4] if frame < 4 else 0
    fall = max(0, frame-20)/3
    bob = idle-abs(beat)*1.3+fall*3
    def shape(commands):
        return [tuple(v for i in range(0, len(cmd), 2)
                      for v in (cmd[i], 62+(cmd[i+1]-62)*(1-fall*.18)+bob)) for cmd in commands]
    feet = Canvas()
    for i, x in enumerate([40, 59] if direction in ['left', 'right'] else [37, 58]):
        step = beat*4*(1 if i == 0 else -1)
        fx = x+(step if direction in ['left', 'right'] else 0)
        fy = 83+(step*.5 if direction in ['up', 'down'] else -abs(step)*.45)
        foot(feet, fx, fy, ankle=12 if i == 1 and direction in ['left', 'right'] else 7)
    c = Canvas()
    if direction in ['left', 'right']:
        # Photo traced, mirrored: gently arched back, full breast, long belly,
        # and TWO tapering tail feathers. The small tail gap is above the rump.
        outline = shape([(60, 48), (57, 45, 53, 42, 48, 43),
            (42, 43, 39, 46, 33, 46), (24, 46, 18, 48, 9, 49),
            (12, 51, 16, 52, 21, 52), (17, 54, 13, 53, 10, 54),
            (15, 59, 16, 65, 21, 70), (27, 77, 36, 78, 45, 77),
            (47, 79, 51, 80, 53, 74), (64, 71, 73, 65, 76, 57),
            (79, 50, 76, 46, 71, 45), (67, 45, 63, 47, 60, 48)])
        c.gradient(outline, LIGHT, '#dfe6dc', width=1)
        alpha = c.im.getchannel('A')
        # Broad light/shadow masses follow the photo's underbelly, not an oval.
        c.path(shape([(15, 59), (25, 71, 39, 73, 54, 70),
                      (64, 67, 71, 60, 76, 54), (73, 67, 61, 75, 49, 77),
                      (33, 81, 21, 75, 15, 59)]), fill='#cdd7d1')
        c.path(shape([(25, 69), (35, 74, 44, 75, 51, 73),
                      (54, 73, 55, 72, 57, 71), (53, 78, 35, 78, 25, 69)]), fill='#edf1e6')
        c.path(shape([(60, 48), (56, 44, 51, 43, 46, 45)]), outline=LIGHT, width=2.6)
        # Long folded wing: flight feathers run back along the body.
        lift = (1.8 if 12 <= frame < 16 else 0)+abs(beat)*.8
        wing = shape([(58, 48-lift), (50, 45-lift, 43, 47, 35, 49),
                      (28, 50, 22, 51, 16, 52), (22, 56, 28, 60, 35, 63),
                      (44, 65, 55, 62, 63, 56), (65, 53, 63, 50, 58, 48-lift)])
        c.gradient(wing, LIGHT, '#e8ecdf', WING_LINE, .9)
        # Overlapping pointed feathers, large enough to survive the 48px grid.
        for a, b, end in [(55, 51, 21), (57, 55, 26), (54, 59, 33)]:
            c.path(shape([(a, b), (a-7, b+1, end+8, b+3, end, b+1),
                          (end+9, b+5, a-4, b+6, a+3, b-1)]), fill='#f8f9ef', outline='#cdd7d1', width=.7)
        c.path(shape([(58, 49), (51, 46, 43, 47, 38, 50)]), outline=LIGHT, width=2)
        c.path(shape([(24, 53), (18, 53, 15, 52, 12, 51)]), outline='#edf1e6', width=1.1)
        c.path(shape([(25, 59), (19, 58, 17, 57, 14, 55)]), outline='#f8f9ef', width=1.2)
        # A few large contour feathers on the breast and lower flank.
        for x, y in [(65, 61), (58, 67), (42, 71)]:
            c.path(shape([(x+4, y-2), (x+3, y, x+1, y+1, x-2, y+1)]), outline='#d4d9c9', width=.8)
        c.clip(alpha)
    else:
        # Rear and front torso views, narrow folded wings and a pointed tail.
        if direction == 'up':
            contour = [(47, 37), (61, 37, 70, 47, 71, 59),
                       (73, 70, 64, 78, 54, 81), (50, 84), (48, 86),
                       (44, 82), (32, 80, 23, 72, 24, 59), (25, 47, 33, 37, 47, 37)]
        else:
            contour = [(46, 37), (50, 39), (53, 37), (56, 42),
                       (66, 44, 72, 54, 71, 64), (70, 77, 61, 83, 48, 83),
                       (35, 83, 25, 76, 24, 64), (23, 52, 31, 43, 41, 41), (46, 37)]
        c.gradient(shape(contour), LIGHT, '#dfe6dc', width=1)
        alpha = c.im.getchannel('A')
        c.path(shape([(28, 64), (31, 76, 42, 81, 55, 79),
                      (63, 78, 68, 72, 70, 65), (68, 81, 43, 90, 28, 64)]), fill='#cdd7d1')
        for x, sign in [(31, 1), (64, -1)]:
            c.gradient(shape([(x, 47), (x-sign*8, 54, x-sign*7, 67, x-sign*2, 74),
                              (x+sign*6, 68), (x+sign*6, 57, x+sign*5, 51, x, 47)]),
                       WHITE, '#dfe6dc', WING_LINE, .9)
            for y in [57, 63, 69]:
                c.path(shape([(x-sign*3, y-1), (x-sign*4, y+3, x+sign, y+5, x+sign*4, y+5)]), outline='#b5c3bd', width=.7)
        if direction == 'up':
            c.path(shape([(47, 44), (43, 53, 44, 64, 48, 74)]), outline='#edf1e6', width=2)
            c.path(shape([(38, 72), (43, 75, 45, 80, 48, 85), (51, 80, 55, 76, 58, 73)]), outline='#b5c3bd', width=1)
            c.path(shape([(48, 77), (48, 83)]), outline=WHITE, width=2)
        else:
            c.path(shape([(37, 66), (38, 77, 58, 79, 61, 66), (57, 79, 42, 82, 37, 66)]), fill=WHITE)
            c.path(shape([(42, 42), (46, 48, 49, 51, 53, 44)]), outline='#cdd7d1', width=1)
        c.clip(alpha)
    feet.im.alpha_composite(c.im)
    im = feet.finish()
    if direction == 'left':
        im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return im


def neck(frame):
    c = Canvas()
    motion = abs(math.sin((frame-4)*math.tau/8))*.4 if 4 <= frame < 12 else 0
    puff = [0, 1.5, 1, 0][frame-12] if 12 <= frame < 16 else 0
    h = HEAD_JOIN
    # Neck, small head and tapered bill share y=48. The shaft length changes,
    # while the head retains its size; there is no upright-to-sideways elbow.
    white = [(12, 40), (24, 41, 36, 43-puff-motion, h-3, 43-puff-motion),
             (h+1, 40, h+5, 39, h+11, 40),
             (h+19, 41, h+22, 45, h+20, 49),
             (h+20, 54, h+14, 57, h+7, 56),
             (h+2, 56, h-1, 53+puff+motion, h-3, 53+puff+motion),
             (36, 53+puff+motion, 24, 55, 12, 56),
             (10, 51, 10, 45, 12, 40)]
    c.gradient(white, LIGHT, '#edf1e6', width=1)
    alpha = c.im.getchannel('A')
    c.path([(12, 52), (26, 53, 40, 51, h+2, 52),
            (h+9, 55, h+16, 54, h+19, 51),
            (h+15, 58, h+5, 57, h, 54), (30, 56), (12, 56)], fill=SHADE)
    c.path([(16, 43), (29, 44, 42, 44, h, 44)], outline=LIGHT, width=2)
    c.path([(h+2, 43), (h+7, 40, h+13, 41, h+17, 43)], outline=LIGHT, width=1.8)
    c.path([(h+7, 52), (h+12, 54, h+16, 53, h+18, 51)], outline='#dfe6dc', width=.8)
    c.clip(alpha)
    # Forehead knob and bill are orange masses, not a duck's flat oval beak.
    c.gradient([(h+18, 42), (h+18, 39, h+21, 38, h+23, 40),
                (h+24, 42, h+23, 44, h+22, 46),
                (h+19, 46, h+18, 44, h+18, 42)],
               '#ffcd72', ORANGE, DARK_ORANGE, .8)
    c.gradient([(h+21, 43), (h+23, 46, 83, 46, 90, 48),
                (86, 51, 80, 53, h+20, 52),
                (h+18, 50, h+20, 46, h+21, 43)],
               '#f5b44e', ORANGE, DARK_ORANGE, .9)
    c.path([(h+21, 50), (80, 50, 85, 49, 89, 48.5)], outline=DARK_ORANGE, width=.8)
    c.path([(h+22, 45), (80, 47, 83, 47, 86, 48)], outline='#ffcd72', width=.8)
    c.ellipse((h+24, 46, h+26, 47.5), '#a45b2b')
    # A small brown-black eye. No chibi shine, tuft, or pink cheek patch.
    if frame == 3 or frame >= 16:
        c.path([(h+13, 45.5), (h+16, 45.5)], outline='#28322f', width=1.2)
    else:
        c.ellipse((h+13, 43, h+16, 46), '#705332')
        c.ellipse((h+14, 43.5, h+16, 45.5), '#28322f')
    if frame >= 20:
        # The gun is hidden on death, so the neck can fold down naturally
        # around its attached root for the collapse animation.
        angle = (frame-20)*.16
        co, si = math.cos(angle), math.sin(angle)
        x, y = PIVOT[0]*SS, PIVOT[1]*SS
        c.im = c.im.transform(c.im.size, Image.Transform.AFFINE,
            (co, si, x-co*x-si*y, -si, co, y+si*x-co*y), Image.Resampling.NEAREST)
    return c.finish()


def atlas(frames):
    im = Image.new('RGBA', (384, 576))
    for i, frame in enumerate(frames):
        im.alpha_composite(frame, ((i % 4)*96, (i // 4)*96))
    return im


def gun(weapon):
    # Established six weapon shapes and their exact grip/barrel anchors.
    im = Image.new('RGBA', (24, 16))
    d = ImageDraw.Draw(im)
    colors = {'pencil': '#9aaeb7', 'pulse': '#55bfd5', 'venom': '#9cbe65',
              'flare': '#f3bd51', 'rail': '#ac91db', 'smg': '#dc8b55'}
    ink = '#354454'
    d.polygon([(4, 6), (9, 6), (10, 11), (7, 13), (5, 12)], fill='#645d5b', outline=ink)
    d.rectangle((4, 5, 17, 9), fill=colors[weapon], outline=ink)
    d.rectangle((16, 7, 22, 9), fill='#465966', outline=ink)
    d.line([(6, 6), (16, 6)], fill='#e4eee4')
    d.rectangle((11, 7, 14, 8), fill='#5a6873')
    if weapon == 'pencil':
        d.rectangle((15, 5, 21, 7), fill='#788b95', outline=ink)
    elif weapon == 'rail':
        d.rectangle((11, 3, 17, 5), fill='#8066ac', outline=ink)
        d.point((15, 4), fill='#e2d3ff')
    elif weapon == 'venom':
        d.rectangle((10, 2, 14, 5), fill='#b3db83', outline=ink)
    elif weapon == 'pulse':
        d.rectangle((9, 3, 13, 5), fill='#a2eff1', outline=ink)
    elif weapon == 'flare':
        d.rectangle((12, 9, 15, 12), fill='#b88946', outline=ink)
    else:
        d.rectangle((11, 9, 13, 13), fill='#c28357', outline=ink)
    return im.resize((48, 32), Image.Resampling.NEAREST)


def portrait():
    # Use the same small head, straight neck and feathered torso as gameplay.
    # A left/up stretch fits the existing square card without an L-shaped bend.
    bird = assembled('left', 0, -math.pi*3/4)
    bird = bird.crop(bird.getchannel('A').getbbox())
    factor = 58/max(bird.size)
    size = (round(bird.width*factor), round(bird.height*factor))
    small = Image.new('RGBA', (64, 64))
    small.alpha_composite(bird.resize(size, Image.Resampling.NEAREST),
                          ((64-size[0])//2, (64-size[1])//2+2))
    return small.resize((128, 128), Image.Resampling.NEAREST)


SOCKETS = {'right': (60, 60), 'left': (34, 60), 'up': (48, 58), 'down': (48, 62)}


def assembled(direction, frame, angle=0, armed=False):
    im = Image.new('RGBA', (256, 256))
    bx, by = 80, 52
    sx, sy = (bx+SOCKETS[direction][0], by+SOCKETS[direction][1])
    co, si = math.cos(angle), math.sin(angle)
    transformed = neck(frame).transform(im.size, Image.Transform.AFFINE,
        (co, si, PIVOT[0]-co*sx-si*sy, -si, co, PIVOT[1]+si*sx-co*sy), Image.Resampling.NEAREST)
    if math.sin(angle) < -.25:
        im.alpha_composite(transformed)
    im.alpha_composite(body(direction, frame), (bx, by))
    if math.sin(angle) >= -.25:
        im.alpha_composite(transformed)
    if armed:
        mx = sx+co*(MOUTH[0]-PIVOT[0])-si*(MOUTH[1]-PIVOT[1])
        my = sy+si*(MOUTH[0]-PIVOT[0])+co*(MOUTH[1]-PIVOT[1])
        weapon = gun('pencil').transform(im.size, Image.Transform.AFFINE,
            (co, si, 12-co*mx-si*my, -si, co, 16+si*mx-co*my), Image.Resampling.NEAREST)
        im.alpha_composite(weapon)
    return im


def font(size):
    return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for direction in ['up', 'down', 'left', 'right']:
        atlas([body(direction, i) for i in range(24)]).save(DEST/f'player_goose_body_{direction}.png', optimize=True)
    atlas([neck(i) for i in range(24)]).save(DEST/'player_goose_neck.png', optimize=True)
    for weapon in ['pencil', 'pulse', 'venom', 'flare', 'rail', 'smg']:
        gun(weapon).save(DEST/f'player_goose_gun_{weapon}.png', optimize=True)
    portrait().save(DEST/'player_goose_portrait.png', optimize=True)
    portrait().resize((512, 512), Image.Resampling.NEAREST).save(OUT/'goose-portrait.png')

    review = Image.new('RGB', (1200, 860), '#253738')
    d = ImageDraw.Draw(review)
    d.text((36, 24), '大鹅  /  照片参考 · 像素资源', font=font(26), fill='#fff1cc')
    d.text((36, 65), '直颈加长 35% / 头颈同轴 / 橙色额瘤与长喙 / 叠层尖尾', font=font(16), fill='#c3d3cd')
    pic = portrait().resize((384, 384), Image.Resampling.NEAREST)
    review.paste(pic, (16, 190), pic)
    d.text((54, 590), '角色卡立绘 · 透明底', font=font(19), fill='#f5b44e')
    d.text((54, 628), '四向躯干 + 一套头颈', font=font(17), fill='#c3d3cd')
    d.text((54, 660), '头颈 / 嘴部枪械独立旋转', font=font(17), fill='#c3d3cd')
    for i, (direction, label) in enumerate([('up', '背面'), ('right', '右侧'), ('down', '正面'), ('left', '左侧')]):
        x, y = 418+(i % 2)*378, 106+(i // 2)*342
        d.text((x+30, y+10), label, font=font(19), fill='#f5b44e')
        # Right is the neutral forward stretch; a left-facing body can aim
        # independently without inventing another head atlas.
        sprite = assembled(direction, 0).resize((384, 384), Image.Resampling.NEAREST)
        review.paste(sprite, (x, y+10), sprite)
    review.save(OUT/'goose-preview.png')

    layers = Image.new('RGB', (1136, 734), '#253738')
    d = ImageDraw.Draw(layers)
    d.text((28, 18), '分层动作表  /  四向躯干 + 共用头颈', font=font(23), fill='#fff1cc')
    for col, label in enumerate(['待机', '行走', '射击', '受击', '倒地']):
        d.text((225+col*174, 63), label, font=font(17), fill='#c3d3cd')
    for row, (direction, label) in enumerate([('up', '背面躯干'), ('down', '正面躯干'), ('left', '左侧躯干'), ('right', '右侧躯干')]):
        d.text((28, 130+row*110), label, font=font(18), fill='#f5b44e')
        for col, frame in enumerate([0, 6, 12, 17, 23]):
            sprite = body(direction, frame)
            layers.paste(sprite, (206+col*174, 92+row*110), sprite)
    d.text((28, 592), '共用头颈', font=font(18), fill='#f5b44e')
    for col, frame in enumerate([0, 6, 12, 17, 23]):
        sprite = neck(frame)
        layers.paste(sprite, (206+col*174, 535), sprite)
    d.text((28, 684), '每层 24 帧 · 96×96 / 透明底 / 18 色 / 2×像素网格 / 枪械独立', font=font(17), fill='#c3d3cd')
    layers.save(OUT/'goose-layers.png')

    motion = []
    for frame in range(4, 12):
        page = Image.new('RGB', (1024, 256), '#253738')
        d = ImageDraw.Draw(page)
        for i, direction in enumerate(['up', 'down', 'left', 'right']):
            sprite = assembled(direction, frame)
            page.paste(sprite, (i*256, 0), sprite)
        motion.append(page.resize((1536, 384), Image.Resampling.NEAREST))
    motion[0].save(OUT/'goose-waddle.gif', save_all=True, append_images=motion[1:], duration=100, loop=0)
    turn = []
    for step in range(32):
        page = Image.new('RGB', (512, 512), '#253738')
        sprite = assembled('right', 0, step*math.tau/32, armed=True).resize(page.size, Image.Resampling.NEAREST)
        page.paste(sprite, (0, 0), sprite)
        turn.append(page)
    turn[0].save(OUT/'goose-turn.gif', save_all=True, append_images=turn[1:], duration=75, loop=0)
    print('Photo goose: 4 torso atlases + 1 shared straight neck (+35%), 6 guns, 128px portrait.')


if __name__ == '__main__':
    main()
