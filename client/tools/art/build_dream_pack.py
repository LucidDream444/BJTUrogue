"""Rebuild the complete campus-nightmare pixel pack using Pillow only.

Run: python client/tools/art/build_dream_pack.py
Boss-only refresh: python client/tools/art/build_dream_pack.py --bosses-only
No network, image service, source photos, Phaser, or test-arena imports are used.
Native animal pixels are 48x48, bosses and berry 64x64.
Sprites upscale with nearest-neighbor; every animation state exports real frames.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw
from dream_pack.drawing import sheet, checker, resize, font
from dream_pack.sprites import (ANIMAL_STATES, CAT_STATES, BERRY_STATES, all_frames,
    berry, muscovy, cat, vortex, first_boss, frost_boss, final_boss)

ROOT=Path(__file__).resolve().parents[3]
ASSETS=ROOT/'client/public/assets'
DOCS=ROOT/'docs/art/dream_20261102'


def save(image,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    data=io.BytesIO()
    image.save(data,format='PNG',optimize=True)
    payload=data.getvalue()
    if not path.exists() or path.read_bytes()!=payload:
        path.write_bytes(payload)


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


def main(bosses_only=False):
    DOCS.mkdir(parents=True,exist_ok=True)
    assets=[];preview_frames=[];preview_labels=[]
    def exported(key,path,frames,columns,states,foot,rates=None):
        image=sheet(frames,columns)
        if not bosses_only or key.startswith(('boss_','enemy_stage2_')):
            save(image,ASSETS/path)
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
    if not bosses_only:
        save(berry(size=128),ASSETS/portrait)
    assets.append({'key':'player_red_berry_portrait','path':portrait,'kind':'image','size':[128,128],
                   'sha256':hashlib.sha256((ASSETS/portrait).read_bytes()).hexdigest()})
    # Promote existing shared-compatible 48x32 guns, byte-identical, without drawing variants.
    for weapon in ['pencil','pulse','venom','flare','rail','smg']:
        original=ASSETS/f'sprites/player/goose/player_goose_gun_{weapon}.png'
        target=ASSETS/f'sprites/weapons/weapon_{weapon}_base.png'
        target.parent.mkdir(parents=True,exist_ok=True)
        if not bosses_only and (not target.exists() or target.read_bytes()!=original.read_bytes()):
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
    save(contact(preview_frames,preview_labels),DOCS/'animation_contact.png')
    # Compact sample permits visual iteration without opening the full contact sheet.
    samples=[muscovy('dash',1),cat('idle',1),cat('vanish',2,6),first_boss('idle',0,4),
             frost_boss('idle',3),final_boss('idle',3),berry(size=96)]
    save(contact(samples,['Muscovy dash','Nightmare cat','Normal cat / void','Coursework overload',
                         'Exam-paper kite','Exam-clock nightmare','Single berry'],7,160),DOCS/'sprite_sample.png')
    boss_samples=[resize(first_boss('idle',0,4),(256,256)),
                  resize(frost_boss('idle',3),(256,256)),resize(final_boss('idle',3),(256,256))]
    save(contact(boss_samples,['Coursework overload / textbook stack','Exam-paper kite / red corrections',
                              'Exam-clock nightmare / no human form'],3,280),DOCS/'boss_preview.png')
    boss_indices=[i for i,label in enumerate(preview_labels) if label.startswith(('boss_','enemy_stage2_'))]
    save(contact([preview_frames[i] for i in boss_indices],
                 [preview_labels[i] for i in boss_indices],8,142),DOCS/'boss_animation_contact.png')
    metadata={'schemaVersion':1,'pack':'campus_dream_20261102','source':'Locally authored pixel art; Pillow only; user photo-referenced anatomy',
              'command':'python client/tools/art/build_dream_pack.py','filter':'NEAREST',
              'assets':assets,
              'notes':['Berry body frames contain no weapon/arms and no baked hop displacement.',
                       'Muscovy direction offsets are right0/down32/left64/up96.',
                       'Public guns are byte-identical promotions of existing 48x32 layers.',
                       'Boss revision 2026-11-03: textbook overload, corrected-exam origami bird, and nonhuman exam clock.',
                       'All boss canvases, state grids, paths and ground anchors are unchanged.']}
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
            if asset['key'].startswith(('boss_','enemy_stage2_')):
                # Motion cannot leave the canvas; a transparent death frame is valid.
                for frame in frames:
                    bounds=frame.getbbox()
                    assert bounds is None or (bounds[0]>0 and bounds[1]>0 and bounds[2]<fw and bounds[3]<fh)
                    assert resize(resize(frame,(64,64)),(fw,fh)).tobytes()==frame.tobytes()
                record['transparentPerimeter']=True
                record['nativePixelScale']=2
        report.append(record)
    (DOCS/'quality_report.json').write_text(json.dumps({'schemaVersion':1,'assets':report,
        'totalBytes':sum(a['bytes'] for a in report)},indent=2)+'\n',encoding='utf-8')
    (DOCS/'README.md').write_text('''# 校园梦境像素美术交付

从仓库根目录重建：`python client/tools/art/build_dream_pack.py`，需要 Pillow。
`--bosses-only` 仅重建七张首领图集和交付预览/报告，不写角色、动物、武器或特效。

## 2026-11-03 参考图重绘

番鸭按用户提供的校园照片画为白头白胸、黑背白翼斑、红色面瘤与粉灰扁嘴。
蓄力与冲刺四个方向均保持侧身展翅扑击，实际移动方向由锁定向量决定。
小红果只保留深色像素眼与眨眼，不画眼白、虹膜或写实高光。
首领分别为课本作业堆、考卷折纸鸟、破裂考场钟盘与试卷纸涡，全部没有人形。

动物原生48×48、红果与首领原生64×64，均最近邻放大。图集、状态帧与地面锚点沿用。
动画身体锚点：番鸭与猫(48,82)、红果(32,56)、首领(64,116)。
红果跳跃由RedBerryPose统一作用于身体与枪，贴图不含手臂、枪或离地位移。
六把公共枪图与既有鹅枪逐字节一致，画布48×32、握点(12,16)、枪口(44,16)，原始朝右。

## 交付文件

- delivery.json：路径、尺寸、状态帧、锚点与SHA256。
- quality_report.json：实际文件、透明角、首领完整透明边界和原生像素缩放检查。
- sprite_sample.png / boss_preview.png：角色与首领对照。
- animation_contact.png / boss_animation_contact.png：动作逐帧接触表。

可编辑源稿在client/tools/art/dream_pack：sprites.py（番鸭/果实）、bosses.py（首领）。
全部使用本地Pillow绘画，无网络生成服务。游玩不需要安装Python或Pillow。

2026-11-03按用户要求移除全部开场、结局漫画及其资源与制作脚本；出发直接进入战斗，
通关直接进入结算。用户提供的原参考图片保留在原位置，不属于此交付包。
''',encoding='utf-8')
    print(json.dumps({'assets':len(assets),'delivery':str(DOCS/'delivery.json')},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bosses-only',action='store_true',help='Only refresh boss assets and delivery previews/reports.')
    main(bosses_only=parser.parse_args().bosses_only)
