"""Native pixel architecture drawn from the classroom and corridor photographs.

Build-time Pillow source only. Each transparent sprite shares a 128 px cell and
the ground anchor (64, 108); visible pixels remain inside the 16 px safe margin.
"""
from __future__ import annotations

from pathlib import Path
import random

from PIL import Image, ImageDraw

from .drawing import ANCHOR, P, canvas, speckle, tint, tube


def _door_frame(image: Image.Image) -> ImageDraw.ImageDraw:
    d = ImageDraw.Draw(image)
    # The doorway itself is alpha: compositing never paints a black rectangle
    # over the room behind an open door.
    d.rectangle((41, 24, 86, 29), fill=P['brown_dark'])
    d.rectangle((42, 23, 85, 25), fill=P['brown_light'])
    d.line((43, 24, 84, 24), fill=tint(P['brown_light'], 12))
    d.rectangle((41, 28, 46, 107), fill=P['brown_dark'])
    d.rectangle((82, 28, 86, 107), fill=P['brown_dark'])
    d.line((43, 29, 43, 106), fill=P['brown_light'])
    d.line((84, 30, 84, 106), fill=tint(P['brown'], -5))
    d.rectangle((42, 106, 85, 108), fill=P['steel_dark'])
    d.line((45, 106, 82, 106), fill=P['silver_shadow'])
    return d


def _wood_door(open_side: str | None = None) -> Image.Image:
    image = canvas()
    d = _door_frame(image)
    if open_side is None:
        d.rectangle((47, 30, 81, 105), fill=P['brown'])
        d.rectangle((48, 31, 79, 103), fill='#5E4935')
        d.line((48, 31, 78, 31), fill=P['brown_light'])
        d.line((48, 33, 48, 102), fill='#70563B')
        d.line((79, 32, 79, 104), fill='#43392D')
        for x, y0, y1 in [(51, 63, 82), (56, 72, 98), (72, 60, 91), (76, 35, 65)]:
            d.line((x, y0, x, y1), fill='#594531')
        # Square glazed vision panel, not a painted pale full-door panel.
        d.rectangle((53, 40, 75, 59), fill=P['brown_dark'])
        d.rectangle((55, 42, 73, 57), fill='#C3C4B8')
        d.rectangle((56, 43, 72, 49), fill='#D6D7C9')
        d.rectangle((56, 51, 61, 56), fill='#ADB5AC')
        d.line((56, 43, 71, 43), fill='#E3E1D3')
        d.line((70, 46, 72, 46), fill='#E1E0D3')
        d.rectangle((73, 77, 75, 83), fill=P['silver_shadow'])
        d.line((74, 78, 79, 78), fill=P['silver_light'], width=2)
        d.line((75, 80, 79, 80), fill=P['silver_shadow'])
        d.point((74, 85), fill=P['steel_dark'])
        for y in (39, 73, 98):
            d.rectangle((46, y, 48, y + 3), fill='#85867A')
            d.point((47, y), fill=P['silver'])
    else:
        # Draw one physical hinged leaf and mirror the complete assembly for
        # its counterpart. The quadrilateral is a door swing, not a tile grid.
        d.polygon([(46, 30), (28, 43), (28, 108), (46, 96)], fill=P['brown_dark'])
        d.polygon([(44, 34), (30, 44), (30, 104), (44, 95)], fill='#594330')
        d.line((30, 44, 30, 103), fill=P['brown_light'])
        d.line((31, 44, 43, 35), fill='#8A6A46')
        d.line((43, 38, 43, 93), fill='#3D3329')
        d.polygon([(33, 50), (41, 44), (41, 59), (33, 65)], fill=P['brown_dark'])
        d.polygon([(34, 51), (40, 47), (40, 58), (34, 62)], fill='#C8CBBE')
        d.line((34, 52, 39, 48), fill='#E2E0D0')
        d.line((35, 73, 35, 91), fill='#67503A')
        d.rectangle((31, 77, 32, 82), fill=P['silver_shadow'])
        d.line((31, 78, 35, 76), fill=P['silver_light'], width=2)
        for y in (39, 71, 92):
            d.rectangle((44, y, 46, y + 3), fill=P['silver_shadow'])
            d.point((45, y), fill=P['silver'])
        if open_side == 'right':
            image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return image


