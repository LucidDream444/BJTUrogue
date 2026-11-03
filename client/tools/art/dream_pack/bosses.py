"""Campus bosses, authored on a 64 px grid with an unchanged (32, 58) foot.

Bound books, an origami exam bird and a shattered classroom clock are the
silhouettes. Every boss remains an animated campus object, without human anatomy.
"""
from __future__ import annotations

import math
from .drawing import canvas, polygon, ellipse, line, resize, fade, INK, GOLD

PAGE = '#eee2bd'
PAGE_LIGHT = '#fff0cf'
PAGE_SHADOW = '#b8ad90'
PRINT = '#657179'
RED = '#b84747'

GLYPHS = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '9': ['111', '101', '111', '001', '111'],
    'A': ['010', '101', '111', '101', '101'],
    'B': ['110', '101', '110', '101', '110'],
    'C': ['111', '100', '100', '100', '111'],
    'E': ['111', '100', '110', '100', '111'],
    'H': ['101', '101', '111', '101', '101'],
    'M': ['101', '111', '111', '101', '101'],
    'T': ['111', '010', '010', '010', '010'],
    'X': ['101', '101', '010', '101', '101'],
    ':': ['0', '1', '0', '1', '0'],
}


def lettering(d, x, y, text, color=PRINT):
    """Native bitmap lettering avoids fonts, smoothing, and tiny illegible text."""
    for character in text:
        glyph = GLYPHS.get(character)
        if glyph:
            for yy, row in enumerate(glyph):
                for xx, value in enumerate(row):
                    if value == '1':
                        d.point((round(x+xx), round(y+yy)), fill=color)
            x += len(glyph[0]) + 1
        else:
            x += 3


def exam_page(d, x, y, width=9, height=13, marked=True):
    """A loose, printed exam page: folded corner, title and answer boxes."""
    polygon(d, [(x, y), (x+width-3, y), (x+width, y+3),
                (x+width, y+height), (x, y+height)], PAGE)
    polygon(d, [(x+width-3, y), (x+width-3, y+3), (x+width, y+3)], PAGE_LIGHT, PAGE_SHADOW)
    line(d, [(x+2, y+3), (x+width-4, y+3)], PRINT)
    for row in range(2):
        yy = y+6+row*3
        line(d, [(x+2, yy), (x+width-2, yy)], PRINT)
    if marked:
        line(d, [(x+2, y+8), (x+4, y+10), (x+width-2, y+6)], RED)


def textbook(d, x, y, width, height, cover, edge, title=None):
    """A chunky bound textbook with separate covers, page strata and spine."""
    polygon(d, [(x, y), (x+width-2, y), (x+width, y+2),
                (x+width, y+height-1), (x+2, y+height), (x, y+height-2)], cover)
    polygon(d, [(x+4, y+2), (x+width-2, y+2), (x+width-2, y+height-2),
                (x+4, y+height-2)], PAGE, None)
    line(d, [(x+4, y+3), (x+width-3, y+3)], PAGE_LIGHT)
    for yy in range(y+4, y+height-2, 2):
        line(d, [(x+5, yy), (x+width-3, yy)], PAGE_SHADOW)
    line(d, [(x+2, y+1), (x+2, y+height-1)], edge)
    line(d, [(x+3, y), (x+width-2, y)], edge)
    if title:
        # A cover flap across the fore-edge is large enough to read as a label.
        d.rectangle((x+8, y+1, x+width-5, y+6), fill=cover)
        lettering(d, x+10, y+1, title, PAGE_LIGHT)


