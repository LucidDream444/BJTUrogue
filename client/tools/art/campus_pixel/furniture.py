"""Photo-referenced campus furniture, drawn directly on a native pixel grid.

All objects share the ground anchor (64, 108).  Faces and surface highlights
are opaque pixel clusters; transparent pixels are reserved for empty space.
"""
from __future__ import annotations

from PIL import Image, ImageDraw

from .drawing import P, canvas, grain


def _stepped_panel(draw, box, fill, edge):
    """Rounded plywood corners made from whole pixels, without smoothing."""
    left, top, right, bottom = box
    points = [
        (left + 3, top), (right - 3, top), (right - 1, top + 1),
        (right, top + 3), (right, bottom - 1), (right - 1, bottom),
        (left + 1, bottom), (left, bottom - 1), (left, top + 3),
        (left + 1, top + 1),
    ]
    draw.polygon(points, fill=edge)
    inner = [
        (left + 3, top + 1), (right - 3, top + 1),
        (right - 1, top + 3), (right - 1, bottom - 2),
        (right - 2, bottom - 1), (left + 2, bottom - 1),
        (left + 1, bottom - 2), (left + 1, top + 3),
    ]
    draw.polygon(inner, fill=fill)


def _foot(draw, center, y=108, width=15):
    left, right = center - width // 2, center + width // 2
    draw.polygon([
        (left + 2, y - 4), (right - 2, y - 4), (right, y - 2),
        (right, y - 1), (right - 2, y), (left + 1, y),
        (left, y - 1), (left, y - 2),
    ], fill=P['steel_dark'])
    draw.line((left + 3, y - 3, right - 3, y - 3), fill=P['steel_light'])
    draw.line((left + 2, y - 2, right - 1, y - 2), fill=P['steel'])
    draw.point((left + 2, y - 1), fill=P['steel_light'])


def _desk(width, back=False):
    image = canvas()
    d = ImageDraw.Draw(image)
    x0, x1 = 64 - width // 2, 64 + (width - 1) // 2
    # The pair of fixed pedestals belongs to the desk, not four loose legs.
    for sx in (x0 + 6, x1 - 6):
        _foot(d, sx, width=13 if width == 32 else 15)
        d.rectangle((sx - 2, 77, sx + 2, 104), fill=P['steel_dark'])
        d.line((sx - 1, 81, sx - 1, 102), fill=P['steel_light'])
        d.line((sx, 81, sx, 104), fill=P['steel'])
    d.rectangle((x0 + 4, 94, x1 - 4, 97), fill=P['steel_dark'])
    d.line((x0 + 5, 94, x1 - 5, 94), fill=P['steel_light'])

    if back:
        # Photograph 15: the broad yellow modesty board is the desk's rear.
        d.rectangle((x0 + 2, 77, x1 - 2, 100), fill=P['wood_edge'])
        d.rectangle((x0 + 3, 78, x1 - 3, 99), fill=P['wood'])
        d.line((x0 + 3, 78, x1 - 3, 78), fill=P['wood_light'])
        d.line((x0 + 3, 99, x1 - 3, 99), fill=P['wood_shadow'])
        grain(image, (x0 + 3, 80, x1 - 2, 98), seed=175)
        for bx in (x0 + 6, x1 - 6):
            for by in (82, 95):
                d.point((bx, by), fill=P['wood_dark'])
    else:
        # Deep brown empty opening; the yellow shelf is below, never a drawer.
        d.rectangle((x0 + 2, 77, x1 - 2, 91), fill=P['wood_shadow'])
        d.rectangle((x0 + 3, 79, x1 - 3, 88), fill=P['wood_dark'])
        d.rectangle((x0 + 3, 79, x1 - 3, 81), fill='#493D2C')
        d.rectangle((x0 + 3, 87, x1 - 3, 91), fill=P['wood_shadow'])
        d.line((x0 + 3, 88, x1 - 3, 88), fill='#AC8B50')
        d.rectangle((x0 + 1, 92, x1 - 1, 94), fill=P['wood_edge'])
        d.line((x0 + 1, 92, x1 - 1, 92), fill=P['wood_light'])
        d.line((x0 + 2, 94, x1 - 2, 94), fill=P['wood_shadow'])
        d.line((x0 + 2, 79, x0 + 2, 91), fill=P['wood_edge'])
        d.line((x1 - 2, 79, x1 - 2, 91), fill=P['wood_shadow'])
        if width > 32:
            # A quiet join, not a row of invented closed drawer fronts.
            for join in range(x0 + 32, x1 - 8, 32):
                d.line((join, 89, join, 93), fill=P['wood_shadow'])

    # Flat parallel desktop edges suit the common front orthographic camera.
    d.rectangle((x0, 64, x1, 76), fill=P['wood_edge'])
    d.rectangle((x0 + 1, 63, x1 - 1, 75), fill=P['wood'])
    d.line((x0 + 2, 63, x1 - 2, 63), fill=P['wood_light'])
    d.line((x0 + 1, 64, x0 + 1, 74), fill=P['wood_light'])
    d.rectangle((x0 + 1, 76, x1 - 1, 78), fill=P['wood_edge'])
    d.line((x0 + 2, 76, x1 - 2, 76), fill='#D8B979')
    d.line((x0 + 1, 78, x1 - 1, 78), fill=P['wood_shadow'])
    grain(image, (x0 + 2, 64, x1 - 1, 75), seed=40 + width)
    for join in range(x0 + 32, x1 - 8, 32):
        d.line((join, 64, join, 77), fill=P['wood_shadow'])
        d.line((join + 1, 64, join + 1, 75), fill='#D3B474')
    return image