def _fire_door() -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((24, 24, 103, 108), fill=P['silver_shadow'])
    d.rectangle((25, 24, 102, 27), fill='#C9CCC3')
    d.line((27, 25, 100, 25), fill=P['silver_light'])
    d.rectangle((25, 28, 28, 106), fill='#B9BFB6')
    d.rectangle((100, 28, 102, 107), fill='#7D8882')
    d.rectangle((29, 29, 56, 105), fill='#9EA79F')
    d.rectangle((58, 29, 99, 105), fill='#ACB2A8')
    d.line((30, 30, 55, 30), fill='#C7CDC2')
    d.line((59, 30, 98, 30), fill='#CFD1C7')
    d.line((30, 31, 30, 104), fill='#BAC1B6')
    d.line((59, 31, 59, 104), fill='#C2C8BB')
    d.line((57, 29, 57, 105), fill='#65746F')
    d.line((98, 31, 98, 104), fill='#919C93')
    d.rectangle((29, 102, 99, 105), fill='#8D9890')
    # Shallow rubbed patches on neutral painted steel, no white glare stripe.
    for line in [(35, 55, 35, 74), (37, 59, 37, 67), (88, 70, 88, 92)]:
        d.line(line, fill='#A9B1A5')
    d.rectangle((70, 58, 87, 65), fill=P['red'])
    d.line((72, 60, 84, 60), fill='#E1C4AE')
    d.line((72, 63, 82, 63), fill='#D2AB94')
    d.ellipse((63, 77, 66, 80), fill=P['silver_shadow'])
    d.point((64, 78), fill=P['silver_light'])
    d.rectangle((63, 84, 65, 89), fill=P['silver_shadow'])
    d.line((64, 85, 73, 85), fill=P['silver_light'], width=2)
    d.line((65, 87, 72, 87), fill=P['silver_shadow'])
    for y in (38, 70, 96):
        d.rectangle((98, y, 100, y + 4), fill=P['silver_shadow'])
        d.point((99, y), fill=P['silver'])
    d.line((25, 107, 102, 107), fill=P['steel_dark'])
    return image


def _window(wide: bool) -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    x0, x1 = (23, 104) if wide else (46, 81)
    d.rectangle((x0, 21, x1, 105), fill=P['brown_dark'])
    d.rectangle((x0 + 2, 23, x1 - 2, 103), fill=P['steel_light'])
    panes = [(27, 48), (53, 74), (79, 100)] if wide else [(50, 77)]
    for i, (a, b) in enumerate(panes):
        d.rectangle((a, 27, b, 61), fill='#C8D2CA')
        d.rectangle((a, 66, b, 100), fill='#DAD9C7')
        d.rectangle((a + 1, 28, b - 1, 38), fill='#DBE0D3')
        # Discreet distant building mass, based on the windows in the photos.
        # Glass remains pale and opaque; this is not a separate city backdrop.
        if wide:
            d.rectangle((a + 3, 40 + i * 2, b - 2, 60), fill='#C1C5B8')
            d.rectangle((a + 4, 42 + i * 2, b - 3, 58), fill='#CCC7B3')
            for y in range(45 + i * 2, 59, 6):
                for x in range(a + 5, b - 3, 6):
                    d.rectangle((x, y, x + 1, y + 2), fill='#AFB8AD')
            d.rectangle((a + 1, 88, b - 1, 99), fill='#CFD2BE')
            for x in range(a + 3, b - 1, 7):
                d.line((x, 91, x + 2, 88), fill='#C1C8B1')
        else:
            d.rectangle((a + 3, 45, b - 4, 60), fill='#CEC8B8')
            d.rectangle((a + 3, 89, b - 2, 99), fill='#C9CFBA')
        d.line((a + 2, 30, a + 2, 47), fill='#E5E7D9')
        d.line((a + 3, 70, a + 3, 82), fill='#EAE7D7')
        d.point((a + 4, 81), fill='#EAE7D7')
        d.line((a, 62, b, 62), fill='#777F73')
    for x in ([49, 75] if wide else []):
        d.rectangle((x, 25, x + 3, 102), fill=P['brown_dark'])
        d.line((x + 1, 26, x + 1, 101), fill='#55564B')
    d.rectangle((x0 + 2, 62, x1 - 2, 65), fill=P['brown_dark'])
    d.line((x0 + 3, 63, x1 - 3, 63), fill='#60685D')
    d.line((x0 + 1, 23, x0 + 1, 103), fill='#72776A')
    d.rectangle((x0 - 2, 105, x1 + 2, 108), fill='#6F7167')
    d.line((x0 - 1, 105, x1 + 1, 105), fill='#B7B7A9')
    # The metal latch sits on a mullion, never floats inside the glass.
    latch_x = 52 if wide else 47
    d.rectangle((latch_x, 73, latch_x + 2, 79), fill='#999D8F')
    d.point((latch_x + 1, 74), fill=P['silver_light'])
    return image