def first_boss(state, index, count, size=128):
    im, d = canvas((64, 64))
    t = index/max(1, count-1)
    bob = round(math.sin(t*math.tau)*(2 if state=='walk' else 1)) if state in ['idle','walk'] else 0
    compress = round(t*3) if state=='windup' else round((1-math.sin(t*math.pi))*3) if state=='attack' else round((1-t)*2) if state=='recover' else 0
    shake = (1 if index%2 else -1) if state=='hit' else 0
    # The ground is a crooked stack of unmistakably bound course textbooks.
    textbook(d, 10, 49, 43, 9, '#345b72', '#85a0a0')
    textbook(d, 7+shake, 40, 47, 10, '#8a4d50', '#ca8b75', 'MATH')
    textbook(d, 12-shake, 31+compress, 39, 10, '#65765b', '#a8b48c')
    polygon(d, [(17, 49), (21, 49), (21, 57), (19, 55), (17, 57)], '#bf5a50')
    polygon(d, [(45, 40), (48, 40), (48, 48), (46, 46), (45, 48)], '#dfb36d')
    # Loose homework sleeves extend from the stack; these are paper, not weapons.
    reach = 3 if state=='attack' else round(t*2) if state=='windup' else 0
    for side in [-1, 1]:
        root = 32+side*18
        tip = 32+side*(25+reach)
        yy = 36-compress
        polygon(d, [(root, yy), (tip, yy-5), (tip+side, yy+3),
                    (root, yy+7)], PAGE)
        line(d, [(root+side*2, yy+1), (tip-side, yy-1)], PRINT)
        line(d, [(root+side*2, yy+4), (tip-side, yy+2)], PRINT)
    # The head is an open exercise book. Its gutter, red margin and binding rings
    # stay visible around the angry annotation-eyes, so it cannot read as a cap.
    yy = 12+bob+compress
    polygon(d, [(9+shake, yy), (23+shake, yy-2), (32+shake, yy+2),
                (41+shake, yy-2), (55+shake, yy), (53+shake, yy+19),
                (40+shake, yy+18), (32+shake, yy+21), (24+shake, yy+18),
                (11+shake, yy+19)], '#8d484b')
    polygon(d, [(11+shake, yy+1), (23+shake, yy-1), (31+shake, yy+3),
                (31+shake, yy+18), (23+shake, yy+15), (13+shake, yy+17)], PAGE)
    polygon(d, [(33+shake, yy+3), (41+shake, yy-1), (53+shake, yy+1),
                (51+shake, yy+17), (41+shake, yy+15), (33+shake, yy+18)], PAGE_LIGHT)
    line(d, [(15+shake, yy+1), (16+shake, yy+15)], '#ce8074')
    line(d, [(49+shake, yy+1), (48+shake, yy+15)], '#ce8074')
    for row in [3, 6, 13]:
        line(d, [(17+shake, yy+row), (27+shake, yy+row+1)], '#91988c')
        line(d, [(37+shake, yy+row+1), (47+shake, yy+row)], '#91988c')
    for y in [yy+4, yy+9, yy+14]:
        ellipse(d, (30+shake, y, 34+shake, y+2), '#687278', INK)
    for side in [-1,1]:
        cx = 32+side*10+shake
        polygon(d, [(cx-5, yy+7-side), (cx+5, yy+7+side),
                    (cx+3, yy+11), (cx-3, yy+11)], '#3b3a49')
        line(d, [(cx-4, yy+6-side), (cx+4, yy+6+side)], RED, 2)
        d.point((cx, yy+9), '#f6a883')
    # The jagged mouth is the torn, dark binding between two books.
    polygon(d, [(20, 33+compress), (44, 33+compress), (40, 38+compress),
                (24, 38+compress)], '#343341')
    for x in [23, 29, 35, 41]:
        polygon(d, [(x-1, 33+compress), (x+2, 33+compress), (x, 36+compress)], PAGE, None)
    polygon(d, [(31, 37+compress), (34, 37+compress), (34, 44), (32, 42), (31, 44)], RED)
    if state in ['windup','attack']:
        exam_page(d, 3+round(t*2), 5+round(math.sin(t*math.pi)*3), 7, 10)
        exam_page(d, 53-round(t*2), 3+round(t*3), 7, 10)
    if state=='attack':
        for side in [-1,1]:
            line(d, [(32+side*15, 58), (32+side*24, 57), (32+side*29, 53)], GOLD, 2)
    if state=='hit':
        line(d, [(12, yy+1), (11, yy+9), (13, yy+16)], '#ffe3ad', 2)
    if state=='death':
        # Homework finally comes apart into loose sheets instead of a mushroom fade.
        for k in range(3):
            exam_page(d, 10+k*17+round((k-1)*t*3), 9+round(t*17)+k*3, 8, 11)
        im = fade(im, 1-t)
    return resize(im, (size, size))