def _backrest(image, rear=False):
    d = ImageDraw.Draw(image)
    _stepped_panel(d, (52, 59, 75, 85), P['blue'], P['wood_edge'])
    d.rectangle((54, 64, 72, 79), fill=P['blue'])
    d.line((56, 61, 70, 61), fill=P['blue_light'])
    d.line((54, 63, 54, 75), fill='#629AC0')
    d.rectangle((55, 80, 73, 83), fill='#36749F' if rear else '#3A79A6')
    d.line((55, 84, 73, 84), fill=P['wood_shadow'])
    # The blue plywood is plain and hard, rather than cushioned upholstery.
    if rear:
        d.line((57, 64, 57, 76), fill='#5190BB')
        d.line((72, 66, 72, 79), fill='#36749F')
    else:
        d.line((57, 64, 57, 69), fill='#5B98C2')
    for bx in (55, 72):
        for by in (67, 80):
            d.point((bx, by), fill=P['blue_dark'])
            d.point((bx + 1, by), fill='#86AEC2')


def _chair(front=True, folded=False):
    image = canvas()
    d = ImageDraw.Draw(image)
    for cx in (53, 74):
        _foot(d, cx, width=11)
        d.rectangle((cx - 1, 78, cx + 1, 104), fill=P['steel_dark'])
        d.line((cx - 1, 82, cx - 1, 102), fill=P['steel_light'])
    d.rectangle((51, 96, 76, 98), fill=P['steel'])
    d.line((53, 96, 74, 96), fill=P['steel_light'])
    if not front:
        # Slightly more rear frame is exposed below the blue back panel.
        d.rectangle((52, 81, 54, 96), fill=P['steel'])
        d.rectangle((73, 81, 75, 96), fill=P['steel'])
    if front:
        _backrest(image)
    if folded:
        # Pan pivots about the same y=92 hinge and lifts toward the backrest.
        _stepped_panel(d, (53, 79, 74, 94), '#3C7DAA', P['wood_edge'])
        d.line((56, 80, 70, 80), fill='#72A4C5')
        d.rectangle((55, 83, 72, 90), fill=P['blue'])
        d.line((55, 92, 72, 92), fill=P['blue_shadow'])
        d.line((56, 93, 71, 93), fill=P['wood_shadow'])
        if not front:
            d.line((57, 85, 70, 85), fill='#36749F')
    else:
        _stepped_panel(d, (51, 85, 76, 96), P['blue'], P['wood_edge'])
        d.line((54, 86, 72, 86), fill=P['blue_light'])
        d.rectangle((53, 88, 74, 92), fill=P['blue'])
        d.line((54, 93, 73, 93), fill='#3C7DAA')
        d.line((53, 95, 74, 95), fill=P['wood_shadow'])
        d.line((54, 96, 73, 96), fill=P['wood_edge'])
    if not front:
        # A north-facing seat's rear back panel obscures the raised seat pan.
        # Drawing it last avoids showing a front-mounted pan on the chair back.
        _backrest(image, rear=True)
        d.line((53, 84, 53, 97), fill=P['steel_dark'])
        d.line((74, 84, 74, 97), fill=P['steel_dark'])
        d.line((54, 85, 54, 94), fill=P['steel_light'])
    # Fixed black side arm/hinge fittings, not an X-shaped folding frame.
    for hx in (50, 76):
        d.rectangle((hx - 1, 86, hx + 1, 93), fill=P['steel_dark'])
        d.rectangle((hx - 1, 87, hx + 1, 89), fill=P['steel'])
        d.point((hx, 91), fill=P['steel_light'])
    return image


