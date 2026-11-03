"""Campus fixtures drawn deliberately at a 128-pixel native resolution.

The source photographs inform construction and intrinsic material colors.
All edges are whole pixels and all alpha values are either zero or 255.
Wall/floor fixtures use (64, 108); ceiling equipment uses (64, 64).
"""
from __future__ import annotations

import math

from PIL import Image, ImageDraw

from .drawing import P, canvas, speckle


def _chalkboard():
    image = canvas()
    d = ImageDraw.Draw(image)
    # The slim warm metal surround and stacked sliding panels follow photo 3.
    d.rectangle((19, 57, 109, 105), fill='#655D49')
    d.rectangle((20, 58, 108, 104), fill='#A49B78')
    d.line((20, 58, 107, 58), fill='#D2C8A4')
    d.line((20, 59, 20, 103), fill='#C5BD9D')
    d.rectangle((23, 61, 105, 100), fill=P['chalk_dark'])
    d.rectangle((24, 62, 104, 79), fill=P['chalkboard'])
    d.rectangle((24, 84, 104, 100), fill='#27473E')
    d.line((24, 62, 104, 62), fill='#3A5A4B')
    d.line((24, 84, 104, 84), fill='#355548')
    speckle(image, (25, 64, 103, 99), ['#2C5044', '#305345', '#294A40'], seed=303, density=.024)
    # Erased chalk forms short broken clusters, rather than a written label.
    d.line((33, 69, 45, 69), fill='#476759')
    d.line((37, 70, 48, 70), fill='#3B5A4C')
    d.line((72, 91, 91, 91), fill='#456457')
    d.line((75, 92, 86, 92), fill='#3B594D')
    d.line((31, 72, 35, 68, 39, 72), fill='#A5B5A1')
    d.line((33, 71, 37, 71), fill='#A5B5A1')
    d.line((43, 70, 48, 70), fill='#8FA793')
    d.line((43, 72, 48, 72), fill='#8FA793')
    d.line((52, 68, 55, 70, 52, 72), fill='#8FA793')
    d.line((76, 95, 84, 95), fill='#758D7D')
    d.rectangle((22, 80, 106, 83), fill='#7D775B')
    d.line((23, 80, 105, 80), fill='#B6AA82')
    d.line((23, 83, 105, 83), fill='#454C3F')
    d.rectangle((20, 103, 109, 105), fill='#A99C78')
    d.rectangle((18, 106, 110, 107), fill='#716E59')
    d.line((19, 106, 110, 106), fill='#D1C7A5')
    d.line((21, 108, 108, 108), fill='#4C4F45')
    d.rectangle((88, 102, 96, 104), fill='#363C35')
    d.line((89, 102, 95, 102), fill='#A9AD9B')
    d.line((29, 104, 33, 104), fill='#E0DFCC')
    d.line((36, 104, 40, 104), fill='#D6C8A3')
    return image


def _screen():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((19, 46, 109, 50), fill=P['steel_dark'])
    d.line((20, 46, 108, 46), fill=P['silver'])
    d.line((21, 47, 107, 47), fill='#D3D4C9')
    d.rectangle((21, 51, 107, 105), fill='#444B48')
    d.rectangle((23, 51, 105, 104), fill='#E0E0D4')
    d.rectangle((25, 52, 103, 102), fill='#E9E9DC')
    d.line((25, 52, 103, 52), fill='#F2F1E5')
    d.line((24, 53, 24, 102), fill='#D5D7CD')
    d.line((104, 52, 104, 103), fill='#CACFC6')
    d.line((25, 103, 103, 103), fill='#D1D4CA')
    d.rectangle((20, 106, 108, 107), fill='#535B58')
    d.line((22, 106, 106, 106), fill='#B3BAB0')
    d.line((62, 108, 66, 108), fill='#737C76')
    return image


