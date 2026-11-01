"""Anatomical pixel drawings and pose sequences, with fixed ground anchors."""
from __future__ import annotations
import math
from PIL import Image, ImageDraw, ImageOps
from .drawing import canvas, polygon, ellipse, line, cubic, arc, resize, fade, INK, PAPER, GOLD

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
            ellipse(d, (x-3, 28, x+3, 37), '#fff1cd')
            ellipse(d, (x-1, 30, x+2, 36), '#313442', None)
            d.point((x, 30), '#ffffff')
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
    lean = 3 if state == 'dash' else round(t*2) if state == 'windup' else round((1-t)*3) if state=='recover' else 0
    bob = round(stride) if state == 'walk' else round(math.sin(t*math.tau)) if state == 'idle' else 0
    # Webbed feet retain a common ground line of y41.
    for x, delta in [(18, stride), (29, -stride)]:
        line(d, [(x, 34), (x+delta*2, 39)], '#b48c5d', 2)
        polygon(d, [(x+delta*2-3, 40), (x+delta*2, 38),
                    (x+delta*2+4, 41), (x+delta*2-2, 41)], '#d3a16a')
    polygon(d, [(10, 28+bob), (5, 28+bob), (10, 21+bob),
                (19, 18+bob), (34, 23+bob), (34, 33+bob), (21, 38)], '#303b42')
    ellipse(d, (11, 19+bob, 35, 37), '#273039')
    ellipse(d, (13, 20+bob, 29, 32+bob), '#3c4850', None)
    # Scalloped feather rows make the broad black torso recognizably feathered.
    for row in range(5):
        y = 23+row*2+bob
        for j in range(4):
            x = 14+j*4+(row%2)
            line(d, [(x, y), (x+1, y+1), (x+3, y)], '#65716f' if row<3 else '#444f54')
            d.point((x+1, y), '#4a5b59')
    # Neck/head curves forward under charge, matching the supplied photo silhouette.
    polygon(d, [(27, 26+bob), (27, 18+bob), (29+lean, 10+bob),
                (34+lean, 8+bob), (39+lean, 12+bob), (36+lean, 20+bob),
                (34, 28+bob)], '#dde0d3')
    polygon(d, [(29, 23+bob), (30, 16+bob), (32+lean, 11+bob),
                (35+lean, 11+bob), (33+lean, 18+bob), (33, 25+bob)], '#5b686a', None)
    ellipse(d, (28+lean, 6+bob, 39+lean, 17+bob), '#3d4549')
    polygon(d, [(29+lean, 11+bob), (32+lean, 9+bob), (38+lean, 10+bob),
                (40+lean, 14+bob), (36+lean, 18+bob), (31+lean, 17+bob)], '#c94b45')
    for x, y in [(30,12),(32,10),(34,16),(36,15),(38,12),(32,15)]:
        d.point((x+lean,y+bob), '#ee7f68')
    ellipse(d, (34+lean, 10+bob, 37+lean, 13+bob), '#e3c278')
    d.point((36+lean, 11+bob), '#1c2834')
    polygon(d, [(38+lean, 13+bob), (44+lean, 16+bob), (42+lean, 18+bob),
                (37+lean, 16+bob)], '#c6c9b9')
    line(d, [(40+lean,16+bob),(43+lean,17+bob)], '#545b5d')
    line(d, [(30+lean,7+bob),(33+lean,6+bob),(37+lean,8+bob)], '#eef0df')
    # Extended primary feathers are anatomy, rather than a generic attack rectangle.
    if state in ['windup', 'dash']:
        spread = (0.3+t*0.7) if state=='windup' else 1
        tip_y = 22-round(spread*15)
        polygon(d, [(21,24+bob),(11,19),(4,tip_y),(4,tip_y+8),(9,18),
                    (7,tip_y+14),(14,23),(12,27),(22,30)], '#37444b')
        for k in range(5):
            line(d, [(20-k,25),(7+k*2,tip_y+4+k*3)], '#83908a')
        polygon(d, [(25,26),(31,21),(39,21-round(spread*11)),
                    (42,13),(40,24),(34,30),(27,32)], '#354149')
        for k in range(3): line(d, [(29+k,28),(39+k,16+k*3)], '#6b7e77')
    else:
        polygon(d, [(15,24+bob),(25,22+bob),(31,25+bob),(27,33),(18,33)], '#3b4b4f')
        for k in range(4): line(d, [(18+k*3,25),(17+k*3,31)], '#718179')
    if direction == 'left': im = ImageOps.mirror(im)
    elif direction in ['down', 'up']:
        # Front/back views retain photographed facial and plumage identity.
        im, d = canvas()
        for x in [19,28]:
            line(d, [(x,34),(x,39)], '#c19462',2)
            polygon(d, [(x-3,41),(x,38),(x+3,41)], '#d4a369')
        ellipse(d, (11,18+bob,36,38), '#28343d')
        for row in range(6):
            for x in range(14+row%2,34,5):
                line(d,[(x,22+row*2+bob),(x+1,23+row*2+bob),(x+3,22+row*2+bob)],'#687971')
        ellipse(d,(17,10+bob,30,27+bob),'#e5e5d3')
        ellipse(d,(17,5+bob,30,18+bob),'#343d44')
        if direction=='down':
            polygon(d,[(18,10+bob),(20,8+bob),(24,10+bob),(28,8+bob),
                       (30,12+bob),(27,18+bob),(20,18+bob)],'#c34a45')
            for x in [20,27]:
                d.point((x,12+bob),'#e9ce9c'); d.point((x,13+bob),'#1a2835')
            polygon(d,[(21,15+bob),(26,15+bob),(27,19+bob),(24,21+bob),(21,19+bob)],'#d9d5bc')
        else:
            for y in [8,11,14]: line(d,[(19,y+bob),(24,y+1+bob),(28,y+bob)],'#8d9a8d')
        if state in ['windup','dash']:
            extent=0.3+t*0.7 if state=='windup' else 1
            for sign in [-1,1]:
                polygon(d,[(24+sign*10,22),(24+sign*(12+9*extent),22-11*extent),(24+sign*(12+8*extent),27),
                           (24+sign*13,32)],'#3e5051')
                for k in range(4): line(d,[(24+sign*12,24+k),(24+sign*(12+(8-k)*extent),22-6*extent+k*3)],'#839188')
    if state=='dash':
        # Small wing-tip feather variations communicate active powered rushing.
        if index%2:
            d=ImageDraw.Draw(im);line(d,[(8,18),(6,15)],'#9baba0');line(d,[(34,27),(39,22)],'#9baba0')
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


