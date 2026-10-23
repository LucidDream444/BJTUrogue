"""Three opaque orthographic classroom compositions from the campus photos."""
from __future__ import annotations

from PIL import Image, ImageDraw

from .drawing import P
from .scene_common import doorway, floor_glint, room, stamp, warm_window_light


def _stage(image):
    d = ImageDraw.Draw(image)
    d.rectangle((207, 136, 584, 166), fill=P['tile'])
    d.line((208, 137, 583, 137), fill=P['tile_light'])
    for x in range(239, 584, 48):
        d.line((x, 138, x, 164), fill=P['grout'])
    d.line((208, 152, 583, 152), fill='#AFB1A2')
    d.rectangle((207, 165, 584, 168), fill=P['steel_dark'])
    d.line((208, 165, 583, 165), fill=P['steel_light'])
    d.rectangle((208, 169, 583, 174), fill=P['tile_shadow'])
    d.line((208, 174, 583, 174), fill='#8F978A')


def _teaching_wall(image, sprites, lecture=False):
    # These remain parallel north-wall faces in the fixed front camera.
    for x, key in ((72, 'prop_classroom_door_wood_closed'),
                   (690, 'prop_classroom_door_wood_open_right')):
        doorway(image, x, 135)
        stamp(image, sprites, key, x, 135)
    stamp(image, sprites, 'prop_classroom_window_wide', 151, 130)
    stamp(image, sprites,
          'prop_classroom_curtain_blue_closed' if lecture else 'prop_classroom_curtain_blue_parted',
          151, 130)
    stamp(image, sprites, 'prop_classroom_chalkboard_green', 293, 126, scale=2)
    stamp(image, sprites, 'prop_classroom_projection_screen_down', 490, 145, scale=2)
    stamp(image, sprites, 'prop_classroom_clock_round', 608, 65)
    stamp(image, sprites, 'prop_classroom_speaker_wall', 643, 113)
    stamp(image, sprites, 'prop_classroom_switch_socket_cluster', 650, 130)
    _stage(image)
    stamp(image, sprites, 'furniture_classroom_lectern_multimedia', 239, 164,
          shadow=True, shadow_width=50)
    stamp(image, sprites, 'furniture_classroom_lectern_wood', 547, 166,
          shadow=True, shadow_width=44)


def _desk_rows(image, sprites, lecture=False):
    # Three long desk banks separated by the two conspicuous straight aisles.
    desk_banks = [
        ('furniture_classroom_desk_yellow_double', 102, (86, 118)),
        ('furniture_classroom_desk_yellow_double', 166, (150, 182)),
        ('furniture_classroom_desk_yellow_triple', 335, (304, 335, 366)),
        ('furniture_classroom_desk_yellow_triple', 429, (398, 429, 460)),
        ('furniture_classroom_desk_yellow_double', 602, (586, 618)),
        ('furniture_classroom_desk_yellow_double', 666, (650, 682)),
    ]
    for row, ground in enumerate((195, 252, 309, 366)):
        for key, x, _ in desk_banks:
            stamp(image, sprites, key, x, ground, shadow=True,
                  shadow_width=82 if 'triple' in key else 58)
        for bank, (_, _, seats) in enumerate(desk_banks):
            for seat, x in enumerate(seats):
                # Rear blue back panels face the viewer; pans are behind them.
                lowered = (row + bank + seat) % 4 == 0
                key = 'furniture_lecture_chair_blue_' + ('down_back' if lowered else 'folded_back')
                stamp(image, sprites, key, x, ground + 26, shadow=True,
                      shadow_width=22)


def _flat(sprites, tiles):
    image = room(tiles['tile_classroom_ceramic_clean'],
                 tiles['tile_wall_plaster_warm'])
    # Small isolated light reflections belong to the scene, not the floor tile.
    for x, y, w in ((243, 224, 11), (519, 282, 13), (243, 337, 12),
                    (518, 395, 15), (58, 296, 8), (710, 351, 8)):
        floor_glint(image, x, y, w)
    _teaching_wall(image, sprites)
    stamp(image, sprites, 'prop_classroom_ac_floor', 716, 192, shadow=True)
    stamp(image, sprites, 'prop_classroom_radiator_castiron', 151, 163)
    _desk_rows(image, sprites)
    return image