def _curtain(parted: bool) -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((20, 25, 107, 27), fill=P['silver_shadow'])
    d.line((20, 25, 107, 25), fill=P['silver'])
    panels = [(23, 104)] if not parted else [(23, 47), (80, 104)]
    tones = ['#2C3E51', '#3A5068', '#465E78', '#526B84', '#667E94', '#536C85', '#3A5068']
    for panel_index, (a, b) in enumerate(panels):
        # Stepped hem, repeated folds and irregular long seams express woven
        # curtains without an anti-aliased gradient or plastic-looking sheen.
        outline = [(a, 30), (b, 30), (b, 105), (b - 3, 107), (a + 3, 107), (a, 104)]
        d.polygon(outline, fill=P['curtain_shadow'])
        for x in range(a + 1, b):
            phase = (x - a) % 9
            tone = tones[min(phase, 6)]
            hem = 105 + (1 if phase in (1, 2, 3, 4) else 0)
            d.line((x, 32, x, hem), fill=tone)
            if phase in (2, 3):
                d.line((x, 47 + (x % 5), x, 91 - (x % 7)), fill='#607991')
            elif phase in (0, 8):
                d.line((x, 40, x, 100), fill='#30455C')
        for x in range(a + 3, b - 1, 9):
            d.rectangle((x, 28, x + 2, 31), fill=P['silver_shadow'])
            d.point((x, 28), fill=P['silver_light'])
            d.line((x, 101 + x % 3, min(x + 4, b - 1), 101 + x % 3), fill='#50677E')
        d.line((a + 1, 33, b - 1, 33), fill='#566D82')
        if parted:
            tie_y = 73
            # Quiet self-fabric tie, not a bright fantasy gold band.
            d.line((a + 3, tie_y, b - 3, tie_y + 1), fill='#61758A', width=2)
            outer = a + 1 if panel_index == 0 else b - 1
            d.line((outer, 77, outer, 102), fill='#34495E')
    return image


def _rail_post(d: ImageDraw.ImageDraw, x: int, ground: int, height: int = 31) -> None:
    d.ellipse((x - 4, ground - 2, x + 4, ground), fill=P['silver_shadow'])
    d.line((x - 2, ground - 2, x + 2, ground - 2), fill=P['silver_light'])
    d.line((x, ground - height, x, ground - 2), fill=P['silver_shadow'], width=4)
    d.line((x, ground - height, x, ground - 3), fill=P['silver'], width=2)
    d.line((x - 1, ground - height, x - 1, ground - 3), fill=P['silver_light'])


def _railing(kind: str) -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    if kind == 'horizontal':
        for y in (83, 91, 99):
            d.line((25, y, 102, y), fill=P['silver_shadow'], width=2)
            d.line((25, y, 102, y), fill=P['silver'])
        for x in (27, 64, 100):
            _rail_post(d, x, 108)
        tube(d, [(24, 75), (103, 75)], width=3)
    elif kind == 'vertical':
        # A north/south rail projects as parallel vertical bars with repeated
        # upright posts; the short offset is orthographic height, not taper.
        for x in (58, 62, 66):
            d.line((x, 35, x, 104), fill=P['silver_shadow'], width=2)
            d.line((x, 35, x, 104), fill=P['silver'])
        for ground in (55, 81, 108):
            _rail_post(d, 64, ground, height=27)
        tube(d, [(56, 27), (56, 82)], width=3)
        for y in (28, 54, 81):
            d.line((56, y, 64, y + 1), fill=P['silver_light'], width=2)
    else:
        # 90-degree plan corner: a foreground east/west panel meets a
        # north/south return at the right-hand post.
        for y in (84, 92, 100):
            d.line((26, y, 91, y), fill=P['silver_shadow'], width=2)
            d.line((26, y, 91, y), fill=P['silver'])
        for x in (86, 90, 94):
            d.line((x, 39, x, 101), fill=P['silver_shadow'], width=2)
            d.line((x, 39, x, 101), fill=P['silver'])
        for x in (28, 61, 94):
            _rail_post(d, x, 108)
        _rail_post(d, 94, 66, height=30)
        tube(d, [(25, 76), (86, 76), (86, 35)], width=3)
        d.line((86, 36, 94, 36), fill=P['silver_light'], width=2)
    return image


