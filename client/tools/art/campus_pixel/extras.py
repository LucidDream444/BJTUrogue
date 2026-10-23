"""Two additional photo-specific campus details, authored as native pixels."""
from __future__ import annotations

from PIL import Image, ImageDraw

from .drawing import canvas


def _neon_line(draw, points, bright=False):
    """Hard copper tube outline with amber light, without a blurred halo."""
    draw.line(points, fill='#82543B', width=3)
    draw.line(points, fill='#D79359' if bright else '#C4804C', width=2)


def _icecream_neon():
    image = canvas()
    d = ImageDraw.Draw(image)
    # Photo 19's narrow arch and lower crescent are separated from the wall.
    arch = [(39, 69), (40, 58), (43, 50), (47, 44), (53, 40),
            (59, 38), (66, 38), (73, 40), (79, 44), (84, 50),
            (87, 58), (88, 69)]
    _neon_line(d, arch)
    d.line([(41, 67), (42, 58), (45, 50), (49, 45), (55, 41)], fill='#E2B384')
    d.line([(72, 41), (77, 44), (82, 50)], fill='#E0AA74')
    # The soft-serve contour is deliberately stepped and asymmetric.
    contour = [(55, 78), (52, 73), (51, 67), (52, 61), (55, 56),
               (60, 52), (60, 48), (63, 45), (67, 45), (69, 47),
               (68, 50), (65, 50), (64, 48), (63, 51), (66, 54),
               (71, 57), (75, 61), (76, 66), (75, 70), (71, 73),
               (65, 75), (60, 74), (57, 72), (56, 75), (55, 78)]
    _neon_line(d, contour, bright=True)
    _neon_line(d, [(55, 58), (56, 62), (60, 65), (67, 67), (72, 66)])
    _neon_line(d, [(53, 65), (55, 68), (60, 70), (67, 71), (73, 69)])
    _neon_line(d, [(57, 54), (59, 57), (64, 60), (70, 61)])
    # Open triangular cone with a pale highlight on its left edge.
    _neon_line(d, [(55, 74), (61, 92), (63, 94), (65, 91), (72, 74)])
    d.line([(56, 76), (59, 85), (61, 90)], fill='#F0BD83')
    d.line([(53, 65), (53, 69), (55, 72)], fill='#E8BA85')
    d.line([(64, 46), (67, 46)], fill='#F3C99B')
    d.line([(72, 59), (74, 62), (74, 65)], fill='#EFC18D')
    # Short neutral bars suggest the original sign's lower lettering rhythm
    # without reproducing the brand name or fabricating unreadable glyphs.
    for left, right, y in ((40, 46, 94), (48, 54, 94), (74, 79, 94), (82, 88, 94),
                           (44, 49, 99), (52, 57, 99), (70, 76, 99), (80, 85, 99)):
        d.line((left, y, right, y), fill='#D8D6C1', width=2)
        d.point((left, y), fill='#F3E9CF')
    _neon_line(d, [(44, 102), (49, 105), (56, 107), (64, 108),
                  (71, 107), (79, 104), (84, 101)])
    d.line([(49, 104), (56, 106), (64, 107), (70, 106)], fill='#EFC08B')
    # Tiny tube-end caps remain part of the sign; no wall plate is included.
    d.rectangle((38, 71, 42, 72), fill='#ADA996')
    d.rectangle((85, 71, 89, 72), fill='#ADA996')
    return image


def _floor_marker():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.ellipse((53, 86, 76, 108), fill='#57442D')
    d.ellipse((53, 85, 75, 107), fill='#99703E')
    d.ellipse((54, 86, 74, 106), fill='#D5AC63')
    d.ellipse((56, 88, 72, 104), fill='#BF9550')
    d.line([(56, 91), (58, 88), (63, 87), (67, 88)], fill='#E5C47D')
    # A readable black six is the original circular floor marker's content.
    six = [(68, 91), (64, 91), (61, 93), (60, 97), (60, 101),
           (62, 103), (66, 103), (68, 101), (68, 98), (66, 96),
           (63, 96), (61, 98)]
    d.line(six, fill='#362E23', width=2)
    d.point((65, 92), fill='#4C3925')
    return image


def build_sprites() -> dict[str, Image.Image]:
    """Return two isolated native sprites, both anchored at (64, 108)."""
    return {
        'prop_lobby_icecream_neon': _icecream_neon(),
        'prop_stairwell_floor_marker_6': _floor_marker(),
    }