def _radiator():
    image = canvas()
    d = ImageDraw.Draw(image)
    # Two compact connectors and feet; no wall or floor is baked into the prop.
    d.rectangle((34, 79, 92, 82), fill='#5B5C51')
    d.line((34, 79, 91, 79), fill='#B2AC92')
    d.rectangle((33, 97, 93, 100), fill='#615E50')
    for x in (42, 82):
        d.rectangle((x, 101, x + 3, 107), fill='#57574D')
        d.line((x, 102, x, 106), fill='#A8A18A')
        d.rectangle((x - 1, 107, x + 4, 108), fill='#55564E')
    for index, x in enumerate(range(39, 88, 4)):
        d.rectangle((x, 74, x + 2, 102), fill='#625F52')
        d.rectangle((x, 73, x + 1, 100), fill='#8E8974')
        d.line((x, 75, x, 98), fill='#B4AB90')
        d.line((x + 2, 77, x + 2, 100), fill='#4E514A')
        d.point((x + 1, 72), fill='#AAA38A')
        d.point((x + 1, 102), fill='#74735F')
        if index % 3 == 0:
            d.point((x + 1, 91), fill='#746B54')
            d.point((x, 95), fill='#6B6550')
    d.rectangle((30, 80, 37, 83), fill='#747363')
    d.line((30, 80, 37, 80), fill='#B9AF91')
    d.rectangle((29, 78, 31, 86), fill='#8B826D')
    d.rectangle((28, 78, 32, 79), fill='#B2A489')
    d.rectangle((91, 95, 96, 98), fill='#777563')
    d.line((91, 95, 96, 95), fill='#AEA78E')
    d.rectangle((95, 91, 98, 97), fill='#8C826A')
    d.line((95, 91, 97, 91), fill='#B4AA8B')
    return image


def _floor_ac():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((51, 28, 76, 106), fill='#8B928A')
    d.rectangle((52, 29, 73, 105), fill=P['cream'])
    d.rectangle((74, 31, 76, 105), fill='#B0B5A9')
    d.line((52, 29, 72, 29), fill=P['white'])
    d.line((52, 30, 52, 104), fill='#F0EEE1')
    d.line((73, 31, 73, 104), fill='#BEC3B6')
    d.rectangle((55, 34, 71, 49), fill='#5E6863')
    for y in range(35, 49, 3):
        d.line((55, y, 71, y), fill='#B4BAAD')
        d.line((56, y + 1, 70, y + 1), fill='#414E4C')
    d.rectangle((57, 57, 68, 62), fill='#A9B3A8')
    d.rectangle((59, 58, 66, 60), fill='#536A61')
    d.line((60, 59, 63, 59), fill='#B5C9AA')
    d.point((68, 65), fill='#7D9E7C')
    d.line((54, 71, 72, 71), fill='#C1C4B7')
    d.line((54, 72, 72, 72), fill='#EAE9DC')
    d.rectangle((56, 77, 65, 99), fill='#ADB3A6')
    for x in range(57, 66, 2):
        d.line((x, 78, x, 98), fill='#66736E')
        d.line((x, 78, x, 80), fill='#9EA99A')
    d.line((53, 103, 72, 103), fill='#C0C5B6')
    d.rectangle((51, 106, 76, 108), fill='#737E74')
    d.line((53, 106, 72, 106), fill='#C4C9BC')
    return image


def _clock():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.ellipse((51, 83, 77, 108), fill='#596361')
    d.ellipse((51, 82, 76, 107), fill='#ADB7AF')
    d.ellipse((52, 83, 75, 106), fill='#E0E2D5')
    d.ellipse((54, 85, 73, 104), fill='#818B83')
    d.ellipse((55, 86, 72, 103), fill='#EBEBDA')
    cx, cy = 64, 95
    for hour in range(12):
        angle = math.pi * hour / 6 - math.pi / 2
        outer = (round(cx + 8 * math.cos(angle)), round(cy + 8 * math.sin(angle)))
        inner = (round(cx + 6.5 * math.cos(angle)), round(cy + 6.5 * math.sin(angle)))
        d.line((inner, outer), fill='#4F5B52')
    d.line((64, 95, 60, 92), fill='#3D4A43', width=2)
    d.line((64, 95, 69, 91), fill='#3D4A43')
    d.point((64, 95), fill='#7E877A')
    d.line((55, 85, 59, 84), fill='#F5F2DF')
    return image


def _fluorescent():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((32, 57, 96, 70), fill='#646F6A')
    d.rectangle((33, 57, 95, 68), fill='#C3CAC0')
    d.line((33, 57, 95, 57), fill=P['white'])
    d.line((33, 58, 33, 68), fill='#E4E7DA')
    d.rectangle((36, 59, 92, 66), fill='#8E9C91')
    d.line((36, 60, 92, 60), fill='#FFFFE7')
    d.line((36, 64, 92, 64), fill='#F2F5D9')
    d.line((36, 65, 92, 65), fill='#DCE5CE')
    for x in range(36, 93, 7):
        d.line((x, 59, x + 2, 66), fill='#69786F')
        d.line((x + 1, 59, x + 3, 66), fill='#D7DED1')
    d.line((34, 68, 94, 68), fill='#E2E6D6')
    d.line((34, 69, 95, 69), fill='#89988D')
    return image


