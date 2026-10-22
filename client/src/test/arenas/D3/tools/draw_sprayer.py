"""Campus lawn impact sprinkler pixel art and short synthesized SFX.

Extends the project's local Pillow asset pipeline. No API or downloaded art.
Run: python client/src/test/arenas/D3/tools/draw_sprayer.py
"""
from pathlib import Path
import math
import argparse
import random
import shutil
import struct
import subprocess
import tempfile
import wave
from PIL import Image, ImageDraw

CLIENT = Path(__file__).resolve().parents[5]
OUTLINE = '#203943'


def frame(index):
    im = Image.new('RGBA', (64, 64))
    d = ImageDraw.Draw(im)
    d.ellipse((8, 41, 57, 58), fill=(10, 28, 35, 55))
    # Trailing ribbed hose and brass quick connector identify irrigation equipment.
    hose = [(31, 42), (22, 44), (17, 50), (11, 53), (5, 52), (3, 47)]
    d.line(hose, fill=OUTLINE, width=7)
    d.line(hose, fill='#3a765e', width=4)
    d.line([(17, 49), (12, 51), (6, 50)], fill='#80ac73', width=1)
    for x, y in [(6, 51), (11, 52), (17, 49), (22, 44)]:
        d.line((x-1, y-1, x+1, y+2), fill='#234e44', width=1)
    # Wide, low sled frame: three visible metal supports, never humanoid feet.
    d.line([(31, 36), (13, 48), (25, 53), (52, 46), (31, 36)], fill=OUTLINE, width=8)
    d.line([(31, 36), (13, 48), (25, 53), (52, 46), (31, 36)], fill='#47917a', width=5)
    d.line([(14, 47), (25, 51), (50, 45)], fill='#9bc2a1', width=1)
    d.line([(31, 38), (26, 50)], fill='#a7b3a2', width=3)
    for x, y in [(14, 48), (26, 52), (50, 46)]:
        d.ellipse((x-2, y-1, x+2, y+2), fill='#d2dad0', outline=OUTLINE)
    d.rectangle((24, 39, 33, 44), fill='#d6a955', outline=OUTLINE)
    d.line((26, 40, 26, 43), fill='#fff0a0')
    d.line((29, 40, 29, 43), fill='#92703f')
    # Central riser with the metallic pivot and a small pressure gauge.
    d.polygon([(29, 25), (36, 24), (37, 41), (30, 44)], fill='#8eaaa6', outline=OUTLINE)
    d.line((31, 29, 31, 41), fill='#dce8d6', width=2)
    d.ellipse((27, 25, 38, 33), fill='#dcb25b', outline=OUTLINE, width=2)
    d.ellipse((37, 34, 44, 41), fill='#dce4d4', outline=OUTLINE)
    d.line((40, 38, 42 if index == 4 else 39, 35), fill='#c66c45')
    # Rotating brass impact head. It is an integral machine part, no held weapon.
    head = Image.new('RGBA', (40, 30))
    h = ImageDraw.Draw(head)
    h.line([(8, 20), (29, 8)], fill=OUTLINE, width=9)
    h.line([(8, 20), (29, 8)], fill='#b88b40', width=6)
    h.line([(9, 18), (28, 7)], fill='#f1cf75', width=2)
    h.polygon([(26, 6), (32, 4), (36, 9), (30, 12)], fill='#edca70', outline=OUTLINE)
    h.line((31, 6, 34, 9), fill='#435d5e', width=2)
    # Spring-loaded hammer next to the nozzle is the classic sprinkler silhouette.
    h.line([(10, 16), (7, 9), (12, 4), (24, 5)], fill=OUTLINE, width=5)
    h.line([(10, 16), (7, 9), (12, 4), (24, 5)], fill='#a4b7ad', width=2)
    h.rectangle((22, 2, 27, 6), fill='#425e5b', outline=OUTLINE)
    h.line((13, 12, 20, 8), fill='#1e393b', width=3)
    for x in range(13, 21, 2):
        h.line((x, 10, x+1, 13), fill='#d8ded0')
    angle = [0, -14, -28, -14, -8, -8][index]
    head = head.rotate(angle, resample=Image.Resampling.NEAREST, center=(16, 19))
    im.alpha_composite(head, (16, 7))
    d = ImageDraw.Draw(im)
    d.ellipse((28, 23, 36, 29), fill='#edce7c', outline=OUTLINE)
    d.ellipse((31, 25, 33, 27), fill='#6d7757')
    if index == 4:  # Pressure builds before discharge.
        d.arc((25, 18, 40, 33), 200, 330, fill='#efffa9', width=2)
    if index == 5:
        for pts in [[(49, 13), (55, 8), (60, 7)], [(49, 15), (56, 14), (61, 11)],
                    [(49, 17), (55, 20), (61, 19)]]:
            d.line(pts, fill='#a3dcb1', width=2)
            d.point(pts[-1], fill='#efffd3')
    return im


def audio():
    dest = CLIENT / 'public/assets/audio/sfx/enemies'
    dest.mkdir(parents=True, exist_ok=True)
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('ffmpeg is required to encode both ogg and mp3')
    rate = 22050
    for name, duration in [('spray', .42), ('pickup', .24), ('cleanse', .42)]:
        rng = random.Random(20261022)
        samples = []
        for i in range(round(rate * duration)):
            t = i / rate
            env = math.sin(math.pi * t / duration) ** 2
            if name == 'spray':
                value = (rng.uniform(-1, 1) * .65 + math.sin(2*math.pi*(180*t+260*t*t)) * .25) * env
            elif name == 'pickup':
                value = math.sin(2*math.pi*(380*t-450*t*t)) * env * .6
            else:
                value = (math.sin(2*math.pi*660*t) + math.sin(2*math.pi*990*t) * .5) * env * .35
            samples.append(struct.pack('<h', round(value * 20000)))
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / 'source.wav'
            with wave.open(str(wav), 'wb') as w:
                w.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                w.writeframes(b''.join(samples))
            for ext in ['ogg', 'mp3']:
                # Explicit codecs: some minimal ffmpeg builds default to FLAC in
                # .ogg, or write an MP3 header without playable audio frames.
                encoding = ['-c:a', 'libvorbis', '-q:a', '3'] if ext == 'ogg' else [
                    '-c:a', 'libmp3lame', '-b:a', '64k']
                subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', str(wav),
                    *encoding, str(dest / f'sfx_liquid_{name}.{ext}')], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--art-only', action='store_true', help='Redraw sprite without re-encoding SFX')
    args = parser.parse_args()
    dest = CLIENT / 'public/assets/sprites/enemies/enemy_sprayer_idle.png'
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGBA', (64*6, 64))
    for i in range(6):
        sheet.alpha_composite(frame(i), (i*64, 0))
    sheet.save(dest, optimize=True)
    if not args.art_only:
        audio()
    print('Created lawn sprinkler sheet (6 frames)' + ('' if args.art_only else ' and 3 pairs of ogg/mp3 SFX'))
