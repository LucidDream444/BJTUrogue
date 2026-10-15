"""Replace only the held pistol with the user-supplied cyan gun; keep original body frames.
The atlas is padded so the longer barrel fits. Each variant shares the original foot anchor.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import json, hashlib, math
CLIENT=Path(__file__).resolve().parents[5]
OUT=CLIENT/'public/assets/sprites/player'
REPORT=CLIENT.parent/'artifacts'
cfg=json.loads((CLIENT/'public/config/combat.json').read_text(encoding='utf8'))
gun_src=Image.open(CLIENT/'public/assets/sprites/weapons/weapon_pulse_reference.png').convert('RGBA')
gun=gun_src.crop(gun_src.getbbox()).resize((24,17),Image.Resampling.NEAREST)
# Gun-local contact and muzzle refer to the resized source image, not a screen offset.
GRIP=(6,9); TIP=(24,4.5); PAD=(4,4); SIZE=(96,80)

def skin(c):
 r,g,b,a=c
 return a>0 and r>95 and r>g*1.13 and g>b*1.04

def composite(frame,muzzle,kind):
 original=frame.copy(); fw,fh=frame.size
 mx,my=muzzle
 hx,hy=round(mx-8),round(my+3)
 left=hx-2;top=math.floor(my-3);right=fw;bottom=math.ceil(my+7)
 keep=Image.new('RGBA',frame.size)
 for y in range(max(0,top),min(fh,bottom)):
  for x in range(max(0,left),right):
   c=frame.getpixel((x,y));r,g,b,a=c
   # Preserve hand and sleeve pixels, replace the dark pistol silhouette only.
   if skin(c) or (y>=my+1 and r>120 and g>120 and b>120): keep.putpixel((x,y),c)
   else: frame.putpixel((x,y),(0,0,0,0))
 # Remove authored yellow muzzle sparks from the old shooting animation.
 if kind in ('shoot','hurt'):
  for y in range(24,min(50,fh)):
   for x in range(max(0,hx-4),fw):
    r,g,b,a=frame.getpixel((x,y))
    if a and r>100 and g>70 and b<g*.65:frame.putpixel((x,y),(0,0,0,0))
 px=hx-GRIP[0];py=hy-GRIP[1]
 result=Image.new('RGBA',SIZE);result.alpha_composite(frame,PAD)
 result.alpha_composite(gun,(px+PAD[0],py+PAD[1]));result.alpha_composite(keep,PAD)
 return result,[px+PAD[0]+TIP[0],py+PAD[1]+TIP[1]],(left,top,right,bottom)

metadata={}
for kind,filename,fw,cols,count in [('run','player_student_run_gun_clean.png',71,7,14),('shoot','player_student_shoot.png',72,4,16),('hurt','player_student_hurt.png',71,4,16)]:
 sheet=Image.open(OUT/filename).convert('RGBA');rows=math.ceil(count/cols)
 result=Image.new('RGBA',(cols*SIZE[0],rows*SIZE[1]));entries=[]
 for i in range(count):
  fr=sheet.crop((i%cols*fw,i//cols*fw,(i%cols+1)*fw,(i//cols+1)*fw))
  if kind=='hurt' and 1<=i<=12:
   composed=Image.new('RGBA',SIZE);composed.alpha_composite(fr,PAD);point=None
  else:
   key='runGun' if kind=='run' else 'shoot'
   muzzle=cfg['gunMuzzles'][key][i] if kind!='hurt' else cfg['gunMuzzles']['shoot'][4]
   composed,point,roi=composite(fr,muzzle,kind)
  result.alpha_composite(composed,(i%cols*SIZE[0],i//cols*SIZE[1]));entries.append(point)
 dest=OUT/f'player_pulse_{kind}_equipped.png';result.save(dest)
 # Anchor conversion makes the unedited body pixels remain at precisely the same world position.
 ox=71*.75352 if kind=='run' else 72*.67361 if kind=='shoot' else 71*.66901
 oy=fw
 metadata[kind]={'key':f'player_pulse_{kind}_equipped','frameWidth':96,'frameHeight':80,'count':count,'anchor':[(ox+PAD[0])/96,(oy+PAD[1])/80],'muzzles':entries,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}
 if kind=='run':
  frames=[result.crop((i%cols*96,i//cols*80,(i%cols+1)*96,(i//cols+1)*80)) for i in range(count)]
  contact=Image.new('RGB',(96*4*4,80*4*4),'#182432');draw=ImageDraw.Draw(contact)
  for i,f in enumerate(frames):
   f=f.resize((384,320),Image.Resampling.NEAREST);pos=(i%4*384,i//4*320);contact.paste(f,pos,f);draw.text(pos,str(i+2),fill='white')
  contact.save(REPORT/'pulse-equipped-run-sheet.png')
  preview=[]
  for f in frames:
   c=Image.new('RGB',(600,270),'#152232');d=ImageDraw.Draw(c);d.text((30,8),'LEFT',fill='white');d.text((335,8),'RIGHT',fill='white')
   for n,img in enumerate([f.transpose(Image.Transpose.FLIP_LEFT_RIGHT),f]):
    img=img.resize((288,240),Image.Resampling.NEAREST);c.paste(img,(n*300,26),img)
   preview.append(c)
  preview[0].save(REPORT/'pulse-equipped-run.gif',save_all=True,append_images=preview[1:],duration=[120,130]*7,loop=0,disposal=2)
(REPORT/'pulse-equipped-manifest.json').write_text(json.dumps(metadata,indent=2),encoding='utf8')
print('Composited run, shooting/idle and hurt atlases using supplied cyan gun.')