def _pillar() -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((42, 26, 85, 101), fill=P['wall_shadow'])
    d.ellipse((42, 93, 85, 108), fill='#969D95')
    d.ellipse((43, 91, 84, 105), fill=P['wall'])
    for x0, x1, color in [(43, 46, '#C4C6BB'), (47, 52, '#DDDED2'),
                           (53, 65, '#E5E4D8'), (66, 75, '#D7D8CD'),
                           (76, 81, '#C4C8BE'), (82, 84, '#B1B8AE')]:
        d.rectangle((x0, 27, x1, 97), fill=color)
    d.ellipse((42, 19, 85, 32), fill='#B6BDB2')
    d.ellipse((43, 19, 83, 29), fill=P['wall_light'])
    d.line((48, 21, 77, 21), fill='#F0EEE3')
    d.arc((44, 20, 83, 31), 0, 165, fill='#C5C9BF')
    for x, y in [(48, 87), (49, 90), (74, 79), (77, 80), (57, 93), (60, 94)]:
        d.line((x, y, x + 2, y), fill='#C2C6BA')
    d.rectangle((43, 99, 84, 102), fill='#A4ADA3')
    d.arc((43, 94, 84, 108), 0, 180, fill='#747F77')
    return image


def _stair_rail(d: ImageDraw.ImageDraw, x: int) -> None:
    for ground in (59, 83, 108):
        _rail_post(d, x, ground, height=27)
    for dx in (-1, 1):
        d.line((x + dx, 43, x + dx, 100), fill=P['silver_shadow'])
    tube(d, [(x - 3, 29), (x - 3, 81)], width=2)
    for y in (32, 56, 81):
        d.line((x - 3, y, x, y + 1), fill=P['silver_light'])


def _stairs(down: bool) -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((29, 39, 98, 108), fill=P['concrete_shadow'])
    for index in range(6):
        y = 40 + index * 11
        amount = -index * 2 if not down else -(5 - index) * 6
        tread = tint(P['stair_light'], amount - 4)
        riser = tint(P['stair_shadow'], amount - 3)
        d.rectangle((30, y, 97, y + 7), fill=tread)
        d.rectangle((30, y + 8, 97, y + 10), fill=riser)
        d.line((30, y, 97, y), fill=tint(P['stair_light'], amount + 8))
        d.line((31, y + 5, 96, y + 5), fill=tint(P['grout'], amount - 3))
        d.line((31, y + 7, 96, y + 7), fill=tint(P['stair_shadow'], amount - 4))
        seam = 64 if index % 2 == 0 else 67
        d.line((seam, y + 1, seam, y + 7), fill=tint(P['grout'], amount + 7))
        d.line((seam + 1, y + 1, seam + 1, y + 4), fill=tint(P['stair_light'], amount))
        if index in (1, 4):
            d.line((41, y + 3, 45, y + 3), fill=tint(P['stair'], amount + 5))
    if down:
        # Closest threshold establishes the drop; darker northern treads recede
        # into the stairwell. No label or directional arrow is baked in.
        d.rectangle((29, 105, 98, 108), fill=P['steel_light'])
        d.line((30, 105, 97, 105), fill=P['stair_light'])
        d.line((31, 107, 96, 107), fill=P['silver_shadow'])
    else:
        d.line((30, 107, 97, 107), fill=P['stair_shadow'])
        d.line((30, 108, 97, 108), fill=P['concrete_shadow'])
    _stair_rail(d, 24)
    _stair_rail(d, 104)
    return image