def first_boss(state,index,count,size=128):
    im,d=canvas((64,64));t=index/max(1,count-1)
    bob=round(math.sin(t*math.tau)*(2 if state=='walk' else 1)) if state in ['walk','idle'] else 0
    rise=-round(t*4) if state=='windup' else round(math.sin(t*math.pi)*2) if state=='attack' else round((1-t)*2) if state=='recover' else 0
    # A cracked laboratory dish grounds a rain-grown campus mushroom.
    ellipse(d,(9,49,55,59),'#627c7c')
    ellipse(d,(11,48,53,55),'#9eada0')
    arc(d,(32,51),(20,4),0,math.pi,'#d4d0b5')
    polygon(d,[(16,51),(20,47),(21,53),(28,51)],'#4d6565')
    polygon(d,[(24,27+rise),(23,45),(19,51),(29,54),(43,52),
               (39,45),(39,27+rise)],'#d9c49a')
    polygon(d,[(32,30+rise),(30,49),(34,51),(38,48),(36,29+rise)],'#a58d73',None)
    for x in [25,28,36]: line(d,[(x,33+rise),(x-1,46)],'#b6a17f')
    polygon(d,[(7,29+rise+bob),(11,19+rise+bob),(20,10+rise+bob),(31,7+rise+bob),
               (44,11+rise+bob),(53,20+rise+bob),(57,30+rise+bob),
               (48,35+rise+bob),(16,35+rise+bob)],'#8b5156')
    polygon(d,[(10,27+rise+bob),(19,16+rise+bob),(31,11+rise+bob),
               (45,16+rise+bob),(53,27+rise+bob),(41,25+rise+bob),
               (25,24+rise+bob)],'#b96e66',None)
    line(d,[(12,29+rise+bob),(23,27+rise+bob),(42,28+rise+bob),(53,31+rise+bob)],'#e1ac8a',2)
    for x,y,r in [(18,21,3),(29,15,3),(41,20,4),(48,27,2)]:
        ellipse(d,(x-r,y-r+rise+bob,x+r,y+r+rise+bob),'#ebcf9f','#a38272')
    for x in range(17,49,4): line(d,[(x,31+rise+bob),(31+(x-31)*.6,36+rise+bob)],'#745459')
    for x in [27,35]:
        ellipse(d,(x-2,37+rise,x+2,41+rise),'#303d43')
        d.point((x,37+rise),'#f1d8a0')
    line(d,[(29,45+rise),(32,46+rise),(35,44+rise)],'#7d5d59')
    for x,y in [(12,45),(50,42)]:
        ellipse(d,(x-3,y,x+4,y+4),'#91895d')
        ellipse(d,(x-4,y-2,x+5,y+1),'#6f8b6b')
    if state=='attack':
        for sign in [-1,1]:line(d,[(32+sign*14,55),(32+sign*23,56),(32+sign*29,52)],GOLD,2)
    if state=='hit':line(d,[(12,22),(10,26),(13,29)],'#f0c5a0' if index==0 else '#ca9382',2)
    if state=='death': im=fade(im,1-t)
    return resize(im,(size,size))


