"""Copy both user-supplied complete 16-frame exports, without altering a single pixel.
Usage: python import_aim_poses.py <up spritesheet.png> <down spritesheet.png>
"""
from pathlib import Path
from PIL import Image
import hashlib, shutil, sys
client = Path(__file__).resolve().parents[5]
for direction, supplied in zip(('up', 'down'), sys.argv[1:], strict=True):
    source = Path(supplied)
    with Image.open(source) as image:
        assert image.size == (284, 284), 'Expected a 4 x 4 sheet of 71 x 71 frames'
    destination = client / f'public/assets/sprites/player/player_student_aim_{direction}.png'
    shutil.copyfile(source, destination)
    assert source.read_bytes() == destination.read_bytes()
    print(direction, hashlib.sha256(destination.read_bytes()).hexdigest())
