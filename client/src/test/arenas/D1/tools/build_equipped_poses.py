"""Bake complete standing/running poses for every weapon from the two folder-11 exports.
Only the handgun is masked. Head, torso and both arms are never independently rotated.
Standing poses use the supplied upright legs; weapon and muzzle transforms share aimArt metadata.
Usage: python build_equipped_poses.py [--config path] [--output directory]
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse, json, math

client = Path(__file__).resolve().parents[5]
parser = argparse.ArgumentParser()
parser.add_argument('--config', type=Path, default=client / 'public/config/combat.json')
parser.add_argument('--output', type=Path, default=client / 'public/assets/sprites/player')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
config = json.loads(args.config.read_text(encoding='utf-8'))
a = config['aimArt']
assets = client / 'public/assets/sprites/player'
fw, fh = a['render']['frameWidth'], a['render']['frameHeight']
ox, oy = a['render']['offset']
sources = {s: Image.open(assets / f'player_student_aim_{s}.png').convert('RGBA') for s in ('up', 'down')}
# The first lower-aim frame is already a standing character. Its skirt and feet are our fixed stance.
standing_legs = sources['down'].crop((0, a['standWaistY'], 71, 71))
contact = []
for weapon in config['weapons']:
    wid = weapon['id']
    for direction, source in sources.items():
        sheets = {state: Image.new('RGBA', (fw * 4, fh * 4)) for state in ('run', 'stand')}
        for i in range(16):
            src = source.crop(((i % 4) * 71, (i // 4) * 71, (i % 4 + 1) * 71, (i // 4 + 1) * 71))
            grip = a['grips'][direction][i]
            muzzle = a['muzzles'][direction][i]
            angle = a['angles'][direction][i]
            body = src.copy()
            if wid != 'pencil':
                # Keep the hand and cuff, remove dark handgun pixels only in its measured region.
                lower = direction == 'down' and i >= 4
                left = 57 if lower else (55 if direction == 'down' and i < 2 else 58)
                top = min(muzzle[1], grip[1]) - 4
                bottom = max(muzzle[1], grip[1]) + 3
                for y in range(max(0, int(top)), min(71, int(bottom) + 1)):
                    for x in range(left, 71):
                        r, g, b, alpha = body.getpixel((x, y))
                        skin = r > 115 and r > g * 1.12 and r > b * 1.12
                        sleeve = min(r, g, b) > 115
                        if alpha and not skin and not sleeve:
                            body.putpixel((x, y), (0, 0, 0, 0))
            # Muzzle flashes in the two original standing shot frames belong to the shot effect,
            # never a perpetual idle sprite. Those frames are kept as source but not looped.
            for state, atlas in sheets.items():
                whole = Image.new('RGBA', (fw, fh))
                dy = 0
                if state == 'stand':
                    waist = a['waistY'][direction][i]
                    dy = a['standWaistY'] - waist
                    whole.alpha_composite(standing_legs, (ox, oy + a['standWaistY']))
                    upper = body.copy()
                    for y in range(waist, 71):
                        for x in range(71):
                            # Downward hands extend below the waist: retain them in full.
                            if not (direction == 'down' and i >= 4 and x >= 54 and y <= 58):
                                upper.putpixel((x, y), (0, 0, 0, 0))
                    whole.alpha_composite(upper, (ox, oy + dy))
                else:
                    whole.alpha_composite(body, (ox, oy))
                if wid != 'pencil':
                    gun = Image.open(assets / f'player_gun_{wid}.png').convert('RGBA')
                    # The old differential gun export includes a few skin pixels at its rear edge.
                    for y in range(gun.height):
                        for x in range(59):
                            r,g,b,alpha = gun.getpixel((x,y))
                            if alpha and ((r > 110 and r > g*1.15 and r > b*1.15) or min(r,g,b) > 180):
                                gun.putpixel((x,y),(0,0,0,0))
                    target = (ox + grip[0], oy + grip[1] + dy)
                    gun_layer = Image.new('RGBA',(fw,fh))
                    gun_layer.alpha_composite(gun, (int(target[0]-a['weaponGrip'][0]), int(target[1]-a['weaponGrip'][1])))
                    gun_layer = gun_layer.rotate(-angle, Image.Resampling.NEAREST, center=target)
                    gun_layer.alpha_composite(whole)
                    whole = gun_layer
                atlas.paste(whole, ((i%4)*fw, (i//4)*fh))
        for state,atlas in sheets.items():
            atlas.save(args.output / f'player_{wid}_aim_{direction}_{state}.png')
        for direction_frame in ([0,5,11] if direction == 'up' else [8]):
            i=direction_frame
            for state, atlas in sheets.items():
                tile=atlas.crop(((i%4)*fw,(i//4)*fh,(i%4+1)*fw,(i//4+1)*fh))
                contact.append((wid+' '+direction+' '+state+' '+str(i),tile))
font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',13)
board=Image.new('RGB',(8*224,6*212),(48,58,61));draw=ImageDraw.Draw(board)
for n,(label,tile) in enumerate(contact):
    x=(n%8)*224;y=(n//8)*212
    draw.text((x+4,y+3),label,fill='white',font=font)
    bg=Image.new('RGBA',tile.size,(48,58,61,255));bg.alpha_composite(tile)
    board.paste(bg.resize((224,192),Image.Resampling.NEAREST),(x,y+20))
board.save(args.output / 'equipped-contact.png')
print('Baked 24 equipped full-body atlases; 16 poses each; standing feet are fixed.')
