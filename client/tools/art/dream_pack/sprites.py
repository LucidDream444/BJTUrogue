"""Anatomical pixel drawings and pose sequences, with fixed ground anchors."""
from __future__ import annotations
import math
from PIL import Image, ImageDraw, ImageOps
from .drawing import canvas, polygon, ellipse, line, cubic, arc, resize, fade, INK, GOLD
from .bosses import first_boss, frost_boss, final_boss

ANIMAL_STATES = [('idle', 4), ('walk', 6), ('windup', 6), ('dash', 4),
                 ('recover', 4), ('hit', 2), ('death', 6)]
CAT_STATES = [('idle', 4), ('walk', 6), ('windup', 6), ('spin', 8),
              ('recover', 4), ('hit', 2), ('purify', 6), ('vanish', 6)]
BERRY_STATES = [('idle', 4), ('run', 8), ('shoot', 4), ('hurt', 4), ('death', 6)]


def berry(state='idle', index=0, count=4, size=64):
    im, d = canvas((64, 64))
    t = index / max(1, count-1)
    squish = math.sin(t*math.tau)*1.5 if state == 'run' else 0
    if state == 'shoot': squish = -math.sin(t*math.pi)*1.3
    if state == 'hurt': squish = math.sin(t*math.tau)*2
    # All poses retain the same foot (32,56); actual hop is a code transform.
    outline = [(32, 15-squish), (42, 17-squish), (49, 23), (51, 34+squish),
               (48, 46), (42, 53), (32, 56), (22, 53), (15, 46),
               (13, 34+squish), (15, 23), (22, 17-squish)]
    polygon(d, outline, '#923c43')
    ellipse(d, (16, 17-squish, 47, 51), '#c84d4c', None)
    ellipse(d, (18, 18-squish, 43, 45), '#df6653', None)
    ellipse(d, (20, 19-squish, 36, 33), '#ed8b69', None)
    polygon(d, [(17, 38), (20, 47), (27, 52), (39, 52), (46, 46),
                (48, 35), (44, 43), (39, 47), (28, 47)], '#b04345', None)
    line(d, [(24, 20), (29, 18), (34, 18)], '#f3ba86', 2)
    d.point((20, 25), '#f7c59b'); d.point((42, 41), '#eb8a64')
    # The small green-brown calyx sits in the fruit, not an extra face/fruit.
    polygon(d, [(27, 16), (29, 13), (32, 15), (36, 12), (36, 16), (40, 17),
                (34, 18), (31, 17)], '#6d7152')
    line(d, [(33, 15), (34, 10), (37, 8)], '#746249', 2)
    closed = state == 'idle' and index == 3
    for x in [25, 38]:
        if closed:
            line(d, [(x-2, 33), (x, 34), (x+2, 33)], '#362e34')
        else:
            # Plain dark pixel eyes: no sclera, iris, or shiny human-eye detail.
            ellipse(d, (x-1, 30, x+1, 34), '#392e34', None)
    if state == 'hurt':
        line(d, [(19, 25), (25, 27)], '#762f3d')
        line(d, [(37, 27), (43, 25)], '#762f3d')
    # No hands, legs, mouth, or weapon pixels are baked into the body.
    if state == 'death':
        # A soft seed-light retreat, not a smashed fruit.
        for k in range(7):
            a = k*math.tau/7+t*1.2
            px, py = 32+math.cos(a)*(16+12*t), 35+math.sin(a)*(14+10*t)
            d.rectangle((round(px), round(py), round(px)+1, round(py)+1), fill=GOLD)
        im = fade(im, max(0, 1-t))
    return resize(im, (size, size))


