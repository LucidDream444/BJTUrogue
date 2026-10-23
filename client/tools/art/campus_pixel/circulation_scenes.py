"""Three complete mundane campus circulation scenes at native 768 x 432.

These are source compositions, not game runtime layouts. The floor axes remain
parallel and the southern wall is cut away for the project's top-down camera.
"""
from __future__ import annotations

from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageOps

from .drawing import P, tint, tube
from .scene_common import doorway, fill_texture, floor_glint, room, stamp


def _quiet_reflection(image, sprite, x, y, height=30, strength=24):
    """Reflect a compressed, crisp silhouette without painting a floor shadow."""
    box = sprite.getbbox()
    if box is None:
        return
    crop = sprite.crop(box)
    reflected = ImageOps.flip(crop).resize((crop.width, height), Image.Resampling.NEAREST)
    alpha = reflected.getchannel('A')
    values = []
    for row in range(height):
        fade = max(0, strength * (height - row) // height)
        for col in range(reflected.width):
            values.append(fade if alpha.getpixel((col, row)) else 0)
    alpha.putdata(values)
    reflected.putalpha(alpha)
    image.alpha_composite(reflected, (x + box[0] - 64, y))


def _threshold(d, x, y, width=36):
    d.rectangle((x - width // 2, y - 1, x + width // 2, y + 3), fill=P['silver_shadow'])
    d.line((x - width // 2, y, x + width // 2, y), fill=P['silver'])
    d.line((x - width // 2 + 1, y + 1, x + width // 2 - 1, y + 1), fill=P['silver_light'])
    for bolt_x in (x - width // 2 + 4, x + width // 2 - 4):
        d.point((bolt_x, y + 2), fill=P['steel_light'])


def _heating_pipe(d, x0, x1, y):
    d.line((x0, y, x1, y), fill='#677369', width=3)
    d.line((x0, y - 1, x1, y - 1), fill='#AFB5A8')
    for x in (x0, x1):
        d.rectangle((x - 1, y - 2, x + 1, y + 2), fill='#818F81')
        d.point((x - 1, y - 2), fill='#C4C8B9')


def _corridor(sprites, tiles):
    image = room(tiles['tile_corridor_ceramic_neutral'], tiles['tile_wall_plaster_cool'], wall_bottom=138)
    d = ImageDraw.Draw(image)
    # Light soffit / electrical conduit and dark skirting are separate. There
    # is no invented ornamental wall panel or roof covering the play area.
    d.rectangle((32, 21, 735, 27), fill='#DEDED3')
    d.line((32, 27, 735, 27), fill='#B4BBB0')
    d.line((38, 34, 730, 34), fill='#B5BBB0')
    d.line((39, 33, 729, 33), fill='#E4E5D9')

    for x in (100, 475):
        doorway(image, x, 138, width=36, height=76)
        stamp(image, sprites, 'prop_classroom_door_wood_closed', x, 138)
        _threshold(d, x, 139)
    doorway(image, 290, 138, width=36, height=76)
    stamp(image, sprites, 'prop_classroom_door_wood_open_left', 290, 138)
    _threshold(d, 290, 139)
    stamp(image, sprites, 'prop_corridor_door_fire_double_gray', 675, 138)
    _threshold(d, 675, 139, width=72)

    # Old cast-iron heating is visibly plumbed along the wall, stopping before
    # each doorway rather than running across the opening.
    _heating_pipe(d, 143, 227, 126)
    _heating_pipe(d, 143, 226, 134)
    d.line((148, 125, 148, 135), fill='#8C9788', width=2)
    stamp(image, sprites, 'prop_classroom_radiator_castiron', 187, 136)
    _heating_pipe(d, 528, 612, 126)
    _heating_pipe(d, 528, 612, 134)
    stamp(image, sprites, 'prop_classroom_radiator_castiron', 570, 136)
    d.rectangle((605, 122, 610, 124), fill=P['red'])
    d.point((607, 121), fill=P['red_light'])

    for x in (351, 539):
        stamp(image, sprites, 'prop_classroom_switch_socket_cluster', x, 103)
    stamp(image, sprites, 'prop_corridor_exit_sign_green', 675, 46)
    stamp(image, sprites, 'prop_corridor_camera_dome', 617, 35, anchor=(64, 64))
    stamp(image, sprites, 'prop_corridor_camera_dome', 358, 35, anchor=(64, 64))

    # The omitted ceiling is suggested by its reflected recessed lights. A
    # modest reflected door/radiator edge makes glazed ceramic read as glaze.
    for key, x in [('prop_classroom_door_wood_closed', 100),
                   ('prop_classroom_door_wood_open_left', 290),
                   ('prop_classroom_door_wood_closed', 475),
                   ('prop_corridor_door_fire_double_gray', 675)]:
        _quiet_reflection(image, sprites[key], x, 144, height=34, strength=20)
    _quiet_reflection(image, sprites['prop_classroom_radiator_castiron'], 187, 143, height=18, strength=16)
    _quiet_reflection(image, sprites['prop_classroom_radiator_castiron'], 570, 143, height=18, strength=16)
    for x, y, w in [(105, 222, 8), (290, 229, 9), (474, 222, 8), (671, 232, 8),
                    (190, 335, 6), (384, 341, 8), (570, 337, 6)]:
        floor_glint(image, x, y, w)
    d = ImageDraw.Draw(image)
    # Quiet rubbed glaze and a silver expansion strip from the corridor photos.
    d.line((34, 385, 734, 385), fill='#969F92')
    d.rectangle((34, 386, 734, 389), fill='#BFC3B6')
    d.line((34, 386, 734, 386), fill='#D5D7C8')
    for x in (45, 727):
        d.point((x, 388), fill='#828F82')
    d.line((34, 411, 734, 411), fill='#DADED0')
    return image


def _long_rail(d, x, top_y=210, bottom_y=398):
    """A straight north/south guardrail with thin chrome bars and floor feet."""
    for xx, color in [(x, P['silver_shadow']), (x + 2, P['silver']),
                       (x + 4, P['silver_shadow'])]:
        d.line((xx, top_y - 10, xx, bottom_y - 2), fill=color)
    for ground in (top_y + 12, top_y + 57, top_y + 102, top_y + 147, bottom_y):
        d.ellipse((x - 3, ground - 2, x + 4, ground), fill='#7E8B80')
        d.line((x - 2, ground - 2, x + 3, ground - 2), fill='#CBD1C1')
        d.line((x + 1, ground - 27, x + 1, ground - 2), fill=P['silver_shadow'], width=3)
        d.line((x, ground - 27, x, ground - 2), fill=P['silver_light'])
        d.line((x - 4, ground - 28, x + 1, ground - 27), fill=P['silver_light'])
    tube(d, [(x - 4, top_y - 18), (x - 4, bottom_y - 28)], width=2)


def _landing_rail(d, x0, x1, base_y=211):
    for y in (base_y - 18, base_y - 11, base_y - 4):
        d.line((x0 + 2, y, x1 - 2, y), fill=P['silver_shadow'], width=2)
        d.line((x0 + 2, y, x1 - 2, y), fill=P['silver'])
    for x in (x0 + 3, (x0 + x1) // 2, x1 - 3):
        d.ellipse((x - 3, base_y - 2, x + 3, base_y), fill=P['silver_shadow'])
        d.line((x, base_y - 26, x, base_y - 2), fill=P['silver'], width=3)
        d.line((x - 1, base_y - 26, x - 1, base_y - 2), fill=P['silver_light'])
    tube(d, [(x0, base_y - 27), (x1, base_y - 27)], width=2)


def _wide_stair_flight(image, x0, x1, down=False):
    d = ImageDraw.Draw(image)
    d.rectangle((x0 - 5, 207, x1 + 5, 399), fill='#8C978C')
    # Twelve regular treads remain parallel, with subtle tile stagger and
    # four fine anti-slip incisions from the actual staircase photographs.
    for index in range(12):
        y = 210 + index * 15
        shift = -(11 - index) // 2 if down else -index // 4
        tread = tint(P['stair_light'], shift - (12 if down else 5))
        riser = tint(P['stair_shadow'], shift - (9 if down else 2))
        d.rectangle((x0, y, x1, y + 9), fill=tread)
        d.rectangle((x0, y + 10, x1, y + 14), fill=riser)
        d.line((x0, y, x1, y), fill=tint(P['stair_light'], shift + 3))
        for groove in (5, 7, 9):
            d.line((x0 + 1, y + groove, x1 - 1, y + groove), fill=tint('#929D93', shift))
        for seam_x in range(x0 + (52 if index % 2 else 64), x1 - 5, 70):
            d.line((seam_x, y + 1, seam_x, y + 9), fill=tint('#A4AFA3', shift))
            d.line((seam_x + 1, y + 1, seam_x + 1, y + 4), fill=tint(P['stair_light'], shift))
        if index in (2, 7, 10):
            d.line((x0 + 20, y + 3, x0 + 28, y + 3), fill=tint(P['stair'], shift + 9))
    d.line((x0, 390, x1, 390), fill=P['stair_light'])
    d.rectangle((x0, 391, x1, 398), fill='#AAB3A8')
    d.line((x0, 397, x1, 397), fill='#C8CFC1')
    _long_rail(d, x0 - 7)
    _long_rail(d, x1 + 6)


def _stairwell(sprites, tiles):
    image = room(tiles['tile_classroom_ceramic_clean'], tiles['tile_wall_brick_base'], wall_bottom=160)
    d = ImageDraw.Draw(image)
    # Broad glazed windows above the landing, with the red-brown brick and
    # white structural edges actually visible in the stairwell references.
    d.rectangle((32, 20, 735, 30), fill='#DADBD1')
    d.line((32, 31, 735, 31), fill='#B0B6AB')
    # The photos show localized chalky brick weathering, not the same wear
    # motif repeated across every tile of the complete north wall.
    rng = random.Random(541)
    for _ in range(60):
        x, y = rng.randrange(59, 131), rng.randrange(37, 151)
        if (x // 13 + y // 19) % 3:
            d.line((x, y, x + rng.randrange(2, 7), y), fill=rng.choice(['#BF977C', '#B98E72', '#C6A18A']))
    for x in (186, 384, 582):
        stamp(image, sprites, 'prop_classroom_window_wide', x, 145)
    d.rectangle((32, 32, 47, 159), fill=P['wall'])
    d.line((46, 34, 46, 156), fill=P['wall_shadow'])
    d.rectangle((720, 32, 735, 159), fill=P['wall_shadow'])
    d.line((721, 33, 721, 155), fill=P['wall_light'])
    if sprites.get('prop_stairwell_floor_marker_6') is not None:
        stamp(image, sprites, 'prop_stairwell_floor_marker_6', 82, 129)
    # An upper landing connects both flights; do not fill the floor with a
    # featureless black shaft or a photographic perspective funnel.
    fill_texture(image, tiles['tile_classroom_ceramic_clean'], (50, 162, 719, 207), floor=True)
    d.line((51, 163, 718, 163), fill='#EBEBDD')
    d.rectangle((322, 210, 444, 399), fill='#737F77')
    d.rectangle((328, 215, 438, 389), fill='#8A958B')
    d.rectangle((329, 218, 338, 388), fill='#C0C5B9')
    d.line((339, 220, 339, 385), fill='#65756A')
    d.rectangle((430, 218, 437, 388), fill='#B4BDB0')
    d.line((429, 220, 429, 385), fill='#6A796F')
    d.rectangle((340, 230, 428, 291), fill='#A1ABA0')
    d.line((340, 230, 428, 230), fill='#BEC4B7')
    d.line((341, 291, 427, 291), fill='#7C8B7E')
    d.rectangle((340, 292, 428, 299), fill='#C0C8BA')
    fill_texture(image, tiles['tile_corridor_ceramic_neutral'], (341, 360, 428, 389), floor=True)
    # Painted lower shaft wall with quiet marks and a neutral cross beam.
    d.rectangle((340, 300, 428, 359), fill='#8C998C')
    d.line((352, 305, 354, 346), fill='#98A291')
    d.line((412, 311, 413, 351), fill='#809180')
    d.line((341, 358, 427, 358), fill='#737F70')
    d.rectangle((320, 207, 326, 400), fill='#D7D9CC')
    d.rectangle((440, 207, 446, 400), fill='#C6CDBF')
    _wide_stair_flight(image, 79, 300, down=False)
    _wide_stair_flight(image, 461, 682, down=True)
    d = ImageDraw.Draw(image)
    _landing_rail(d, 327, 439, 210)
    # Small side ledges show the cut-away wall thickness and keep all useful
    # horizontal/vertical directions legible at nearest-neighbor scale.
    d.rectangle((50, 207, 66, 402), fill=P['wall'])
    d.line((65, 208, 65, 401), fill=P['wall_shadow'])
    d.rectangle((697, 207, 718, 402), fill='#C3CBBE')
    d.line((698, 208, 698, 401), fill=P['wall_light'])
    for x, y in ((147, 184), (382, 178), (628, 185), (111, 405), (654, 405)):
        floor_glint(image, x, y, 9)
    # White plaster bears real subtle scuffs rather than decorative ivy.
    for x, y in [(55, 264), (57, 314), (707, 351)]:
        d.line((x, y, x + 3, y + 1), fill='#ABB7A6')
    return image


def _glass_entry(image, x, base_y):
    d = ImageDraw.Draw(image)
    left, right, top = x - 35, x + 35, base_y - 108
    d.rectangle((left, top, right, base_y), fill='#313B36')
    d.rectangle((left + 4, top + 5, right - 4, base_y - 3), fill='#C2CCC1')
    d.rectangle((left + 5, top + 6, right - 5, top + 23), fill='#D6DFD2')
    d.rectangle((left + 5, top + 28, right - 5, base_y - 8), fill='#BAC8B9')
    # The shop interior is only pale shapes through glass, no invented logo or
    # menu. Narrow dark mullions and silver handle follow the reference entry.
    d.rectangle((left + 9, top + 50, left + 20, base_y - 16), fill='#D7DDCB')
    d.line((left + 14, top + 55, left + 14, base_y - 21), fill='#A8B9A4')
    d.rectangle((left + 29, top + 57, left + 46, base_y - 8), fill='#CFD5C3')
    d.line((left + 9, top + 29, left + 9, top + 46), fill='#E6EADB')
    d.rectangle((left + 28, top + 3, left + 31, base_y - 2), fill='#3F4D42')
    d.rectangle((left + 2, top + 24, right - 2, top + 27), fill='#3F4C40')
    # Full-height right-hinged leaf opened toward the viewer, inside the room.
    d.polygon([(right - 3, top + 4), (right + 18, top + 18),
               (right + 18, base_y + 5), (right - 3, base_y - 9)], fill='#354237')
    d.polygon([(right, top + 12), (right + 14, top + 22),
               (right + 14, base_y - 3), (right, base_y - 13)], fill='#B9C8B9')
    d.line((right + 1, top + 15, right + 13, top + 23), fill='#E2E8DA')
    d.line((right + 4, top + 55, right + 4, top + 76), fill=P['silver_shadow'], width=3)
    d.line((right + 3, top + 55, right + 3, top + 75), fill=P['silver_light'])
    _threshold(d, x, base_y + 1, width=70)


def _lobby(sprites, tiles):
    image = room(tiles['tile_lobby_stone_base'], tiles['tile_wall_brick_base'], wall_bottom=148)
    d = ImageDraw.Draw(image)
    d.rectangle((32, 20, 735, 27), fill='#BEC4B8')
    d.line((32, 28, 735, 28), fill='#6D7A6A')
    # Brick soldier course at the floor, seen both in the lobby and stairwell.
    d.rectangle((32, 133, 735, 147), fill='#8A4B35')
    for x in range(33, 735, 7):
        d.rectangle((x, 134, x + 5, 145), fill='#9A573E')
        d.line((x, 134, x, 145), fill='#AE9F87')
    d.line((32, 147, 735, 147), fill='#4D594C')
    stamp(image, sprites, 'prop_corridor_fire_cabinet_brick', 119, 145)
    # Two narrow frame edges make the brick cabinet read as inset, retaining
    # its matched red-brown door instead of a free-standing bright red box.
    d.line((96, 72, 96, 144), fill='#70533F')
    d.line((142, 72, 142, 144), fill='#C4B496')
    stamp(image, sprites, 'prop_stairwell_pipe_fire_red', 710, 146)
    d.line((712, 29, 712, 55), fill=P['red'], width=5)
    d.line((710, 29, 710, 55), fill=P['red_light'])
    stamp(image, sprites, 'prop_classroom_switch_socket_cluster', 533, 127)
    stamp(image, sprites, 'prop_corridor_camera_dome', 691, 38, anchor=(64, 64))
    _glass_entry(image, 640, 147)
    neon = sprites.get('prop_lobby_icecream_neon')
    if neon is not None:
        stamp(image, sprites, 'prop_lobby_icecream_neon', 365, 143)
        _quiet_reflection(image, neon, 365, 150, height=42, strength=21)
    # Glazed stone carries dim, hard-edged reflected ceiling spots and window
    # patches. Its natural grain stays visible through the reflection layers.
    reflection = Image.new('RGBA', image.size, (0, 0, 0, 0))
    r = ImageDraw.Draw(reflection)
    r.rectangle((604, 165, 666, 179), fill=(191, 210, 204, 19))
    r.rectangle((605, 188, 626, 237), fill=(174, 196, 192, 14))
    r.rectangle((637, 187, 663, 236), fill=(174, 196, 192, 14))
    r.rectangle((607, 246, 661, 253), fill=(174, 196, 192, 9))
    image.alpha_composite(reflection)
    d = ImageDraw.Draw(image)
    for x, y in ((167, 246), (371, 252), (575, 246), (259, 355), (475, 360)):
        d.rectangle((x - 6, y - 2, x + 6, y + 2), fill='#59665B')
        d.rectangle((x - 3, y - 1, x + 3, y + 1), fill='#A4B29F')
        d.line((x - 2, y, x + 2, y), fill='#DAE1CB')
    d.line((32, 411, 735, 411), fill='#84927F')
    d.line((32, 415, 735, 415), fill='#4C5C4C')
    return image


def build_scenes(sprites: dict[str, Image.Image], tiles: dict[str, Image.Image]) -> dict[str, Image.Image]:
    """Compose full opaque scenes; sprites and repeatable materials are inputs."""
    return {
        'corridor_neutral': _corridor(sprites, tiles),
        'stairwell_daylight': _stairwell(sprites, tiles),
        'brick_lobby_neutral': _lobby(sprites, tiles),
    }


def _save_review() -> Path:
    from .architecture import build_sprites as architecture
    from .fixtures import build_sprites as fixtures
    from .furniture import build_sprites as furniture
    from .extras import build_sprites as extras
    from .materials import build_tiles

    root = Path(__file__).resolve().parents[4]
    destination = root / 'output/campus_20261023/circulation_scene_review'
    destination.mkdir(parents=True, exist_ok=True)
    sprites = {**architecture(), **fixtures(), **furniture(), **extras()}
    for key, image in build_scenes(sprites, build_tiles()).items():
        image.save(destination / f'{key}.png')
    return destination


if __name__ == '__main__':
    print(_save_review())