def _wall(brick: bool) -> Image.Image:
    image = canvas()
    d = ImageDraw.Draw(image)
    if not brick:
        d.rectangle((17, 43, 110, 108), fill=P['wall_shadow'])
        d.rectangle((18, 42, 109, 47), fill=P['wall_light'])
        d.line((19, 43, 108, 43), fill='#F1EFE3')
        d.rectangle((18, 48, 109, 99), fill=P['wall'])
        d.line((19, 49, 108, 49), fill='#DEDCD0')
        d.rectangle((18, 100, 109, 107), fill=P['steel_dark'])
        d.line((18, 100, 109, 100), fill='#585F58')
        d.line((19, 102, 108, 102), fill='#303933')
        d.line((18, 108, 109, 108), fill='#465149')
        speckle(image, (23, 75, 105, 98), ['#C6C9BC', '#CDCEC1', '#DFDDD0'], seed=907, density=.02)
        for x, y in [(31, 95), (69, 88), (93, 96)]:
            d.line((x, y, x + 3, y - 1), fill='#BFC5B8')
        d.line((109, 49, 109, 99), fill='#B9BFB3')
    else:
        d.rectangle((17, 43, 110, 108), fill=P['mortar'])
        rng = random.Random(318)
        colors = ['#A96149', '#AB654E', '#A15B44', '#B16B52', '#A45D46']
        for row, y in enumerate(range(45, 105, 7)):
            for x in range(8 if row % 2 else 17, 111, 19):
                a, b = max(18, x), min(109, x + 17)
                if b <= a:
                    continue
                color = rng.choice(colors)
                d.rectangle((a, y, b, min(y + 5, 106)), fill=color)
                d.line((a, y, b, y), fill=tint(color, 10))
                d.line((a, y + 5, b, y + 5), fill=tint(color, -11))
                if b - a > 10 and row % 3 == 1:
                    d.line((a + 3, y + 3, a + 7, y + 3), fill=tint(color, 8))
        # A shallow upright soldier course and subtle chalky weathering match
        # the stairwell brick photos without turning wear into random graffiti.
        d.rectangle((18, 102, 109, 108), fill=P['brick_shadow'])
        for x in range(18, 110, 6):
            d.rectangle((x, 103, min(109, x + 4), 107), fill='#95553E')
            d.line((x, 103, x, 107), fill='#B2A08B')
        for row in (0, 1, 2, 4):
            y = 47 + row * 7
            d.line((23, y, 29 + row * 2, y), fill='#C49B7E')
            d.line((35, y + 1, 40, y + 1), fill='#BD9478')
        d.rectangle((17, 41, 110, 43), fill='#A47D64')
        d.line((18, 41, 109, 41), fill='#D0B297')
    return image


def build_sprites() -> dict[str, Image.Image]:
    """Return exactly the architecture cells declared in components.json."""
    return {
        'prop_classroom_door_wood_closed': _wood_door(),
        'prop_classroom_door_wood_open_left': _wood_door('left'),
        'prop_classroom_door_wood_open_right': _wood_door('right'),
        'prop_corridor_door_fire_double_gray': _fire_door(),
        'prop_classroom_window_wide': _window(True),
        'prop_classroom_window_narrow': _window(False),
        'prop_classroom_curtain_blue_closed': _curtain(False),
        'prop_classroom_curtain_blue_parted': _curtain(True),
        'prop_classroom_railing_stainless_horizontal': _railing('horizontal'),
        'prop_classroom_railing_stainless_vertical': _railing('vertical'),
        'prop_classroom_railing_stainless_corner': _railing('corner'),
        'prop_classroom_pillar_round_plaster': _pillar(),
        'prop_stairwell_stairs_up': _stairs(False),
        'prop_stairwell_stairs_down': _stairs(True),
        'prop_corridor_wall_plaster': _wall(False),
        'prop_stairwell_wall_red_brick': _wall(True),
    }


def _save_review() -> Path:
    root = Path(__file__).resolve().parents[4]
    destination = root / 'output/campus_20261023/architecture_review.png'
    destination.parent.mkdir(parents=True, exist_ok=True)
    sprites = build_sprites()
    sheet = Image.new('RGBA', (512, 512), '#647169')
    d = ImageDraw.Draw(sheet)
    for index, (name, sprite) in enumerate(sprites.items()):
        x, y = (index % 4) * 128, (index // 4) * 128
        d.rectangle((x + 1, y + 1, x + 126, y + 126), fill='#5B665F')
        sheet.alpha_composite(sprite, (x, y))
        d.text((x + 5, y + 114), name.removeprefix('prop_')[:20], fill='#E7EADB')
    sheet.resize((1024, 1024), Image.Resampling.NEAREST).save(destination)
    return destination


if __name__ == '__main__':
    print(_save_review())