def _lecture(sprites, tiles):
    image = room(tiles['tile_lecture_concrete_base'],
                 tiles['tile_wall_plaster_warm'])
    # Sparse offset worn patches: never a repeated large three-mark stamp.
    scuff = tiles['tile_lecture_concrete_scuffed'].resize((64, 32), Image.Resampling.NEAREST)
    image.alpha_composite(scuff.crop((7, 6, 43, 24)), (228, 265))
    image.alpha_composite(scuff.crop((27, 16, 62, 30)), (505, 323))
    image.alpha_composite(scuff.crop((5, 19, 41, 31)), (360, 393))
    d = ImageDraw.Draw(image)
    # Rising rear tiers have straight exposed risers, not perspective wedges.
    for y in (234, 291, 348):
        d.rectangle((32, y, 735, y + 5), fill='#636D63')
        d.line((32, y, 735, y), fill='#A0A598')
        d.line((32, y + 5, 735, y + 5), fill='#59645C')
        for x0, x1 in ((211, 275), (491, 557)):
            d.rectangle((x0, y + 1, x1, y + 4), fill='#7A8276')
            d.line((x0, y + 2, x1, y + 2), fill='#A4A99B')
    _teaching_wall(image, sprites, lecture=True)
    stamp(image, sprites, 'prop_classroom_radiator_castiron', 151, 163)
    _desk_rows(image, sprites, lecture=True)
    # A side-edge rail and the round structural column distinguish this hall.
    for y in (271, 350, 405):
        stamp(image, sprites, 'prop_classroom_railing_stainless_vertical',
              46, y)
    stamp(image, sprites, 'prop_classroom_pillar_round_plaster', 54, 207,
          shadow=True, shadow_width=37)
    return image


def _warm(sprites, tiles):
    # The full-height 2x windows need a taller cutaway wall than the wide views.
    image = room(tiles['tile_classroom_ceramic_clean'],
                 tiles['tile_wall_plaster_warm'], wall_bottom=200)
    for i, x in enumerate((125, 298, 471, 644)):
        stamp(image, sprites, 'prop_classroom_window_wide', x, 196, scale=2)
        curtain = 'prop_classroom_curtain_blue_closed' if i == 1 else 'prop_classroom_curtain_blue_parted'
        stamp(image, sprites, curtain, x, 196, scale=2)
    d = ImageDraw.Draw(image)
    # Continuous dark stone windowsill with old pale plaster directly below.
    d.rectangle((35, 195, 732, 201), fill='#73786C')
    d.line((36, 195, 731, 195), fill='#B6B9AC')
    d.rectangle((35, 202, 732, 209), fill=P['wall_shadow'])
    d.line((36, 203, 731, 203), fill=P['wall'])
    for x in (266, 500):
        stamp(image, sprites, 'prop_classroom_radiator_castiron', x, 242,
              shadow=True, shadow_width=62)
    # An end-wall air conditioner stays in the free right-hand perimeter.
    stamp(image, sprites, 'prop_classroom_ac_floor', 713, 260, shadow=True)
    for x, y, w in ((270, 302, 17), (495, 356, 16), (268, 395, 12), (720, 381, 8)):
        floor_glint(image, x, y, w)
    for row, ground in enumerate((238, 350)):
        for x in (155, 384, 613):
            stamp(image, sprites, 'furniture_classroom_desk_yellow_double',
                  x, ground, scale=2, shadow=True, shadow_width=59)
        for bank, x in enumerate((155, 384, 613)):
            for seat, cx in enumerate((x - 32, x + 32)):
                lowered = (row + bank + seat) % 3 == 1
                key = 'furniture_lecture_chair_blue_' + ('down_back' if lowered else 'folded_back')
                stamp(image, sprites, key, cx, ground + 44, scale=2,
                      shadow=True, shadow_width=23)
    warm_window_light(image)
    return image


def build_scenes(sprites, tiles) -> dict[str, Image.Image]:
    """Return three native 768x432 opaque scene references, without UI."""
    return {
        'classroom_flat_neutral': _flat(sprites, tiles),
        'lecture_hall_neutral': _lecture(sprites, tiles),
        'classroom_window_warm': _warm(sprites, tiles),
    }