def _chair_side(left, folded):
    image = canvas()
    d = ImageDraw.Draw(image)
    # Define a west-facing profile, reflect the geometry for the east view.
    def poly(points, color):
        d.polygon([(x if left else 127 - x, y) for x, y in points], fill=color)

    def line(points, color, width=1):
        d.line([(x if left else 127 - x, y) for x, y in points], fill=color, width=width)

    _foot(d, 66 if left else 61, width=29)
    poly([(69, 82), (75, 82), (75, 104), (70, 104)], P['steel_dark'])
    line([(70, 86), (70, 103)], P['steel_light'])
    # Back leans a little as in the real row seats; no photographic taper.
    poly([(69, 59), (74, 59), (78, 84), (75, 87), (71, 85)], P['wood_edge'])
    poly([(69, 61), (73, 61), (76, 81), (74, 84), (72, 82)], P['blue'])
    line([(70, 62), (73, 79)], '#77A7C9')
    line([(75, 67), (77, 82)], P['wood_shadow'])
    if folded:
        poly([(67, 78), (71, 78), (74, 92), (69, 94), (66, 83)], P['wood_edge'])
        poly([(67, 79), (70, 80), (72, 91), (69, 92), (67, 84)], P['blue'])
        line([(68, 81), (70, 90)], P['blue_light'])
    else:
        poly([(49, 86), (70, 84), (75, 89), (72, 95), (49, 95), (47, 92)], P['wood_edge'])
        poly([(50, 86), (69, 85), (73, 89), (70, 92), (49, 92), (48, 90)], P['blue'])
        line([(51, 87), (68, 86)], P['blue_light'])
        line([(50, 94), (71, 94)], P['wood_shadow'])
    poly([(67, 90), (72, 88), (76, 89), (77, 92), (75, 95), (69, 95)], P['steel_dark'])
    line([(69, 91), (74, 90)], P['steel_light'])
    px = 72 if left else 55
    d.rectangle((px, 91, px + 1, 92), fill=P['silver_shadow'])
    return image


def _lectern_multimedia():
    image = canvas()
    d = ImageDraw.Draw(image)
    # Cream steel housing with dark plinth, and a plain perforated front.
    d.rectangle((38, 103, 89, 108), fill=P['steel_dark'])
    d.rectangle((36, 68, 91, 104), fill=P['wall_shadow'])
    d.rectangle((38, 69, 89, 103), fill=P['cream'])
    d.line((39, 72, 39, 100), fill=P['wall_light'])
    d.rectangle((85, 72, 89, 102), fill='#C2C3B8')
    d.line((38, 103, 88, 103), fill='#B2B6AA')
    for y in range(85, 100, 3):
        for x in range(44, 82, 5):
            d.line((x, y, x + 2, y), fill='#A1A79E')
    d.rectangle((52, 75, 77, 80), fill=P['wall_shadow'])
    d.rectangle((53, 76, 76, 78), fill='#E8E8DA')
    # Broad black desktop with bevel and a small integral control area.
    d.rectangle((33, 60, 94, 69), fill=P['steel_dark'])
    d.rectangle((35, 59, 92, 66), fill=P['steel'])
    d.line((36, 59, 91, 59), fill=P['steel_light'])
    d.rectangle((43, 64, 76, 66), fill='#1C272A')
    for x in (45, 48, 51, 57, 60, 63):
        d.point((x, 65), fill='#79857F')
    d.point((72, 65), fill=P['green'])
    # The screen and microphone are physically attached to the lectern.
    d.rectangle((59, 57, 65, 62), fill=P['steel_dark'])
    d.rectangle((51, 45, 76, 58), fill=P['steel_dark'])
    d.rectangle((53, 47, 74, 55), fill='#7A9798')
    d.rectangle((54, 48, 73, 53), fill='#AFC3BE')
    d.line((54, 48, 72, 48), fill='#D1D9CC')
    d.point((73, 57), fill=P['green'])
    d.line([(84, 63), (84, 52), (87, 48), (87, 43)], fill=P['steel_dark'], width=2)
    d.line([(83, 61), (83, 52), (86, 48)], fill=P['steel_light'])
    d.rectangle((86, 41, 89, 44), fill=P['steel_dark'])
    return image


