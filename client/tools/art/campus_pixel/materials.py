"""Sixteen hand-designed repeatable campus material tiles, native 64 px."""
from __future__ import annotations

import random
from PIL import Image, ImageDraw
from .drawing import P, tint

N = 64


def ceramic(corridor=False, worn=False):
    base = '#B6B3A8' if corridor else P['tile']
    im = Image.new('RGBA', (N, N), base)
    d = ImageDraw.Draw(im)
    # Quiet glaze clusters, without embedding lamps or a window reflection.
    d.rectangle((2, 2, 60, 4), fill=tint(base, 3))
    d.rectangle((3, 5, 5, 58), fill=tint(base, 2))
    d.rectangle((49, 31, 58, 54), fill=tint(base, -2))
    d.rectangle((39, 50, 48, 59), fill=tint(base, -2))
    if worn:
        rng = random.Random(17 + int(corridor))
        for _ in range(16):
            x, y = rng.randrange(6, 57), rng.randrange(6, 57)
            d.line((x, y, min(60, x+rng.randrange(2, 5)), y), fill=tint(base, -7))
    d.line((0, 63, 63, 63), fill=tint(base, -26))
    d.line((63, 0, 63, 63), fill=tint(base, -26))
    d.line((0, 0, 62, 0), fill=tint(base, 7))
    d.line((0, 0, 0, 62), fill=tint(base, 5))
    return im


def concrete(scuffed=False):
    im = Image.new('RGBA', (N, N), P['concrete'])
    d = ImageDraw.Draw(im)
    rng = random.Random(462 if scuffed else 461)
    # Wrap every cluster over the tile boundaries for continuous mottling.
    for _ in range(90):
        x, y = rng.randrange(N), rng.randrange(N)
        w, h = rng.randrange(2, 8), rng.randrange(1, 5)
        color = tint(P['concrete'], rng.choice((-7, -4, 3, 5)))
        for dy in range(h):
            for dx in range(w):
                if dx < w-1 or dy > 0:
                    d.point(((x+dx) % N, (y+dy) % N), fill=color)
    if scuffed:
        for x, y, w in ((8, 18, 18), (41, 40, 20), (25, 55, 12)):
            for dx in range(w):
                for dy in range(3 + (dx % 4 == 0)):
                    if rng.random() > .20:
                        d.point(((x+dx) % N, (y+dy) % N), fill=tint(P['concrete'], 12))
    for _ in range(200):
        d.point((rng.randrange(N), rng.randrange(N)), fill=tint(P['concrete'], rng.choice((-10, -5, 5, 8))))
    return im


def stone(variant=False):
    im = Image.new('RGBA', (N, N), P['stone'])
    d = ImageDraw.Draw(im)
    rng = random.Random(31+int(variant))
    for _ in range(1400):
        x,y=rng.randrange(N),rng.randrange(N)
        d.point((x,y), fill=tint(P['stone'],rng.choice((-9,-5,-3,3,5,9,12))))
    d.line((0,63,63,63),fill=tint(P['stone'],-14))
    d.line((63,0,63,63),fill=tint(P['stone'],-14))
    d.line((0,0,62,0),fill=tint(P['stone'],4))
    return im


def plaster(cool=False):
    base = '#D2D3CB' if cool else P['wall']
    im=Image.new('RGBA',(N,N),base)
    d=ImageDraw.Draw(im)
    rng=random.Random(77+int(cool))
    for _ in range(85):
        d.point((rng.randrange(N),rng.randrange(N)),fill=tint(base,rng.choice((-4,2,3))))
    return im


def brick(weathered=False):
    im=Image.new('RGBA',(N,N),P['mortar'])
    d=ImageDraw.Draw(im)
    rng=random.Random(219)
    for row in range(8):
        offset=8 if row%2 else 0
        for col in range(4):
            x=(col*16+offset)%N
            color=tint(P['brick'],rng.choice((-9,-5,0,3,7)))
            for shift in (-64,0,64):
                d.rectangle((x+shift,row*8,x+shift+14,row*8+6),fill=color)
                d.line((x+shift,row*8,x+shift+14,row*8),fill=tint(color,8))
                d.line((x+shift,row*8+6,x+shift+14,row*8+6),fill=tint(color,-13))
                d.line((x+shift+1,row*8+3,x+shift+5,row*8+3),fill=tint(color,3))
    if weathered:
        rng=random.Random(89)
        # Local pale bloom follows the old stairwell brick, not even scratches.
        for cx,cy,rx,ry in ((12,13,10,16),(43,45,8,13)):
            for _ in range(45):
                dx,dy=rng.randrange(-rx,rx+1),rng.randrange(-ry,ry+1)
                if dx*dx/(rx*rx)+dy*dy/(ry*ry)<=1:
                    x,y=(cx+dx)%N,(cy+dy)%N
                    color=rng.choice(('#BD947C','#C5A38B','#BC8B73'))
                    d.line((x,y,min(63,x+rng.randrange(1,4)),y),fill=color)
    return im


def build_tiles():
    tiles={
        'tile_classroom_ceramic_clean':ceramic(),
        'tile_classroom_ceramic_worn':ceramic(worn=True),
        'tile_corridor_ceramic_neutral':ceramic(corridor=True),
        'tile_corridor_ceramic_worn':ceramic(corridor=True,worn=True),
        'tile_lecture_concrete_base':concrete(),
        'tile_lecture_concrete_scuffed':concrete(scuffed=True),
        'tile_lobby_stone_base':stone(),
        'tile_lobby_stone_variant':stone(variant=True),
        'tile_wall_plaster_warm':plaster(),
        'tile_wall_plaster_cool':plaster(cool=True),
        'tile_wall_brick_base':brick(),
        'tile_wall_brick_weathered':brick(weathered=True),
    }
    tread=Image.new('RGBA',(N,N),P['stair'])
    d=ImageDraw.Draw(tread)
    d.rectangle((0,0,63,3),fill=P['stair_light'])
    d.line((31,0,31,63),fill='#A9ACA4')
    for y in (53,56,59,62):
        d.line((0,y,63,y),fill='#919A95')
        if y<62:d.line((0,y+1,63,y+1),fill='#D3D7CA')
    tiles['tile_stair_tread_grooved']=tread
    riser=Image.new('RGBA',(N,N),P['stair_shadow'])
    d=ImageDraw.Draw(riser)
    d.line((0,0,63,0),fill='#747E78')
    d.line((0,63,63,63),fill='#ADB3AA')
    tiles['tile_stair_riser_plain']=riser
    skirt=plaster(cool=True)
    d=ImageDraw.Draw(skirt)
    d.rectangle((0,48,63,63),fill=P['steel'])
    d.line((0,48,63,48),fill=P['steel_light'])
    tiles['tile_wall_skirt_charcoal']=skirt
    threshold=ceramic(corridor=True)
    d=ImageDraw.Draw(threshold)
    d.rectangle((0,21,63,41),fill=P['silver'])
    d.line((0,21,63,21),fill=P['silver_light'])
    d.line((0,41,63,41),fill=P['silver_shadow'])
    for x in (10,52):
        d.rectangle((x,29,x+2,31),fill=P['silver_shadow'])
        d.point((x,29),fill=P['silver_light'])
    d.line((24,35,33,35),fill=tint(P['silver'],-9))
    tiles['tile_door_threshold_metal']=threshold
    return tiles
