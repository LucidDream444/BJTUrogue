"""Draw, validate and export the complete photo-referenced campus pixel pack.

Usage (repository root): python client/tools/art/build_campus_pack.py
Requires Pillow. No API, network, Phaser, or source photographs are needed.
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from campus_pixel import architecture, fixtures, furniture, materials
from campus_pixel import classroom_scenes, circulation_scenes, extras
from campus_pixel.drawing import ANCHOR, P
from campus_pixel.scene_common import warm_window_light

ROOT=Path(__file__).resolve().parents[3]
DOCS=ROOT/'docs/art/campus_20261023'
ASSETS=ROOT/'client/public/assets'
PREVIEWS=DOCS/'previews'
PACK='campus_20261023'


def dump(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def font(size):
    for name in ('C:/Windows/Fonts/msyh.ttc','C:/Windows/Fonts/arial.ttf'):
        if Path(name).is_file():
            return ImageFont.truetype(name,size)
    return ImageFont.load_default(size=size)


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(image,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    image.save(path,optimize=True)


def sha(image):
    return hashlib.sha256(image.tobytes()).hexdigest()


def checker(size,step=8):
    image=Image.new('RGBA',size,'#DDDFD6')
    d=ImageDraw.Draw(image)
    for y in range(0,size[1],step):
        for x in range(0,size[0],step):
            if (x//step+y//step)%2:
                d.rectangle((x,y,x+step-1,y+step-1),fill='#D1D5CB')
    return image


def asset_record(key,image,path,kind,**extra):
    return dict(id=key,path=path.relative_to(ASSETS).as_posix(),kind=kind,
                width=image.width,height=image.height,mode=image.mode,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),**extra)


def sheet_preview(name,spec,sprites):
    board=Image.new('RGB',(1024,1128),'#EAE8DF')
    d=ImageDraw.Draw(board)
    d.text((20,12),name,fill=P['steel'],font=font(23))
    for cell in spec['cells']:
        x,y=cell['col']*256,cell['row']*268+52
        bg=checker((256,240),16)
        bg.alpha_composite(sprites[cell['id']].resize((256,256),Image.Resampling.NEAREST),(0,-12))
        board.paste(bg.convert('RGB'),(x,y))
        d.text((x+6,y+242),cell['name'],fill=P['steel'],font=font(12))
    return board


def build_gallery(delivery):
    sections=[]
    groups=(('scenes','整景'),('furniture','桌椅'),('architecture','建筑'),('fixtures','设备'),('extras','补充物件'),('tiles','材质'))
    for group,title in groups:
        cards=[]
        for asset in delivery['assets']:
            if asset['group']!=group:
                continue
            src='../../../client/public/assets/'+asset['path']
            cls='scene' if group=='scenes' else 'sprite'
            cards.append(f'<a class="card {cls}" href="{src}" target="_blank"><div class="canvas"><img loading="lazy" src="{src}" alt="{asset["name"]}"></div><span>{asset["name"]}</span><small>{asset["width"]} × {asset["height"]}</small></a>')
        sections.append(f'<section data-group="{group}"><h2>{title}</h2><div class="grid {"scenes" if group=="scenes" else ""}">{"".join(cards)}</div></section>')
    html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>校园实拍 · 像素美术包</title>
<style>*{box-sizing:border-box}body{margin:0;background:#eae8df;color:#293735;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}header{padding:32px max(24px,calc((100vw - 1400px)/2));background:#d8dfd5;border-bottom:3px solid #465e78}h1{margin:0;font-size:30px}header p{max-width:900px;margin:10px 0 0}nav{position:sticky;top:0;z-index:2;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 24px;background:#eae8dff5;border-bottom:1px solid #b7c0b3}button{font:inherit;border:1px solid #aab5a7;border-radius:4px;padding:6px 14px;cursor:pointer;background:#f8f7ef;color:#293735}button[aria-pressed=true]{background:#465e78;color:white;border-color:#465e78}label{margin-left:auto}main{max-width:1440px;margin:auto;padding:0 24px 60px}section{padding-top:18px}h2{font-size:20px;border-bottom:1px solid #b8c0b2;padding-bottom:6px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.grid.scenes{grid-template-columns:repeat(auto-fit,minmax(500px,1fr))}.card{display:block;color:inherit;text-decoration:none;padding:10px;background:#f5f3eb;border:1px solid #bdc6b8;border-radius:5px;overflow:hidden}.canvas{background-color:#d4d8ce;background-image:conic-gradient(#e4e7de 25%,transparent 0 50%,#e4e7de 0 75%,transparent 0);background-size:16px 16px;display:flex;justify-content:center;align-items:center;overflow:hidden}.sprite img{width:256px;height:256px}.scene img{width:100%;height:auto}.card img{image-rendering:pixelated;object-fit:contain}.card span{display:block;margin:8px 0 0}.card small{color:#657567;display:block}.solid .canvas{background:#6c7770}footer{padding:24px;background:#d8dfd5}a:focus-visible,button:focus-visible{outline:3px solid #4386b6;outline-offset:3px}[hidden]{display:none!important}@media(max-width:600px){.grid.scenes{grid-template-columns:1fr}header{padding:24px}h1{font-size:25px}.grid{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}}</style>
<header><h1>校园实拍 · 像素美术包</h1><p>黄木开放书斗、蓝色固定翻板椅、蓝灰窗帘，及教室、走廊、楼梯与红砖门厅。所有图像在原生像素网格直接绘制。点击任意图片查看 PNG 原图。</p><p>独立家具采用中性材质色；暖阳只出现在窗边整景与单独光照层。当前是美术交付预览，尚未接入正式游戏地图。</p></header>
<nav><button data-filter="all" aria-pressed="true">全部</button><button data-filter="scenes" aria-pressed="false">整景</button><button data-filter="furniture" aria-pressed="false">桌椅</button><button data-filter="architecture" aria-pressed="false">建筑</button><button data-filter="fixtures" aria-pressed="false">设备</button><button data-filter="extras" aria-pressed="false">补充物件</button><button data-filter="tiles" aria-pressed="false">材质</button><label><input id="solid" type="checkbox">深色底检查透明边缘</label></nav><main>'''+''.join(sections)+'''</main><footer>2026-10-23 · 六张整景 / 五十件独立物件 / 十六种材质 · 原生像素 PNG，无外部网页或网络依赖。</footer><script>document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('section').forEach(s=>s.hidden=b.dataset.filter!=='all'&&s.dataset.group!==b.dataset.filter)}));document.querySelector('#solid').addEventListener('change',e=>document.body.classList.toggle('solid',e.target.checked));</script></html>'''
    (DOCS/'gallery.html').write_text(html,encoding='utf-8')


def main():
    PREVIEWS.mkdir(parents=True,exist_ok=True)
    component_spec=load_json(DOCS/'components.json')
    tile_spec=load_json(DOCS/'tiles.json')
    scene_spec=load_json(DOCS/'prompts/scenes.json')
    groups={'furniture':furniture.build_sprites(),'architecture':architecture.build_sprites(),
            'fixtures':fixtures.build_sprites(),'extras':extras.build_sprites()}
    sprites={key:im for group in groups.values() for key,im in group.items()}
    tiles=materials.build_tiles()
    assert len(sprites)==50 and len(tiles)==16
    names={cell['id']:cell['name'] for sheet in component_spec['sheets'] for cell in sheet['cells']}
    names.update(prop_lobby_icecream_neon='门厅冰淇淋轮廓灯',prop_stairwell_floor_marker_6='楼梯间六层圆牌')
    records=[]
    checks=[]
    for group,images in groups.items():
        for key,image in images.items():
            assert image.mode=='RGBA' and image.size==(128,128),key
            alpha=set(image.getchannel('A').getdata())
            assert alpha=={0,255},(key,alpha)
            bbox=image.getbbox()
            assert bbox and bbox[0]>=16 and bbox[1]>=16 and bbox[2]<=112 and bbox[3]<=112,(key,bbox)
            assert (255,0,255,255) not in image.getdata(),key
            directory='furniture' if group=='furniture' else 'props'
            path=ASSETS/f'sprites/{directory}/{PACK}/{key}.png'
            save(image,path)
            ceiling=key in {c['id'] for s in component_spec['sheets'] for c in s['cells'] if c.get('mount')=='ceiling'}
            anchor=(64,64) if ceiling else ANCHOR
            records.append(asset_record(key,image,path,'image',group=group,name=names[key],
                                        anchor=list(anchor),visualBounds=list(bbox),alpha='binary'))
    # Every planned object exists and the two folding states differ in each view.
    expected={c['id'] for s in component_spec['sheets'] for c in s['cells']}
    assert expected<=sprites.keys()
    for view in ('front','back','left','right'):
        assert sha(sprites[f'furniture_lecture_chair_blue_down_{view}'])!=sha(sprites[f'furniture_lecture_chair_blue_folded_{view}'])
    checks.append('50 native sprites: exact IDs, 128x128, binary alpha, 16 px safe margins, no chroma pixels; folding states differ in all four directions.')
    for spec in component_spec['sheets']:
        atlas=Image.new('RGBA',(512,512))
        for cell in spec['cells']:
            atlas.alpha_composite(sprites[cell['id']],(cell['col']*128,cell['row']*128))
        path=ASSETS/f'maps/{PACK}/atlas_{spec["id"].removeprefix("sheet_")}.png'
        save(atlas,path)
        records.append(asset_record(spec['id'],atlas,path,'atlas',group='atlases',name=spec['id'],cellSize=128,columns=4,rows=4))
        preview=sheet_preview({'sheet_furniture':'黄木课桌与蓝色翻板椅','sheet_architecture':'门窗、蓝帘、楼梯与栏杆','sheet_fixtures':'教室与走廊设施'}[spec['id']],spec,sprites)
        save(preview,PREVIEWS/f'{spec["id"]}.png')
    detail=Image.new('RGB',(1536,630),'#EAE8DF')
    dd=ImageDraw.Draw(detail)
    dd.text((24,12),'结构核对 · 开放书斗与蓝色翻板座面',font=font(27),fill=P['steel'])
    details=(('furniture_classroom_desk_yellow_double','黄木课桌 · 朝学生开放的书斗'),
             ('furniture_classroom_desk_yellow_double_back','同款课桌 · 黄木背板'),
             ('furniture_lecture_chair_blue_down_front','固定翻板椅 · 座面放下'),
             ('furniture_lecture_chair_blue_folded_front','同款蓝椅 · 座面收起'),
             ('furniture_lecture_chair_blue_down_left','侧面 · 座面放下'),
             ('furniture_lecture_chair_blue_folded_left','侧面 · 座面收起'))
    for n,(key,title) in enumerate(details):
        crop=sprites[key].crop(sprites[key].getbbox())
        crop=crop.resize((crop.width*4,crop.height*4),Image.Resampling.NEAREST)
        x,y=(n%3)*512,(n//3)*278+64
        dd.rectangle((x+12,y,x+499,y+260),fill='#DDDCD0')
        detail.paste(crop,(x+(512-crop.width)//2,y+16+(208-crop.height)//2),crop)
        dd.text((x+24,y+229),title,font=font(17),fill=P['steel'])
    save(detail,PREVIEWS/'furniture_detail.png')
    atlas=Image.new('RGBA',(256,256))
    tile_board=Image.new('RGB',(1024,1000),'#EAE8DF')
    td=ImageDraw.Draw(tile_board)
    td.text((16,10),'墙地材质铺贴 · 条带仅横向重复',fill=P['steel'],font=font(22))
    for tile in tile_spec['tiles']:
        key=tile['id']; image=tiles[key]
        assert image.size==(64,64) and image.getchannel('A').getextrema()==(255,255)
        path=ASSETS/f'maps/{PACK}/tiles/{key}.png'
        save(image,path)
        records.append(asset_record(key,image,path,'tile',group='tiles',name=tile['nameZh'],repeatAxes=tile['tileAxes']))
        atlas.alpha_composite(image,(tile['col']*64,tile['row']*64))
        x,y=tile['col']*256+32,tile['row']*232+48
        for j in range(3 if tile['tileAxes']=='xy' else 1):
            for i in range(3):
                tile_board.paste(image.convert('RGB'),(x+i*64,y+j*64+(64 if tile['tileAxes']=='x' else 0)))
        td.text((x-22,y+196),tile['nameZh']+('（仅横向）' if tile['tileAxes']=='x' else ''),font=font(12),fill=P['steel'])
    path=ASSETS/f'maps/{PACK}/atlas_materials.png'
    save(atlas,path)
    records.append(asset_record('atlas_materials',atlas,path,'atlas',group='atlases',name='材质图集',cellSize=64,columns=4,rows=4))
    save(tile_board,PREVIEWS/'material_tiling.png')
    scenes=classroom_scenes.build_scenes(sprites,tiles)|circulation_scenes.build_scenes(sprites,tiles)
    assert set(scenes)=={scene['id'] for scene in scene_spec['scenes']}
    overview=Image.new('RGB',(1536,1470),'#EAE8DF')
    od=ImageDraw.Draw(overview)
    od.text((24,12),'校园实拍 · 六景像素美术',font=font(30),fill=P['steel'])
    for n,spec in enumerate(scene_spec['scenes']):
        key=spec['id'];image=scenes[key]
        assert image.mode=='RGBA' and image.size==(768,432)
        assert image.getchannel('A').getextrema()==(255,255),key
        path=ASSETS/f'maps/{PACK}/map_{key}.png'
        save(image,path)
        record=asset_record(key,image,path,'scene',group='scenes',name=spec['titleZh'],lighting=spec['lighting'],integratedInGame=False)
        records.append(record)
        preview=image.resize((1536,864),Image.Resampling.NEAREST)
        assert preview.resize(image.size,Image.Resampling.NEAREST).tobytes()==image.tobytes()
        save(preview,PREVIEWS/f'{key}_2x.png')
        x,y=(n%2)*768,(n//2)*466+64
        overview.paste(image.convert('RGB'),(x,y))
        od.text((x+28,y+432),spec['titleZh'],font=font(18),fill=P['steel'])
    save(overview,PREVIEWS/'scene_overview.png')
    checks.append('16 opaque 64x64 material tiles; 3x3 surface and 1x3 strip repeat previews; 4 atlases exported without padding changes.')
    checks.append('6 opaque 768x432 scenes; all 1536x864 previews are exact nearest-neighbor 2x copies.')
    light=Image.new('RGBA',(768,432))
    overlay=warm_window_light(light)
    path=ASSETS/f'sprites/fx/{PACK}/fx_campus_window_sunlight.png'
    save(overlay,path)
    records.append(asset_record('fx_campus_window_sunlight',overlay,path,'overlay',group='lighting',name='窗边暖阳独立光照层',alpha='stepped_translucent'))
    delivery=dict(schemaVersion=1,packId=PACK,status='drawn_and_exported',method='local_native_pixel_drawing',
                  source='client/tools/art/campus_pixel/',palette='palette.json',
                  noteZh='照片参考的本地像素绘制；整景为构图参考，独立组件和材质待按正式地图几何接入。',
                  counts=dict(scenes=6,sprites=50,tiles=16,atlases=4,lightingOverlays=1),
                  assets=records)
    dump(DOCS/'delivery.json',delivery)
    dump(DOCS/'validation.json',dict(schemaVersion=1,method='Pillow export validation and visual review',checks=checks,
                                    totalPng=len(records),runtimeCodeChanged=False))
    build_gallery(delivery)
    # Update the earlier planning records to reflect the actual local method.
    component_spec.update(status='delivered_local_pixel_art',actualMethod='local_native_pixel_drawing',
                          generatedImages=[a['path'] for a in records if a['group'] in ('furniture','architecture','fixtures')],
                          totalDeliveredComponents=48,bonusComponents=2,deliveryManifest='delivery.json')
    for sheet in component_spec['sheets']:
        sheet.update(status='delivered_local_pixel_art',actualAtlasPath=next(a['path'] for a in records if a['id']==sheet['id']))
    component_spec['sheetGeometry'].update(background='transparent',alphaStatus='native_binary_alpha',
        postprocessPlan='直接在128²原生透明画布绘制；无需去背或缩小AI图片。原API字段保留为早期方案记录，以delivery.json为成品依据。')
    dump(DOCS/'components.json',component_spec)
    tile_spec.update(status='delivered_local_pixel_art',actualMethod='local_native_pixel_drawing',
                     generatedImages=[a['path'] for a in records if a['group']=='tiles'],deliveryManifest='delivery.json')
    dump(DOCS/'tiles.json',tile_spec)
    scene_spec.update(status='delivered_local_pixel_art',actualMethod='local_native_pixel_drawing',deliveryManifest='../delivery.json')
    dump(DOCS/'prompts/scenes.json',scene_spec)
    archive=ROOT/f'artifacts/{PACK}/{PACK}.zip'
    archive.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for asset in records:
            z.write(ASSETS/asset['path'],'assets/'+asset['path'])
        for name in ('delivery.json','palette.json','validation.json'):
            z.write(DOCS/name,name)
        z.writestr('README.md', '# 校园实拍像素美术包\n\n六张整景、50件透明物件、16种材质、四张图集与一张暖阳层。\n\n打开 `gallery.html` 离线浏览全部 PNG；原图在 `assets/`，总览和桌椅结构在 `previews/`，尺寸、锚点和哈希见 `delivery.json`。\n\n源文件保留在 `source/`，重绘只需 Python 与 Pillow，无 API、密钥或原始照片依赖：\n\n```powershell\ncd source\npython client/tools/art/build_campus_pack.py\n```\n\n重绘结果写入 source 下的资源目录、预览目录与 artifacts 资源包。素材尚未接入正式游戏地图，登记时请遵守项目共享资源清单约定。\n')
        z.writestr('gallery.html',(DOCS/'gallery.html').read_text(encoding='utf-8').replace('../../../client/public/assets/','assets/'))
        for source in Path(__file__).parent.joinpath('campus_pixel').glob('*.py'):
            z.write(source,'source/client/tools/art/campus_pixel/'+source.name)
        z.write(Path(__file__),'source/client/tools/art/build_campus_pack.py')
        for name in ('components.json','tiles.json','palette.json','README.md','prompts/scenes.json'):
            z.write(DOCS/name,'source/docs/art/campus_20261023/'+name)
        for prompt in (DOCS/'prompts').glob('*.txt'):
            z.write(prompt,'source/docs/art/campus_20261023/prompts/'+prompt.name)
        z.write(PREVIEWS/'scene_overview.png','previews/scene_overview.png')
        z.write(PREVIEWS/'furniture_detail.png','previews/furniture_detail.png')
    print(json.dumps(dict(scenes=6,sprites=50,tiles=16,atlases=4,lightingOverlays=1,
                          totalPng=len(records),zip=str(archive),zipBytes=archive.stat().st_size),ensure_ascii=False))


if __name__=='__main__':
    main()