def paper_wing(d,side,open_amount,y=28,frost=True):
    root=(32,y);extent=round(13+15*open_amount)
    for k in range(5):
        x=32+side*(11+k*4)
        yy=y-11+k*3
        polygon(d,[root,(x,yy-extent*.5),(x+side*7,yy-extent*.35),
                   (x+side*4,yy+8),(32+side*8,y+8)],'#c3d4d0' if frost else '#c9b3b1')
        for row in range(3):line(d,[(x+side*1,yy+row*3),(x+side*5,yy+row*3+1)],'#76999d' if frost else '#8e7c91')
        if frost:polygon(d,[(x+side*5,yy+5),(x+side*6,yy+13),(x+side*2,yy+8)],'#88bfc7')


def frost_boss(action,index,count=16,size=128):
    im,d=canvas((64,64));t=index/count
    attacking=action=='attack'
    wing=.65+math.sin(t*math.tau)*.25 if not attacking else .4+math.sin(t*math.pi)*.6
    for side in [-1,1]:paper_wing(d,side,wing)
    polygon(d,[(25,22),(39,22),(42,48),(35,56),(22,50)],'#688a99')
    polygon(d,[(28,24),(34,24),(37,48),(31,51),(26,47)],'#d0ddd1')
    line(d,[(29,30),(35,30)],'#7a959e');line(d,[(29,35),(35,35)],'#7a959e')
    ellipse(d,(24,9,40,26),'#c8dbd3')
    polygon(d,[(23,15),(27,6),(35,6),(41,14),(36,12),(33,10),(28,12)],'#627b8c')
    polygon(d,[(23,19),(29,17),(35,17),(40,19),(35,24),(27,24)],'#577383')
    line(d,[(26,19),(29,20)],'#d4f0db');line(d,[(35,20),(38,19)],'#d4f0db')
    # A notebook-like spine and bookmark ribbon tie the birdlike silhouette to exams.
    polygon(d,[(29,26),(35,26),(35,38),(32,35),(29,38)],'#6caeb6')
    for side in [-1,1]:
        line(d,[(32+side*7,36),(32+side*12,41)],'#bed8d3',2)
        ellipse(d,(32+side*12-2,39,32+side*12+2,43),'#9fd2d6')
    if attacking:
        radius=round(9+12*t)
        for k in range(8):
            a=k*math.tau/8+t*.3
            px,py=32+math.cos(a)*radius,33+math.sin(a)*radius*.7
            polygon(d,[(px,py-2),(px+2,py),(px,py+2),(px-2,py)],'#bbefe1',None)
    return resize(im,(size,size))