def muscovy(state='idle', index=0, count=4, direction='right', size=96):
    im, d = canvas()
    t = index/max(1, count-1)
    stride = math.sin(index*math.tau/max(1, count)) if state == 'walk' else 0
    bob = round(stride) if state == 'walk' else round(math.sin(t*math.tau)) if state == 'idle' else 0
    attack = state in ['windup', 'dash']
    # Photographed black-and-white Muscovy: white head/chest, black back, red face.
    white, shade = '#f0eee2', '#c4d0c7'
    black, feather = '#202c34', '#354b50'
    pink, red = '#cba39c', '#ce514f'
    # Both feet share y41 in every direction; no weapon or FX is baked in.
    for x, delta in [(18, stride), (28, -stride)]:
        line(d, [(x, 34), (x+delta*2, 39)], '#a88b83', 2)
        polygon(d, [(x+delta*2-3, 40), (x+delta*2, 38),
                    (x+delta*2+4, 41), (x+delta*2-2, 41)], pink)
        line(d, [(x+delta*2, 39), (x+delta*2, 41)], '#8d7978')
    if attack:
        # Far wing sits behind the body. A staggered pair reads as a side pounce.
        spread = (.15+.85*t) if state == 'windup' else [1, .65, .22, .65][index % 4]
        tip = 19-round(15*spread)
        polygon(d, [(23,25),(24,16),(30,tip),(32,tip+2),(29,16),
                    (34,tip+5),(32,20),(29,26)], black)
        polygon(d, [(25,18),(29,tip+4),(29,tip+8),(27,21)], white, None)
        line(d, [(29,tip+2),(27,19),(27,23)], feather)
    # Long low black back and broad pale breast reproduce the supplied duck.
    polygon(d, [(14,21+bob),(6,20+bob),(3,24+bob),(12,29+bob),
                (16,35),(29,38),(37,32+bob),(34,23+bob),(25,19+bob)], black)
    ellipse(d, (11,21+bob,37,38), white)
    polygon(d, [(12,22+bob),(17,19+bob),(28,20+bob),(31,27+bob),
                (26,33),(16,34),(10,29+bob)], black)
    line(d, [(11,23+bob),(17,21+bob),(24,21+bob)], feather)
    polygon(d, [(15,33),(20,36),(29,36),(34,31),(33,34),(29,38),(20,37)], shade, None)
    if attack:
        # Head extends forward and low while the near wing opens above the back.
        lean = round(2*t) if state == 'windup' else 2
        hy = round(8*t) if state == 'windup' else 8
        polygon(d, [(27,31),(27,22),(31+lean,13+hy),(36+lean,13+hy),
                    (39+lean,19+hy),(35,30),(32,34)], white)
        line(d, [(29,29),(30,24),(33+lean,18+hy)], shade)
        hx = 29+lean
        ellipse(d, (hx,7+hy,hx+11,18+hy), white)
        # Near wing has separated primary tips and a broad white flight-feather bar.
        tip = 21-round(16*spread)
        polygon(d, [(24,28),(18,23),(10,tip+7),(5,tip),(4,tip+5),
                    (8,tip+11),(3,tip+8),(4,tip+13),(11,tip+17),
                    (6,tip+15),(8,tip+20),(16,29),(21,32)], black)
        polygon(d, [(12,tip+11),(16,tip+14),(21,25),(23,29),(18,27),
                    (11,tip+16)], white, None)
        for dx, dy in [(5,5),(5,10),(8,15)]:
            line(d, [(dx,tip+dy),(14,tip+17)], feather)
        line(d, [(15,tip+15),(19,25),(22,28)], shade)
    else:
        hx, hy = 28, 0
        # Compact neck is mainly white, unlike a mallard's dark neck/head.
        polygon(d, [(26,31+bob),(27,22+bob),(29,16+bob),(35,14+bob),
                    (39,21+bob),(36,30+bob),(31,34+bob)], white)
        polygon(d, [(28,29+bob),(29,25+bob),(30,22+bob),(30,29+bob)], shade, None)
        ellipse(d, (hx,10+bob,hx+12,22+bob), white)
        # Folded black wing, white patch, and a few restrained blue-green feathers.
        polygon(d, [(12,24+bob),(18,21+bob),(28,23+bob),(29,28+bob),
                    (23,33),(14,31)], '#25353c')
        polygon(d, [(21,24+bob),(27,24+bob),(28,27+bob),(24,29),
                    (19,28)], white, None)
        for x,y in [(14,25),(17,24),(14,28),(18,30)]:
            line(d, [(x,y+bob),(x+2,y+1+bob),(x+4,y+bob)], feather)
        hy = bob+4
    # White crown with a few black flecks, simplified red caruncles, flat pink bill.
    polygon(d, [(hx+1,10+hy),(hx+4,9+hy),(hx+9,10+hy),(hx+12,13+hy),
                (hx+10,18+hy),(hx+4,18+hy),(hx+2,15+hy)], red)
    for x,y in [(3,11),(4,16),(10,14)]:
        d.point((hx+x,y+hy), '#ed8370')
    for x,y in [(3,8),(5,7),(7,8)]:
        d.point((hx+x,y+hy), black)
    d.rectangle((hx+7,11+hy,hx+8,12+hy), fill='#252934')
    polygon(d, [(hx+10,14+hy),(min(46,hx+17),16+hy),
                (min(46,hx+16),18+hy),(hx+10,17+hy)], '#d6b5ac')
    line(d, [(hx+11,17+hy),(min(45,hx+16),17+hy)], '#9b8887')
    d.point((min(46,hx+17),17+hy), black)
    if not attack and direction in ['down', 'up']:
        # Resting locomotion retains four directions and the same photographed colors.
        im, d = canvas()
        for x in [19,28]:
            line(d, [(x,34),(x,39)], '#a88b83',2)
            polygon(d, [(x-3,41),(x,38),(x+3,41)], pink)
        ellipse(d, (10,19+bob,37,38), black if direction=='up' else white)
        for sign in [-1,1]:
            polygon(d, [(24+sign*9,21+bob),(24+sign*13,25+bob),
                        (24+sign*12,33),(24+sign*8,34),(24+sign*7,27)], black)
            polygon(d, [(24+sign*10,25+bob),(24+sign*12,26+bob),
                        (24+sign*11,30),(24+sign*8,30)], white, None)
        polygon(d, [(17,25+bob),(18,13+bob),(23,10+bob),(29,13+bob),
                    (30,25+bob),(28,31),(20,31)], white)
        ellipse(d, (17,6+bob,30,19+bob), white)
        for x,y in [(20,8),(23,7),(27,9)]: d.point((x,y+bob), black)
        if direction=='down':
            polygon(d, [(18,11+bob),(21,10+bob),(24,12+bob),(27,10+bob),
                        (30,12+bob),(28,17+bob),(20,17+bob)], red)
            for x in [20,27]: d.point((x,12+bob), '#252934')
            polygon(d, [(21,15+bob),(26,15+bob),(28,18+bob),(25,20+bob),
                        (21,19+bob)], '#d6b5ac')
            line(d, [(22,18+bob),(26,18+bob)], '#9b8887')
        else:
            polygon(d, [(18,11+bob),(21,14+bob),(23,18+bob),(27,16+bob),
                        (29,11+bob),(28,21+bob),(21,23+bob)], shade, None)
            line(d, [(16,25+bob),(22,28+bob),(30,26+bob)], feather)
    # Every windup/dash atlas row uses the same unmistakable side-on pounce.
    # Up/down rows choose opposite side silhouettes; lockedDirX/Y still drives motion.
    if direction == 'left' or (attack and direction == 'up'):
        im = ImageOps.mirror(im)
    if state=='hit':
        # Local warm rim, not a fully baked white silhouette.
        d=ImageDraw.Draw(im); line(d,[(10,25),(9,30),(13,34)],'#e7c2a0' if index==0 else '#bc9c86')
    if state=='death':
        im=fade(im,max(0,1-t))
    return resize(im,(size,size))