def _downlight():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.ellipse((55, 57, 73, 72), fill='#68756D')
    d.ellipse((55, 55, 73, 70), fill='#BEC7BB')
    d.ellipse((56, 56, 72, 69), fill='#EAECDB')
    d.ellipse((58, 58, 70, 67), fill='#9BA691')
    d.ellipse((59, 58, 69, 66), fill='#F2F1D4')
    d.ellipse((60, 59, 68, 64), fill='#FFFBE0')
    d.line((59, 57, 65, 56), fill='#F8F7E7')
    return image


def _speaker():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((60, 65, 70, 108), fill='#737F76')
    d.rectangle((56, 65, 68, 105), fill='#AEB9AD')
    d.rectangle((55, 65, 65, 104), fill='#DADDD0')
    d.line((55, 65, 65, 65), fill=P['white'])
    d.line((55, 66, 55, 103), fill='#F1EFE1')
    d.rectangle((58, 71, 63, 99), fill='#ADB9AA')
    for y in range(72, 100, 2):
        for x in range(58, 64, 2):
            d.point((x + (y // 2) % 2, y), fill='#6E8276')
    d.rectangle((58, 101, 63, 102), fill='#9CA99B')
    d.point((61, 102), fill='#587360')
    d.line((59, 107, 69, 107), fill='#A6B1A6')
    return image


def _projector(dark=False):
    image = canvas()
    d = ImageDraw.Draw(image)
    shell = '#3A4344' if dark else '#D9DCCF'
    top = '#566062' if dark else '#EEF0E1'
    side = '#222E33' if dark else '#A2ADA4'
    front = '#303B40' if dark else '#BBC4B9'
    bright = '#899593' if dark else '#F7F5E5'
    # A short, centered suspension pole, with a neatly contained cable loop.
    d.rectangle((60, 45, 68, 48), fill=P['silver_shadow'])
    d.line((61, 45, 67, 45), fill=P['silver_light'])
    d.rectangle((63, 48, 65, 56), fill=P['silver'])
    d.line((63, 49, 63, 55), fill=P['silver_light'])
    d.line((68, 48, 72, 48, 74, 50, 74, 58), fill='#46534E')
    d.line((72, 57, 77, 57, 79, 59, 79, 65), fill='#46534E')
    d.polygon([(47, 57), (73, 57), (80, 61), (80, 74), (48, 74), (46, 71), (46, 60)], fill=side)
    d.rectangle((47, 60, 76, 70), fill=shell)
    d.polygon([(47, 57), (73, 57), (78, 60), (49, 60)], fill=top)
    d.line((49, 57, 72, 57), fill=bright)
    d.rectangle((48, 69, 76, 73), fill=front)
    d.line((49, 73, 75, 73), fill=side)
    for x in range(49, 61, 3):
        d.line((x, 63, x, 66), fill='#1F2F32' if dark else '#687A72')
        d.point((x + 1, 63), fill='#697775' if dark else '#B5C0AF')
    d.ellipse((64, 63, 74, 72), fill='#1C292C')
    d.ellipse((65, 64, 73, 71), fill='#6C8586')
    d.ellipse((66, 65, 72, 70), fill='#243E4B')
    d.rectangle((67, 65, 69, 66), fill='#B3CDD0')
    d.point((71, 69), fill='#49728B')
    d.point((52, 59), fill='#A8CCB0' if dark else '#83A085')
    d.line((49, 75, 53, 75), fill=side)
    d.line((72, 75, 76, 75), fill=side)
    return image


def _fan():
    image = canvas()
    d = ImageDraw.Draw(image)
    # Three explicitly separated, tapered metal blades; no blurred rotor disk.
    blades = [
        [(62, 64), (63, 58), (96, 51), (103, 52), (103, 55), (96, 58), (69, 67)],
        [(64, 62), (68, 65), (80, 91), (79, 97), (75, 98), (72, 92), (59, 69)],
        [(64, 65), (59, 69), (31, 54), (27, 49), (29, 46), (35, 47), (66, 59)],
    ]
    for points in blades:
        d.polygon([(x + 1, y + 2) for x, y in points], fill='#858F85')
        d.polygon(points, fill='#C7CEBE')
    d.line((68, 61, 98, 53), fill='#EEF0DE', width=2)
    d.line((66, 69, 77, 93), fill='#E3E8D4', width=2)
    d.line((59, 62, 32, 49), fill='#E9ECDB', width=2)
    d.line((70, 65, 95, 57), fill='#AEBBA9')
    d.line((62, 70, 73, 91), fill='#A8B4A4')
    d.ellipse((58, 58, 71, 72), fill='#68786C')
    d.ellipse((58, 56, 71, 69), fill='#D8DECC')
    d.ellipse((60, 57, 69, 66), fill='#EBEDDC')
    d.line((61, 57, 67, 57), fill='#FAF7E7')
    d.rectangle((63, 51, 66, 59), fill='#D9DECD')
    d.line((63, 52, 63, 57), fill='#F6F3E4')
    d.ellipse((61, 49, 68, 52), fill='#E5E8D7')
    d.point((66, 65), fill='#B3C0AD')
    return image


def _dome_camera():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.ellipse((54, 58, 74, 68), fill='#7A887F')
    d.ellipse((54, 56, 74, 65), fill='#D7DDD0')
    d.ellipse((55, 55, 73, 62), fill='#ECEDE0')
    d.line((58, 56, 69, 56), fill='#FAF7E7')
    d.pieslice((56, 58, 72, 75), start=0, end=180, fill='#3C5357')
    d.rectangle((57, 63, 71, 66), fill='#405A5F')
    d.pieslice((58, 60, 70, 73), start=0, end=180, fill='#2A404A')
    d.rectangle((59, 64, 62, 66), fill='#789394')
    d.point((59, 63), fill='#CCD8C9')
    d.ellipse((64, 65, 69, 70), fill='#172C37')
    d.point((66, 66), fill='#6F99A4')
    return image


def _fire_pipe():
    image = canvas()
    d = ImageDraw.Draw(image)
    # Photo 16: dark red riser, bent branch, two collars, pale base sleeve.
    d.rectangle((59, 21, 68, 101), fill='#622E2B')
    d.rectangle((60, 21, 66, 101), fill=P['red'])
    d.line((60, 22, 60, 100), fill='#B85D4B')
    d.line((61, 23, 61, 99), fill='#A14A3C')
    d.line((67, 22, 67, 100), fill='#6B302B')
    for y in (39, 79):
        d.rectangle((57, y, 70, y + 4), fill='#622E2A')
        d.rectangle((58, y, 69, y + 2), fill='#9F493A')
        d.line((58, y, 68, y), fill='#C3795A')
    d.rectangle((67, 56, 78, 63), fill='#632F2C')
    d.rectangle((67, 56, 76, 60), fill='#943F33')
    d.line((69, 56, 76, 56), fill='#B65E49')
    d.polygon([(75, 56), (77, 53), (79, 52), (83, 52), (85, 54), (85, 61), (81, 64), (77, 63)], fill='#6C3029')
    d.rectangle((78, 53, 83, 60), fill='#944637')
    d.line((79, 53, 82, 53), fill='#B35B45')
    d.rectangle((79, 51, 85, 54), fill='#8A4334')
    d.line((80, 51, 84, 51), fill='#C17B5B')
    d.rectangle((58, 99, 69, 108), fill='#9DA79C')
    d.line((58, 100, 58, 107), fill='#D3D7C6')
    d.line((59, 100, 68, 100), fill='#E3E0CA')
    d.line((60, 108, 69, 108), fill='#697B70')
    return image


def _fire_cabinet():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((42, 36, 86, 108), fill='#655D49')
    d.rectangle((43, 36, 85, 107), fill='#BAAF8E')
    d.line((43, 36, 84, 36), fill='#E0D5AF')
    d.line((43, 37, 43, 106), fill='#DBCEAA')
    d.rectangle((46, 40, 82, 104), fill='#603C2F')
    d.rectangle((47, 41, 81, 103), fill='#9D553E')
    # Brick-faced recessed door, rather than a bright red freestanding box.
    for row, y in enumerate(range(41, 104, 5)):
        shade = ['#A86146', '#9F563F', '#A35B42'][row % 3]
        d.rectangle((47, y, 81, min(y + 3, 103)), fill=shade)
        if y + 4 <= 103:
            d.line((47, y + 4, 81, y + 4), fill='#B18C6C')
        for x in range(47 + (9 if row % 2 else 0), 82, 17):
            d.line((x, y, x, min(y + 3, 103)), fill='#B18C6C')
    d.line((48, 41, 80, 41), fill='#BE805B')
    for y, width in ((47, 22), (70, 18), (92, 19)):
        left = 64 - width // 2
        d.rectangle((left, y, left + width, y + 5), fill='#7B342B')
        d.line((left, y, left + width, y), fill='#C9906A')
        d.line((left, y + 5, left + width, y + 5), fill='#6F3429')
        for x in range(left + 3, left + width - 1, 4):
            d.rectangle((x, y + 2, x + 1, y + 3), fill='#D1B790')
    d.line((47, 81, 81, 81), fill='#644332')
    d.rectangle((76, 74, 78, 80), fill='#D3CBB0')
    d.line((78, 75, 78, 80), fill='#6D7469')
    d.point((77, 74), fill='#F0E4BF')
    for y in (45, 64, 85, 99):
        d.rectangle((45, y, 46, y + 2), fill='#A8A68B')
    d.line((44, 106, 83, 106), fill='#DED0A7')
    return image


def _exit_sign():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((46, 94, 82, 108), fill='#273D36')
    d.rectangle((47, 94, 81, 106), fill='#486354')
    d.rectangle((49, 96, 79, 105), fill='#173E32')
    d.line((47, 94, 80, 94), fill='#7F9880')
    d.line((48, 107, 81, 107), fill='#182D27')
    # Door, running person, and arrow are actual authored pictograms, no text.
    green = '#97E493'
    d.line((51, 104, 51, 97, 56, 97, 56, 104), fill=green)
    d.rectangle((60, 97, 62, 98), fill=green)
    d.line((61, 100, 59, 102, 57, 102), fill=green, width=2)
    d.line((61, 100, 64, 101, 65, 99), fill=green)
    d.line((61, 102, 63, 104, 65, 104), fill=green)
    d.line((60, 102, 58, 104), fill=green)
    d.line((69, 100, 77, 100), fill=green)
    d.line((74, 97, 77, 100, 74, 103), fill=green)
    return image


def _switch_socket():
    image = canvas()
    d = ImageDraw.Draw(image)
    d.rectangle((51, 96, 77, 108), fill='#909F91')
    d.rectangle((51, 95, 76, 107), fill='#D4DCCB')
    d.line((52, 95, 75, 95), fill='#F1F0DE')
    d.line((51, 96, 51, 106), fill='#F1F0DE')
    d.line((64, 96, 64, 106), fill='#A9B7A6')
    d.rectangle((54, 97, 61, 104), fill='#B2C0AC')
    d.rectangle((54, 97, 60, 103), fill='#ECEBDC')
    d.line((55, 98, 59, 98), fill='#FCF6E3')
    d.line((54, 104, 61, 104), fill='#879B8A')
    # Three-slot socket plus the small two-slot pair common in classrooms.
    d.line((68, 99, 69, 100), fill='#556E61')
    d.line((73, 99, 72, 100), fill='#556E61')
    d.line((70, 102, 70, 104), fill='#556E61')
    d.point((68, 103), fill='#758F7A')
    d.point((73, 103), fill='#758F7A')
    d.point((53, 106), fill='#A8B5A2')
    d.point((75, 106), fill='#A8B5A2')
    return image


def build_sprites() -> dict[str, Image.Image]:
    """Return the sixteen fixture IDs in their manifest's row-major order."""
    return {
        'prop_classroom_chalkboard_green': _chalkboard(),
        'prop_classroom_projection_screen_down': _screen(),
        'prop_classroom_radiator_castiron': _radiator(),
        'prop_classroom_ac_floor': _floor_ac(),
        'prop_classroom_clock_round': _clock(),
        'prop_classroom_light_fluorescent': _fluorescent(),
        'prop_corridor_light_downlight': _downlight(),
        'prop_classroom_speaker_wall': _speaker(),
        'prop_classroom_projector_white': _projector(),
        'prop_classroom_projector_black': _projector(dark=True),
        'prop_classroom_fan_ceiling': _fan(),
        'prop_corridor_camera_dome': _dome_camera(),
        'prop_stairwell_pipe_fire_red': _fire_pipe(),
        'prop_corridor_fire_cabinet_brick': _fire_cabinet(),
        'prop_corridor_exit_sign_green': _exit_sign(),
        'prop_classroom_switch_socket_cluster': _switch_socket(),
    }
