"""Deterministic pixel art and short synthesized SFX for the catalyst sprayer.

Extends the project's local Pillow asset pipeline. No API or downloaded art.
Run: python client/src/test/arenas/D3/tools/draw_sprayer.py
"""
from pathlib import Path
import math
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
    bob = [0, -1, 0, 1, -2, 1][index]
    d.ellipse((12, 46, 53, 57), fill=(10, 28, 35, 60))
    # Walking rubber feet, distinct from a weapon or equipment attachment.
    for x, shift in [(20, index % 2 * 2), (40, (1-index % 2) * 2)]:
        d.rounded_rectangle((x-5, 46+shift, x+6, 53+shift), 2, '#263f4a', OUTLINE, 2)
        d.line((x-3, 51+shift, x+4, 51+shift), fill='#6c9196', width=1)
    # A living lab wash-bottle: translucent green reservoir with internal bubbles.
    d.rounded_rectangle((14, 18+bob, 49, 48+bob), 8, '#6baf63', OUTLINE, 2)
    d.rounded_rectangle((18, 22+bob, 46, 45+bob), 6, '#a2dc70')
    d.rectangle((19, 33+bob, 45, 43+bob), '#64b86a')
    d.line([(19, 32+bob), (26, 34+bob), (34, 31+bob), (44, 33+bob)], fill='#d5f49c', width=2)
    d.line((18, 26+bob, 18, 39+bob), fill='#ddffc4', width=2)
    for x, y in [(24, 39), (39, 37), (31, 43)]:
        d.ellipse((x-1, y-1+bob, x+1, y+1+bob), outline='#c4ed8b')
    # Fitted cap and biological spout; the enemy has no held weapon baked in.
    d.rectangle((23, 12+bob, 40, 19+bob), fill='#e6b856', outline=OUTLINE, width=2)
    d.line((26, 13+bob, 26, 17+bob), fill='#fff0a1')
    d.line((35, 13+bob, 35, 17+bob), fill='#9b713c')
    d.line([(38, 15+bob), (45, 9+bob), (52, 9+bob), (54, 15+bob)], fill=OUTLINE, width=6)
    d.line([(38, 15+bob), (45, 9+bob), (51, 9+bob), (53, 15+bob)], fill='#d1dec2', width=3)
    # Heavy brows and two eyes make the intent readable at gameplay scale.
    for x in [25, 38]:
        d.rectangle((x-3, 23+bob, x+3, 29+bob), fill='#efffcb')
        d.rectangle((x, 25+bob, x+2, 29+bob), fill=OUTLINE)
    d.line((21, 21+bob, 28, 23+bob), fill=OUTLINE, width=2)
    d.line((35, 23+bob, 42, 21+bob), fill=OUTLINE, width=2)
    # A small hazard diamond emphasizes the potion's double-edged nature.
    d.polygon([(31, 35+bob), (36, 39+bob), (31, 44+bob), (26, 39+bob)], fill='#ffe597', outline=OUTLINE)
    d.line((31, 37+bob, 31, 40+bob), fill=OUTLINE, width=1)
    d.point((31, 42+bob), fill=OUTLINE)
    if index == 4:
        d.ellipse((48, 16+bob, 55, 24+bob), fill='#c1f276', outline=OUTLINE)
    if index == 5:
        for x, y, r in [(54, 22, 3), (57, 29, 2), (50, 33, 2)]:
            d.ellipse((x-r, y-r, x+r, y+r), fill='#b4ed6e', outline='#407f5b')
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
    dest = CLIENT / 'public/assets/sprites/enemies/enemy_sprayer_idle.png'
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGBA', (64*6, 64))
    for i in range(6):
        sheet.alpha_composite(frame(i), (i*64, 0))
    sheet.save(dest, optimize=True)
    audio()
    print('Created catalyst sprayer sheet (6 frames) and 3 pairs of ogg/mp3 SFX')