def cat(state='idle', index=0, count=4, size=96):
    im,d=canvas()
    t=index/max(1,count-1)
    normal=state=='vanish' or (state=='purify' and index>=3)
    base='#c3aa8a' if normal else '#444253'
    light='#e9d4aa' if normal else '#626177'
    dark='#806d63' if normal else '#2c3042'
    bob=round(math.sin(index*math.tau/max(count,1))) if state in ['walk','recover'] else 0
    curl=math.sin(index*math.tau/max(count,1))*3
    # Long articulated tail, haunches and forepaws make a cat rather than a black blob.
    line(d,cubic([(31,34),(46,36),(44,14),(35+curl,19)]),INK,5)
    line(d,cubic([(31,34),(46,36),(44,14),(35+curl,19)]),base,3)
    ellipse(d,(12,23+bob,35,38),base)
    ellipse(d,(12,26,22,39),light)
    polygon(d,[(12,34),(12,40),(17,41),(20,39),(20,32)],base)
    polygon(d,[(25,33),(26,40),(32,41),(34,39),(33,31)],base)
    line(d,[(14,39),(17,39)],light);line(d,[(28,39),(32,39)],light)
    polygon(d,[(12,19+bob),(12,8+bob),(20,13+bob),(29,12+bob),
               (35,7+bob),(35,21+bob),(32,28+bob),(24,31+bob),(16,28+bob)],base)
    polygon(d,[(14,12+bob),(18,15+bob),(14,18+bob)],'#ad7781')
    polygon(d,[(33,11+bob),(33,17+bob),(29,15+bob)],'#ad7781')
    polygon(d,[(17,17+bob),(24,15+bob),(31,17+bob),(33,23+bob),
               (29,27+bob),(19,27+bob),(15,22+bob)],light,None)
    for x in [19,29]:
        ellipse(d,(x-3,19+bob,x+2,22+bob),'#d8d3a4' if normal else '#d3b0eb')
        line(d,[(x,19+bob),(x,22+bob)],'#242b3b')
        d.point((x-1,19+bob),'#fff1c9')
    polygon(d,[(22,24+bob),(26,24+bob),(24,26+bob)],'#9e6476')
    line(d,[(24,26+bob),(24,28+bob),(21,29+bob)],dark)
    line(d,[(24,28+bob),(27,29+bob)],dark)
    for y in [23,26]:
        line(d,[(16,y+bob),(8,y-1+bob)],'#a9a4ab')
        line(d,[(32,y+bob),(40,y-1+bob)],'#a9a4ab')
    for x in [19,24,29]: line(d,[(x-1,16+bob),(x,18+bob)],dark)
    if not normal:
        # Purple fractured fur and spectral wisps remain secondary to visible anatomy.
        for x,y in [(10,29),(34,31),(37,24)]:
            polygon(d,[(x,y),(x-3,y-5),(x+1,y-3),(x+2,y-9),(x+3,y)],'#797294',None)
    if state=='windup':
        for k in range(4):
            a=k*math.tau/4+t
            d.point((round(24+math.cos(a)*(20-4*t)),round(24+math.sin(a)*(14-3*t))), '#e4c4f1')
    if state=='spin':
        # Preserve readable ears/tail through each pose; motion arcs are independent too.
        rotated=im.rotate(-index*45,Image.Resampling.NEAREST,center=(24,26))
        im=rotated
    if state=='hit':
        d=ImageDraw.Draw(im)
        line(d,[(14,19),(12,24),(14,29)],'#be9ca9' if index==0 else '#8d8096')
        line(d,[(17,19),(21,20)],'#e6d3d4')
    if state=='purify':
        d=ImageDraw.Draw(im)
        for k in range(8):
            a=k*math.tau/8+t
            d.point((round(24+math.cos(a)*(18+6*t)),round(24+math.sin(a)*(15+8*t))),GOLD)
    if state=='vanish':
        im=fade(im,1-t)
        scaled=resize(im,(max(1,round(48*(1-t*.7))),max(1,round(48*(1-t*.7)))))
        im=Image.new('RGBA',(48,48));im.alpha_composite(scaled,((48-scaled.width)//2,41-scaled.height))
    return resize(im,(size,size))


def vortex(index, void=False, size=96):
    im,d=canvas();t=index/8
    if void:
        ellipse(d,(9,29,39,44),(31,32,57,190),'#a99bc9')
        ellipse(d,(13,32,35,41),(11,20,36,235),'#716b97')
        arc(d,(24,36),(18,7),t*math.tau,t*math.tau+4,'#c5badb',2)
        for k in range(6):
            a=k*math.tau/6+t*2
            d.point((round(24+math.cos(a)*17),round(32+math.sin(a)*11)),'#e8d9c0')
    else:
        for row in range(4):
            r=19-row*3;y=35-row*7
            for side in range(2):
                a=t*math.tau+row*.8+side*math.pi
                arc(d,(24,y),(r,5),a,a+2.4,(193,193,219,185),2)
                arc(d,(24,y-1),(r-1,4),a+.2,a+1.9,(117,107,155,185))
        for k in range(4):
            a=k*1.7+t*math.tau
            polygon(d,[(24+math.cos(a)*18,25+math.sin(a)*12),
                       (26+math.cos(a)*18,24+math.sin(a)*12),
                       (25+math.cos(a)*18,27+math.sin(a)*12)],'#e0c38a',None)
    return resize(im,(size,size))



def all_frames(states, draw, **kwargs):
    return [draw(state,i,count,**kwargs) for state,count in states for i in range(count)]
