"""Remove only firing frames 0/1 from the explicitly supplied run sheet.
Remaining frames are copied pixel-for-pixel in original order at their native size.
"""
from pathlib import Path
from PIL import Image, ImageChops
import hashlib, json
client=Path(__file__).resolve().parents[5]
source=client.parent.parent/'8/1791706540776-azoqw5we3hg/textures/1791706540776-azoqw5we3hg_spritesheet.png'
target=client/'public/assets/sprites/player/player_student_run_gun_clean.png'
image=Image.open(source).convert('RGBA')
result=Image.new('RGBA',(71*7,71*2))
for index,source_frame in enumerate(range(2,16)):
 box=(source_frame%4*71,source_frame//4*71,(source_frame%4+1)*71,(source_frame//4+1)*71)
 frame=image.crop(box)
 result.paste(frame,(index%7*71,index//7*71))
 restored=result.crop((index%7*71,index//7*71,(index%7+1)*71,(index//7+1)*71))
 assert ImageChops.difference(frame,restored).getbbox(alpha_only=False) is None
result.save(target)
report={'source':str(source),'target':str(target),'removedSourceFrames':[0,1],'retainedSourceFrames':list(range(2,16)),'pixelIdentical':True,'size':list(result.size),'frameWidth':71,'frameHeight':71,'count':14,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
(client.parent/'artifacts/run-clean-import.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
