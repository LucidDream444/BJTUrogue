"""Import only the painted grass rectangle from the supplied map, retaining native pixels."""
from pathlib import Path
from PIL import Image, ImageChops
import json
client=Path(__file__).resolve().parents[5]
source=client.parent.parent/'5'
tiled=json.loads((source/'map.tiled.json').read_text(encoding='utf8'))
preview=Image.open(source/'preview.png').convert('RGB')
background=Image.new('RGB',preview.size,tiled['backgroundcolor'])
crop=ImageChops.difference(preview,background).getbbox()
assert crop is not None
image=preview.crop(crop)
# The exporter leaves a few gray pinholes at rounded pond corners; cover those with nearby grass.
for y in range(image.height):
 for x in range(image.width):
  if image.getpixel((x,y))==(144,144,144): image.putpixel((x,y),image.getpixel((x,64)))
target=client/'public/assets/maps/grass_pond.png';target.parent.mkdir(parents=True,exist_ok=True);image.save(target)
water_set=next(s for s in tiled['tilesets'] if s['name'].lower()=='water')
first=water_set['firstgid'];last=first+water_set['tilecount']
grid=tiled['layers'][0]['data'];cols=tiled['width'];size=tiled['tilewidth']
water_cells={(i%cols,i//cols) for i,t in enumerate(grid) if first <= t < last}
rects=[]
while water_cells:
 seed=next(iter(water_cells));component={seed};queue=[seed];water_cells.remove(seed)
 while queue:
  x,y=queue.pop()
  for point in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if point in water_cells:water_cells.remove(point);component.add(point);queue.append(point)
 x0=min(x for x,y in component);y0=min(y for x,y in component);x1=max(x for x,y in component)+1;y1=max(y for x,y in component)+1
 assert len(component)==(x1-x0)*(y1-y0),'Water is not a rectangular pond'
 rects.append({'x':x0*size-crop[0],'y':y0*size-crop[1],'width':(x1-x0)*size,'height':(y1-y0)*size})
report={'source':'5/preview.png + 5/map.tiled.json','crop':crop,'width':image.width,'height':image.height,'water':rects}
(client.parent/'artifacts/grass-map-import.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report,indent=2))
