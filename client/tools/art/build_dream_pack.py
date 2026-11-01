"""Rebuild the complete campus-nightmare pixel pack using Pillow only.

Run: python client/tools/art/build_dream_pack.py
No network, image service, source photos, Phaser, or test-arena imports are used.
Native animal pixels are 48x48, bosses 64x64, berry 64x64, stories 320x180.
Sprites upscale with nearest-neighbor; every animation state exports real frames.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw
from dream_pack.drawing import sheet, checker, resize, font
from dream_pack.sprites import (ANIMAL_STATES, CAT_STATES, BERRY_STATES, all_frames,
    berry, muscovy, cat, vortex, first_boss, frost_boss, final_boss)
from dream_pack.story import all_scenes

ROOT=Path(__file__).resolve().parents[3]
ASSETS=ROOT/'client/public/assets'
DOCS=ROOT/'docs/art/dream_20261102'


def save(image,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    image.save(path,optimize=True)


def state_table(states, rates=None):
    start=0;result={}
    for name,count in states:
        result[name]={'start':start,'count':count,
                      'frameRate':(rates or {}).get(name,8),
                      'loop':name in ['idle','walk','run','dash','spin','loop']}
        start+=count
    return result


def contact(frames,labels,columns=8,cell=118):
    rows=(len(frames)+columns-1)//columns
    im=Image.new('RGB',(columns*cell,rows*(cell+22)),'#e8e4d5');d=ImageDraw.Draw(im)
    for i,(frame,label) in enumerate(zip(frames,labels)):
        x=i%columns*cell;y=i//columns*(cell+22)
        bg=checker((cell,cell),8)
        size=min(cell-8,max(frame.size))
        pic=resize(frame,(size,size))
        bg.alpha_composite(pic,((cell-size)//2,(cell-size)//2))
        im.paste(bg.convert('RGB'),(x,y));d.text((x+4,y+cell+2),label,fill='#304653',font=font(11))
    return im


def main():
    DOCS.mkdir(parents=True,exist_ok=True)
    assets=[];preview_frames=[];preview_labels=[]
    def exported(key,path,frames,columns,states,foot,rates=None):
        image=sheet(frames,columns);save(image,ASSETS/path)
        entry={'key':key,'path':path,'kind':'spritesheet','frameSize':list(frames[0].size),
               'frameCount':len(frames),'columns':columns,'rows':image.height//frames[0].height,
               'foot':foot,'states':state_table(states,rates),
               'sha256':hashlib.sha256((ASSETS/path).read_bytes()).hexdigest()}
        assets.append(entry)
        # Every state is shown, including all recover and death transitions.
        state_start=0
        for state,count in states:
            for index in sorted(set([0,count//2,count-1])):
                preview_frames.append(frames[state_start+index]);preview_labels.append(f'{key} {state}:{index}')
            state_start+=count
        return entry
    red=all_frames(BERRY_STATES,berry)
    exported('player_red_berry_body','sprites/player/red_berry/player_red_berry_body.png',red,4,BERRY_STATES,[32,56],
             {'idle':4,'run':10,'shoot':16,'hurt':10,'death':8})
    portrait='sprites/player/red_berry/player_red_berry_portrait.png'
    save(berry(size=128),ASSETS/portrait)
    assets.append({'key':'player_red_berry_portrait','path':portrait,'kind':'image','size':[128,128],
                   'sha256':hashlib.sha256((ASSETS/portrait).read_bytes()).hexdigest()})
    # Promote existing shared-compatible 48x32 guns, byte-identical, without drawing variants.
    for weapon in ['pencil','pulse','venom','flare','rail','smg']:
        original=ASSETS/f'sprites/player/goose/player_goose_gun_{weapon}.png'
        target=ASSETS/f'sprites/weapons/weapon_{weapon}_base.png'
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(original.read_bytes())
        assets.append({'key':f'weapon_{weapon}_base','path':target.relative_to(ASSETS).as_posix(),
                       'kind':'image','size':[48,32],'grip':[12,16],'muzzle':[44,16],
                       'source':original.relative_to(ASSETS).as_posix(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    duck=[]
    for direction in ['right','down','left','up']:
        duck.extend(all_frames(ANIMAL_STATES,muscovy,direction=direction))
    duck_entry=exported('enemy_muscovy_body','sprites/enemies/enemy_muscovy_body.png',duck,8,
        ANIMAL_STATES*4,[48,82])
    duck_entry['directions']={'right':0,'down':32,'left':64,'up':96}
    duck_entry['states']=state_table(ANIMAL_STATES,{'idle':4,'walk':8,'windup':8,'dash':16,'recover':8,'hit':12,'death':10})
    exported('enemy_nightmare_cat_body','sprites/enemies/enemy_nightmare_cat_body.png',all_frames(CAT_STATES,cat),7,CAT_STATES,[48,82],
             {'idle':4,'walk':8,'windup':8,'spin':14,'recover':8,'hit':12,'purify':8,'vanish':8})
    for key,is_void in [('fx_nightmare_cat_vortex',False),('fx_nightmare_cat_void',True)]:
        exported(key,f'sprites/fx/{key}.png',[vortex(i,is_void) for i in range(8)],4,[('loop',8)],[48,82],{'loop':12})
    boss_states=[('attack' if state=='dash' else state,count) for state,count in ANIMAL_STATES]
    exported('boss_first_body','sprites/enemies/boss_first_body.png',all_frames(boss_states,first_boss),8,boss_states,[64,116],
             {'idle':4,'walk':7,'windup':8,'attack':12,'recover':8,'hit':12,'death':8})
    for action in ['idle','attack']:
        key=f'enemy_stage2_{action}'
        exported(key,f'sprites/enemies/stage2_boss/{key}.png',[frost_boss(action,i) for i in range(16)],4,[(action,16)],[64,116])
    for action in ['idle','walk','attack','poison']:
        key=f'boss_final_{action}'
        exported(key,f'sprites/enemies/final_boss/{key}.png',[final_boss(action,i) for i in range(16)],4,[(action,16)],[64,116])
    scenes=all_scenes()
    stories=Image.new('RGB',(1280,7*390),'#25394b');sd=ImageDraw.Draw(stories)
    for i,(key,scene) in enumerate(scenes.items()):
        target=ASSETS/f'ui/story/{key}.png'
        save(resize(scene.convert('RGB'),(1280,720)),target)
        x=i%2*640;y=i//2*390
        stories.paste(resize(scene.convert('RGB'),(640,360)),(x,y))
        sd.text((x+6,y+365),key,fill='#f2e7c2',font=font(15))
        assets.append({'key':key,'path':target.relative_to(ASSETS).as_posix(),'kind':'image',
                       'nativeSize':[320,180],'size':[1280,720],
                       'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    save(stories,DOCS/'story_contact.png')
    save(contact(preview_frames,preview_labels),DOCS/'animation_contact.png')
    # Compact sample permits visual iteration without opening the full contact sheet.
    samples=[muscovy('dash',1),cat('idle',1),cat('vanish',2,6),first_boss('idle',0,4),
             frost_boss('idle',3),final_boss('idle',3),berry(size=96)]
    save(contact(samples,['Muscovy dash','Nightmare cat','Normal cat / void','Lab mushroom',
                         'Frost paper wings','Exam nightmare','Single berry'],7,160),DOCS/'sprite_sample.png')
    metadata={'schemaVersion':1,'pack':'campus_dream_20261102','source':'Locally authored pixel art; Pillow only; user photo-referenced anatomy',
              'command':'python client/tools/art/build_dream_pack.py','filter':'NEAREST',
              'assets':assets,'storyCount':len(scenes),'captionsBaked':False,
              'notes':['Berry body frames contain no weapon/arms and no baked hop displacement.',
                       'Muscovy direction offsets are right0/down32/left64/up96.',
                       'Public guns are byte-identical promotions of existing 48x32 layers.',
                       'Story examinee wears brown; playable freshman wears blue.']}
    (DOCS/'delivery.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # Validate actual exports, then keep an inspectable quality report with the pack.
    report=[]
    for asset in assets:
        path=ASSETS/asset['path'];image=Image.open(path)
        assert hashlib.sha256(path.read_bytes()).hexdigest()==asset['sha256']
        record={'key':asset['key'],'size':list(image.size),'bytes':path.stat().st_size}
        assert max(image.size)<=2048
        if asset['kind']=='spritesheet':
            assert image.mode=='RGBA'
            fw,fh=asset['frameSize'];columns=asset['columns']
            frames=[image.crop((i%columns*fw,i//columns*fh,(i%columns+1)*fw,(i//columns+1)*fh))
                    for i in range(asset['frameCount'])]
            assert all(frame.getpixel((0,0))[3]==0 and frame.getpixel((fw-1,fh-1))[3]==0 for frame in frames)
            record['frameCount']=len(frames)
            record['uniqueFrames']=len({frame.tobytes() for frame in frames})
            record['transparentCorners']=True
            assert record['uniqueFrames']>1
        report.append(record)
    assert len(scenes)==14 and len({image.tobytes() for image in scenes.values()})==14
    (DOCS/'quality_report.json').write_text(json.dumps({'schemaVersion':1,'assets':report,
        'storyCount':14,'storyImagesDistinct':True,'totalBytes':sum(a['bytes'] for a in report)},indent=2)+'\n',encoding='utf-8')
    (DOCS/'README.md').write_text('''# 校园梦境像素美术交付

从仓库根目录重建：`python client/tools/art/build_dream_pack.py`，需要 Pillow。

本批为用户选定的本地逐像素绘制，不访问网络或图像生成服务。番鸭参考照片中的
红色面瘤、黑羽白颈与宽蹼；小红果参考单颗红果，身体不含手臂或枪械。
动物原生48像素、红果和首领原生64像素、故事原生320×180，全部以最近邻放大。

`delivery.json` 列出路径、图集行列、状态帧区间、播放速率、地面锚点及SHA256。
`quality_report.json` 校验实际尺寸、透明角、有效帧和14幅画面独立性。
`sprite_sample.png` 是透明底造型预览，`animation_contact.png` 覆盖全部状态，
`story_contact.png` 为14幕分镜，每幕只显示一次。

动画身体地面锚点：番鸭与猫(48,82)、小红果(32,56)、首领(64,116)。
红果跳跃高度由RedBerryPose统一作用于身体与枪，图片不烘焙离地位移。
六张公共枪图与已有鹅枪图逐字节一致，仅提升为公共资源，画布48×32，
握点(12,16)、枪口(44,16)、原始朝右；不新增按角色、角度或动作的武器版本。

14幕共用教室、红色书签笔记本与棕衣考研学子；可玩新生穿蓝色校服，与学子区分。
睡眠/发热状态为侧脸伏在桌面交叠前臂上，没有桌前站姿双腿。最终心魔是试卷和
破碎钟环包围的学生阴影，只有两只人形手臂。入梦分镜含八级悬空平台，
梦境8F不声称来自真实校园测绘。中文字幕由story.json与运行时UI提供，不画入图片。

## Rebuild notes

Rebuild from repository root: `python client/tools/art/build_dream_pack.py` (Pillow).

All drawings are locally authored pixel art with no network or generation service.
The supplied Muscovy photographs guide the black plumage, red facial caruncles,
white neck and webbed feet. The supplied fruit photograph guides one red berry.
Native art uses 48px animals, 64px berry/boss drawings and 320x180 story paintings;
all export scaling uses nearest-neighbor. Story captions are runtime UI text.

`delivery.json` lists runtime paths, canvas/frame grids, counts, anchors, states
and SHA256 values. `sprite_sample.png`, `animation_contact.png`, and
`story_contact.png` provide transparent checker previews and all story scenes.

Animal frames use a fixed foot at (48,82), berry (32,56), boss (64,116).
Berry jump height comes from RedBerryPose, not vertically shifted image frames.
The six common weapon PNGs are promoted byte-identical from existing goose gun
layers; grip=(12,16), muzzle=(44,16), canvas=48x32, native facing right.

The fourteen story paintings share the same classroom, red-bookmark notebook,
brown examinee and blue freshman. The eight floating landings mark the dream
finale; the seventh real floor remains unchanged. No claim is made that the
dream eighth floor is a measured real campus location.
''',encoding='utf-8')
    print(json.dumps({'assets':len(assets),'storyImages':len(scenes),'delivery':str(DOCS/'delivery.json')},ensure_ascii=False))


if __name__=='__main__':main()