def exam_wing(d, side, flap):
    tip_y = max(3, 7+round(flap*6))
    x = lambda distance: 32+side*distance
    # One folded exam sheet forms each origami wing, with crease facets.
    polygon(d, [(x(2), 25), (x(12), 10), (x(28), tip_y),
                (x(30), tip_y+20), (x(23), tip_y+16),
                (x(21), 40), (x(12), 35), (x(7), 42)], PAGE)
    polygon(d, [(x(2), 25), (x(28), tip_y), (x(19), 27), (x(7), 34)], PAGE_LIGHT, '#b4b2a0')
    polygon(d, [(x(7), 34), (x(19), 27), (x(21), 40), (x(12), 35)], '#b8c6bc', '#789596')
    line(d, [(x(11), 18), (x(26), tip_y+5)], PRINT)
    line(d, [(x(11), 21), (x(27), tip_y+8)], PRINT)
    line(d, [(x(13), 26), (x(27), tip_y+12)], PRINT)
    # Three answer boxes and a large red correction circle are visible at game size.
    for distance in [17,21,25]:
        xx = x(distance)
        yy = tip_y+14
        d.rectangle((xx-1, yy, xx+1, yy+2), outline=PRINT)
    xx = x(21)
    ellipse(d, (xx-3, tip_y+12, xx+3, tip_y+18), None, RED)
    line(d, [(x(10), 30), (x(13), 33), (x(20), 25)], RED, 2)
    # Thin turquoise paper-edge frost retains the second encounter's cold identity.
    line(d, [(x(24), tip_y+17), (x(21), 40), (x(18), 38)], '#8ec6c4')


def frost_boss(action, index, count=16, size=128):
    im, d = canvas((64,64))
    t = index/count
    flap = math.sin(t*math.tau)
    attacking = action=='attack'
    for side in [-1,1]:
        exam_wing(d, side, flap if not attacking else flap*1.5)
    # A printed answer slip forms the bird's breast, without an ID portrait.
    polygon(d, [(25, 24), (39, 24), (41, 43), (33, 55), (23, 43)], '#9bb5af')
    polygon(d, [(25, 27), (38, 27), (36, 43), (29, 48), (25, 41)], PAGE)
    for yy in [29, 32]:
        d.rectangle((27, yy, 29, yy+1), outline=PRINT)
        d.rectangle((31, yy, 33, yy+1), outline=PRINT)
    line(d, [(33, 30), (36, 30)], PRINT)
    line(d, [(33, 33), (36, 33)], PRINT)
    for yy in [38,41]:
        line(d, [(27, yy), (35, yy)], PRINT)
    line(d, [(26, 36), (37, 36)], RED)
    # The head and long folded beak are paper bird anatomy, without a human face.
    polygon(d, [(27, 23), (25, 14), (30, 5), (38, 9), (40, 19),
                (48, 23), (37, 24), (33, 29)], PAGE_LIGHT)
    polygon(d, [(30, 5), (31, 17), (25, 14)], '#a7b8b5')
    polygon(d, [(31, 17), (40, 19), (48, 23), (36, 21)], '#93afb0')
    line(d, [(31, 17), (34, 12), (38, 12)], RED, 2)
    d.point((35, 16), '#323b48')
    line(d, [(36, 23), (43, 23)], '#5c7b83')
    # Folded tail, two bookmark streamers and fixed ground tip.
    polygon(d, [(29, 45), (33, 51), (39, 45), (35, 58), (30, 54)], PAGE)
    line(d, [(24, 39), (20, 47), (23, 49), (20, 54)], RED)
    line(d, [(41, 39), (45, 45), (43, 49), (45, 53)], RED)
    if attacking:
        # Orbiting marked test pages, distinct from the main wing silhouette.
        for side in [-1,1]:
            xx = 7+round(t*5) if side<0 else 49-round(t*5)
            exam_page(d, xx, 43-round(math.sin(t*math.pi)*7), 7, 10)
    return resize(im, (size,size))