def _lectern_wood():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((42, 103, 85, 108), fill=P['brown_dark'])
    d.rectangle((40, 63, 87, 104), fill='#4C342A')
    d.rectangle((42, 65, 85, 102), fill='#6B4935')
    d.line((42, 65, 84, 65), fill='#99714B')
    d.line((42, 66, 42, 101), fill='#805B40')
    d.rectangle((81, 66, 85, 102), fill='#60402E')
    for y, x, length in [(70, 47, 21), (74, 61, 15), (82, 48, 24), (88, 56, 20), (96, 46, 28)]:
        d.line((x, y, x + length, y), fill='#73503A')
    d.line((43, 102, 84, 102), fill='#422F26')
    d.rectangle((38, 59, 89, 64), fill=P['brown_dark'])
    d.rectangle((39, 58, 88, 61), fill='#7B5940')
    d.line((40, 58, 87, 58), fill='#A07C52')
    d.line((42, 60, 77, 60), fill='#886647')
    return image


def _podium():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((17, 77, 110, 99), fill=P['tile_shadow'])
    d.rectangle((18, 77, 109, 97), fill=P['tile'])
    d.line((19, 77, 108, 77), fill=P['tile_light'])
    for x in (48, 79):
        d.line((x, 78, x, 97), fill=P['grout'])
        d.line((x + 1, 78, x + 1, 97), fill='#D1CDBF')
    d.line((18, 87, 109, 87), fill='#ABAFA1')
    d.line((18, 88, 109, 88), fill='#D4D1C4')
    d.rectangle((17, 98, 110, 100), fill=P['steel_dark'])
    d.line((18, 98, 109, 98), fill=P['steel_light'])
    d.rectangle((18, 101, 109, 107), fill=P['tile_shadow'])
    d.line((19, 101, 108, 101), fill='#BBBDB0')
    for x in (48, 79):
        d.line((x, 102, x, 107), fill='#8D9488')
    d.line((19, 108, 108, 108), fill='#7C8379')
    return image


def _chair_row():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((22, 96, 105, 99), fill=P['steel_dark'])
    d.line((23, 96, 104, 96), fill=P['steel_light'])
    for offset, folded in ((-30, True), (0, False), (30, True)):
        image.alpha_composite(_chair(front=True, folded=folded), (offset, 0))
    return image


def build_sprites() -> dict[str, Image.Image]:
    """Return the sixteen furniture cells in manifest row-major order."""
    return {
        'furniture_classroom_desk_yellow_single': _desk(32),
        'furniture_classroom_desk_yellow_double': _desk(64),
        'furniture_classroom_desk_yellow_triple': _desk(94),
        'furniture_classroom_desk_yellow_double_back': _desk(64, back=True),
        'furniture_lecture_chair_blue_down_front': _chair(front=True, folded=False),
        'furniture_lecture_chair_blue_folded_front': _chair(front=True, folded=True),
        'furniture_lecture_chair_blue_down_back': _chair(front=False, folded=False),
        'furniture_lecture_chair_blue_folded_back': _chair(front=False, folded=True),
        'furniture_lecture_chair_blue_down_left': _chair_side(left=True, folded=False),
        'furniture_lecture_chair_blue_folded_left': _chair_side(left=True, folded=True),
        'furniture_lecture_chair_blue_down_right': _chair_side(left=False, folded=False),
        'furniture_lecture_chair_blue_folded_right': _chair_side(left=False, folded=True),
        'furniture_classroom_lectern_multimedia': _lectern_multimedia(),
        'furniture_classroom_lectern_wood': _lectern_wood(),
        'furniture_classroom_podium_tile': _podium(),
        'furniture_lecture_chair_blue_row_triple': _chair_row(),
    }