def final_boss(action,index,count=16,size=128):
    im,d=canvas((64,64));t=index/count
    # Broken clock halo and orbiting ruled exam pages, rather than leg-like limbs.
    for segment in range(3):
        a=segment*math.tau/3+t*.4
        arc(d,(32,32),(25,25),a,a+1.6,'#877389')
    for k in range(12):
        a=k*math.tau/12+t*.15
        line(d,[(32+math.cos(a)*23,32+math.sin(a)*23),
                (32+math.cos(a)*25,32+math.sin(a)*25)],'#b59b9f')
    for k in range(5):
        a=k*math.tau/5+t*.65
        x=32+math.cos(a)*25;y=32+math.sin(a)*23
        polygon(d,[(x-4,y-6),(x+4,y-5),(x+4,y+5),(x-4,y+6)],'#c4b2b0')
        polygon(d,[(x+1,y-5),(x+4,y-5),(x+4,y-2)],'#e5d2b5',None)
        for row in range(3):line(d,[(x-2,y-2+row*2),(x+2,y-2+row*2)],'#7f7189')
    # Exactly two human sleeves and two open palms retain the student silhouette.
    for side in [-1,1]:
        polygon(d,[(32+side*8,24),(32+side*14,29),(32+side*18,38),
                   (32+side*14,42),(32+side*9,32)],'#48465f')
        ellipse(d,(32+side*16-3,38,32+side*16+3,43),'#8d8195')
    polygon(d,[(24,21),(39,21),(45,48),(42,56),(36,54),(32,58),
               (28,54),(21,56),(18,48)],'#34364d')
    polygon(d,[(23,25),(28,24),(26,48),(24,52),(21,49)],'#55516b',None)
    polygon(d,[(35,25),(40,29),(42,48),(37,51),(33,44)],'#4b4961',None)
    ellipse(d,(23,6,41,25),'#292e41')
    polygon(d,[(23,12),(24,6),(30,3),(39,5),(43,12),(36,9),
               (33,13),(29,10),(26,15)],'#53506b')
    line(d,[(25,17),(29,18)],'#d5b9d0',2);line(d,[(35,18),(39,17)],'#d5b9d0',2)
    ellipse(d,(23,26,41,44),'#a79094','#d7b99f')
    ellipse(d,(26,29,38,41),'#393c53','#5d5a72')
    for k in range(8):
        a=k*math.pi/4
        d.point((round(32+math.sin(a)*5),round(35-math.cos(a)*5)),PAPER)
    hand=t*math.tau*(2 if action=='attack' else .2)
    line(d,[(32,35),(32+math.sin(hand)*4,35-math.cos(hand)*4)],GOLD)
    line(d,[(32,35),(29,33)],'#e8ceb0')
    line(d,[(38,27),(35,32),(38,35),(35,39),(36,43)],'#e2c59b')
    if action=='walk':
        for k in range(5):
            x=19+k*6
            line(d,[(x,54),(x-2+math.sin(t*math.tau+k)*2,58)],'#84748e')
    if action in ['attack','poison']:
        color='#b3a4cc' if action=='attack' else '#8daa97'
        for k in range(7):
            a=k*math.tau/7+t*2
            px,py=32+math.cos(a)*(15+9*t),35+math.sin(a)*(14+8*t)
            polygon(d,[(px-2,py-3),(px+3,py-2),(px+2,py+4),(px-3,py+2)],color)
            line(d,[(px-1,py),(px+1,py+1)],'#4e5666')
    return resize(im,(size,size))


def all_frames(states, draw, **kwargs):
    return [draw(state,i,count,**kwargs) for state,count in states for i in range(count)]