def final_boss(action, index, count=16, size=128):
    """A shattered exam clock suspended in marked papers; no humanoid silhouette."""
    im, d = canvas((64,64))
    t = index/count
    attacking = action in ['attack','poison']
    phase = t*math.tau
    bob = round(math.sin(phase)*(2 if action=='walk' else 1))
    cx = 32+round(math.sin(phase)*1) if action=='walk' else 32
    cy = 29+bob
    glow = '#a9bb91' if action=='poison' else '#dc8970'
    # Widely spaced sheets orbit behind the clock rather than extending as arms.
    # Their positions are asymmetric, with no paired hands, shoes or shoulders.
    for k, (x,y) in enumerate([(4,14), (49,7), (3,37), (51,34)]):
        yy = y+round(math.sin(phase+k*1.7)*(3 if attacking else 1))
        exam_page(d, x, yy, 8, 11)
    # A broad, horizontal paper spiral carries the object down to its fixed foot.
    # It is deliberately wider than the clock's lower rim, never a gown or torso.
    sweep = round(math.sin(phase)*2)
    polygon(d, [(9,46), (19,43), (48,43), (55,47), (47,51),
                (23,52), (16,49), (34,47), (46,48), (24,48)], PAGE_SHADOW)
    polygon(d, [(11,45), (27,42), (48,45), (52,48), (37,51),
                (19,49), (16,47), (31,46), (41,48), (24,48)], PAGE_LIGHT)
    line(d, [(13,46), (28,44), (45,46)], RED)
    line(d, [(20,49), (36,50), (49,48)], PRINT)
    polygon(d, [(23,50), (42,50), (46+sweep,53), (37,56),
                (27,55), (32,58), (21,55), (18,52), (32,52),
                (37,53), (28,54)], PAGE)
    line(d, [(25,51), (39,52), (40,53), (28,55), (32,58)], RED)
    # A wall clock is the entire central mass: thick case, ivory dial and ticks.
    ellipse(d, (cx-23,cy-23,cx+23,cy+23), '#4e5961', INK)
    ellipse(d, (cx-22,cy-22,cx+22,cy+22), '#b59b70', '#dfc899')
    ellipse(d, (cx-19,cy-19,cx+19,cy+19), PAGE, '#675e57')
    line(d, [(cx-15,cy-14), (cx-9,cy-18), (cx+5,cy-19)], PAGE_LIGHT, 2)
    for k in range(12):
        a = k*math.tau/12
        line(d, [(cx+math.sin(a)*16, cy-math.cos(a)*16),
                 (cx+math.sin(a)*18, cy-math.cos(a)*18)], '#645f60', 2 if k%3==0 else 1)
    lettering(d, cx-3, cy-14, '12', '#555866')
    lettering(d, cx+12, cy-2, '3', '#555866')
    lettering(d, cx-15, cy-2, '9', '#555866')
    # The missing bottom-right quarter exposes gears, never eyes or a mouth.
    polygon(d, [(cx+10,cy+3), (cx+19,cy+5), (cx+19,cy+13),
                (cx+11,cy+21), (cx+1,cy+20), (cx+4,cy+13),
                (cx+1,cy+9), (cx+8,cy+10)], '#3b4657', INK)
    for gx,gy,radius in [(cx+11,cy+11,5), (cx+5,cy+17,3)]:
        for k in range(8):
            a = phase+(k*math.tau/8)
            line(d, [(gx+math.cos(a)*(radius-1),gy+math.sin(a)*(radius-1)),
                     (gx+math.cos(a)*(radius+1),gy+math.sin(a)*(radius+1))], '#a89c85', 2)
        ellipse(d, (gx-radius,gy-radius,gx+radius,gy+radius), '#897b6b', '#cab88b')
        ellipse(d, (gx-1,gy-1,gx+1,gy+1), '#3b4657', INK)
    line(d, [(cx+13,cy-17), (cx+9,cy-10), (cx+12,cy-4),
             (cx+6,cy+1), (cx+8,cy+8)], '#77676a', 2)
    line(d, [(cx+13,cy-17), (cx+9,cy-10), (cx+12,cy-4),
             (cx+6,cy+1)], glow)
    # A familiar clock mechanism and independent exam countdown carry the threat.
    hand = phase*(2 if attacking else 1)-.35
    line(d, [(cx,cy), (cx-7,cy-5)], '#4b5360', 2)
    line(d, [(cx,cy), (cx+math.sin(hand)*14,cy-math.cos(hand)*14)], RED, 2)
    line(d, [(cx,cy), (cx-math.sin(hand)*4,cy+math.cos(hand)*4)], '#cd8870')
    ellipse(d, (cx-2,cy-2,cx+2,cy+2), '#b65b51', INK)
    d.rectangle((cx-12,cy-26,cx+12,cy-20), fill='#49333d', outline='#bc7366')
    lettering(d, cx-10, cy-25, '00:01', '#ffb785')
    # One detached correction sheet crosses the rim at an oblique angle. The
    # irregular path and red answer grid read as a paper storm at gameplay size.
    yy = 41+round(math.sin(phase+1)*2)
    polygon(d, [(8,yy), (20,yy-3), (23,yy+5), (12,yy+9)], PAGE_LIGHT)
    line(d, [(11,yy+1), (18,yy-1)], PRINT)
    line(d, [(12,yy+4), (19,yy+2)], PRINT)
    line(d, [(14,yy+5), (17,yy+7), (21,yy+1)], RED)
    if attacking:
        for k in range(3):
            x = 6+k*20+round(math.sin(phase+k)*2)
            y = 55-round(math.sin(phase+k*2)*2)
            line(d, [(x,y), (x+5,y-2), (x+8,y-1)], glow)
    return resize(im, (size,size))
