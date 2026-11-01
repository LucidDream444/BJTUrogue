"""Fourteen distinct compositions, painted on a shared 320x180 pixel grid.

The exhausted examinee wears a warm brown cardigan. The playable freshman wears
a blue university jacket. This distinction is kept through all shared scenes.
Captions are intentionally absent: Chinese story text belongs to story.json/UI.
"""
from __future__ import annotations
import math
from PIL import Image, ImageDraw, ImageOps
from .drawing import canvas, polygon, ellipse, line, arc, resize, stars, INK, PAPER, GOLD
from .sprites import berry, muscovy, final_boss

W,H=320,180
NIGHT=['#263b51','#405975','#76859a']
DUSK=['#b06e6f','#d6917a','#f0bd8b']


def sky(d, rect, warm=False):
    x0,y0,x1,y1=rect
    colors=DUSK if warm else NIGHT
    for y in range(y0,y1+1):
        q=min(2,(y-y0)*3//max(1,y1-y0+1))
        d.line((x0,y,x1,y),fill=colors[q])
    if warm:
        ellipse(d,(x1-32,y0+14,x1-11,y0+35),'#f6d5a0',None)
        for y in range(y0+20,y1,11):
            line(d,[(x0+4,y),(x0+23,y-1),(x0+46,y)],'#c3857b')
    else:
        ellipse(d,(x1-28,y0+10,x1-16,y0+22),'#d9dcc0',None)
        ellipse(d,(x1-25,y0+8,x1-13,y0+20),colors[0],None)
    # Distant campus skyline: brick teaching blocks and their illuminated windows.
    for x,bw,by in [(x0+3,35,y1-15),(x0+41,47,y1-24),(x0+91,33,y1-18)]:
        polygon(d,[(x,by+4),(x+bw,by+4),(x+bw,y1),(x,y1)],'#677b83' if warm else '#334c63')
        d.rectangle((x+3,by,x+bw-3,by+4),fill='#8b8c83' if warm else '#456074')
        for yy in range(by+7,y1-2,6):
            for xx in range(x+4,x+bw-3,7):
                d.rectangle((xx,yy,xx+2,yy+2),fill='#d8b88a' if warm else '#d1b783')


def window(d,box=(190,16,309,97),warm=False,branch=False):
    x0,y0,x1,y1=box
    d.rectangle((x0-4,y0-4,x1+4,y1+5),fill='#465967')
    sky(d,box,warm)
    line(d,[(x0,y0),(x1,y0),(x1,y1)],'#b8c5bc',2)
    mid=(x0+x1)//2
    for x in [x0,mid,x1]:line(d,[(x,y0),(x,y1)],'#c9cbb9' if warm else '#8babae',2)
    line(d,[(x0,(y0+y1)//2),(x1,(y0+y1)//2)],'#aebdb1',2)
    polygon(d,[(x0-8,y1+3),(x1+8,y1+3),(x1+12,y1+9),(x0-12,y1+9)],'#c6bfa9')
    # Curtains with deliberate alternating lit/shadow folds.
    for side in [-1,1]:
        xx=x0-12 if side<0 else x1+3
        polygon(d,[(xx,y0-7),(xx+9,y0-7),(xx+8,y1-10),(xx+1,y1-8)],'#526d83')
        for dx in [2,6]:line(d,[(xx+dx,y0-5),(xx+dx,y1-12)],'#7390a0')
    if branch:
        line(d,[(x1,y1-14),(x1-24,y1-24),(x1-43,y1-34),(x1-59,y1-47)],'#4e5455',3)
        for x,y in [(x1-21,y1-25),(x1-44,y1-35),(x1-53,y1-43)]:
            polygon(d,[(x,y),(x-9,y-6),(x-12,y-2),(x-5,y+2)],'#798c69',None)


def desk(d,box,books=True):
    x,y,w,h=box
    polygon(d,[(x,y),(x+w,y-3),(x+w+8,y+h),(x-7,y+h+4)],'#a77c5d')
    polygon(d,[(x-7,y+h+4),(x+w+8,y+h),(x+w+8,y+h+9),(x-7,y+h+13)],'#705748')
    line(d,[(x,y+2),(x+w-2,y)],'#d4b08a')
    for off in [6,15,26]:
        line(d,[(x+9,y+off),(x+w-7,y+off-3)],'#b88d68')
    if books:
        book(d,x+12,y+6,31,21)


def book(d,x,y,w=35,h=24,closed=False):
    if closed:
        polygon(d,[(x,y),(x+w,y-2),(x+w+2,y+h),(x+2,y+h+2)],'#526b7b')
        line(d,[(x+3,y+3),(x+w-2,y+1)],'#abc0b8')
        line(d,[(x+5,y+h),(x+w,y+h-1)],PAPER,2)
        return
    mid=x+w//2
    polygon(d,[(x,y+2),(mid,y+5),(x+w,y),(x+w+1,y+h),
               (mid,y+h+4),(x-1,y+h)],PAPER)
    line(d,[(mid,y+5),(mid,y+h+3)],'#ad9c7d')
    for k in range(3):
        yy=y+9+k*4
        line(d,[(x+3,yy),(mid-3,yy+2)],'#8e9a9e')
        line(d,[(mid+3,yy),(x+w-4,yy-2)],'#8e9a9e')
    # A red bookmark helps viewers recognize the same notebook through the story.
    polygon(d,[(mid-2,y+h),(mid+1,y+h),(mid+1,y+h+8),(mid-1,y+h+6),(mid-2,y+h+8)],'#b85f58',None)


def student_sprite(pose='study',rescuer=False,scale=1):
    im,d=canvas((72,86))
    coat='#427392' if rescuer else '#9b715d'
    coatlight='#6d9caa' if rescuer else '#bc9274'
    hair='#303c47' if rescuer else '#3c3539'
    skin='#e4b98d';skinlight='#f2cfaa'
    sleeping=pose in ['sleep','fever']
    if not sleeping:
        # Standing/seated upright bodies are never reused for a sleeping pose.
        polygon(d,[(23,54),(48,54),(51,78),(40,81),(35,66),(30,81),(18,79)],'#4c5b66')
        polygon(d,[(20,33),(33,28),(48,34),(54,60),(43,65),(21,61),(17,45)],coat)
        polygon(d,[(23,36),(28,33),(28,59),(22,57)],coatlight,None)
        line(d,[(35,36),(36,59)],'#6f5a51' if not rescuer else '#365b77')
    if sleeping:
        # A horizontal back disappears behind the desk. Side cheek is visibly
        # resting on crossed forearms; no standing torso, trouser or leg pixels.
        polygon(d,[(13,44),(18,36),(30,32),(43,34),(53,42),(56,51),
                   (44,56),(21,54)],coat)
        polygon(d,[(17,40),(28,36),(39,37),(43,42),(24,47)],coatlight,None)
        polygon(d,[(13,49),(18,46),(32,48),(51,54),(49,61),(28,58),(13,56)],coatlight)
        polygon(d,[(52,47),(59,53),(56,59),(37,61),(22,56),(25,50),(41,55)],coat)
        ellipse(d,(29,52,43,59),skin)
        ellipse(d,(39,48,51,54),skinlight)
        # Tilted head: rounded crown above, eye at lower-right, cheek on the arm.
        polygon(d,[(25,32),(33,28),(44,31),(50,39),(49,47),(43,53),
                   (34,52),(26,45)],skin)
        polygon(d,[(25,43),(21,36),(23,28),(30,24),(40,25),(47,29),
                   (49,38),(44,35),(41,40),(35,36),(33,42),(28,39)],hair)
        line(d,[(27,29),(32,27),(39,28)],'#64575a')
        line(d,[(41,44),(45,44),(46,42)],'#635054')
        line(d,[(43,49),(46,48)],'#b48574')
        d.point((48,42),'#efcc9c')
        if pose=='fever':
            line(d,[(45,33),(47,36),(46,39)],'#b0d6d4',2)
            line(d,[(36,47),(39,48)],'#ca7f6b',2)
    else:
        # Three-quarter face with glasses and scarf only on the tired examinee.
        polygon(d,[(31,24),(42,24),(43,34),(35,38),(28,31)],skin)
        ellipse(d,(23,6,47,31),skin)
        polygon(d,[(22,21),(21,11),(26,3),(38,1),(47,8),(49,18),
                   (43,14),(39,10),(34,15),(29,11),(25,21)],hair)
        line(d,[(25,10),(30,7),(39,6)],'#64575a' if not rescuer else '#50616b')
        if not rescuer:
            d.rectangle((27,19,34,23),outline='#5d5960')
            d.rectangle((38,18,44,22),outline='#5d5960')
            line(d,[(34,20),(38,20)],'#5d5960')
        else:
            line(d,[(28,20),(31,20)],'#354253');line(d,[(39,19),(42,19)],'#354253')
        line(d,[(35,24),(37,25)],'#be8f76')
        if pose in ['smile','wake']:
            line(d,[(32,28),(36,30),(40,27)],'#946a63')
        else:line(d,[(33,29),(39,28)],'#946a63')
        if not rescuer:
            polygon(d,[(27,31),(33,35),(44,31),(45,37),(35,40),(27,36)],'#74928b')
        else:
            d.rectangle((26,39,29,43),fill='#c8d8cb')
            line(d,[(25,35),(24,53)],'#abc0bc')
        if pose in ['study','smile']:
            polygon(d,[(21,39),(17,49),(24,54),(37,57),(41,52),(26,47)],coatlight)
            ellipse(d,(35,49,46,56),skin)
            polygon(d,[(47,39),(53,49),(50,53),(43,48)],coat)
        elif pose=='wake':
            polygon(d,[(22,40),(14,46),(13,28),(18,26),(21,39)],coatlight)
            ellipse(d,(12,23,19,31),skin)
            polygon(d,[(47,40),(56,32),(54,22),(59,21),(63,35),(53,49)],coat)
            ellipse(d,(52,17,59,25),skin)
        else:
            polygon(d,[(20,38),(13,59),(19,61),(26,43)],coatlight)
            polygon(d,[(48,37),(57,55),(53,60),(43,43)],coat)
            ellipse(d,(12,57,20,64),skin);ellipse(d,(50,55,57,62),skin)
    return resize(im,(round(72*scale),round(86*scale)))


def classroom(warm=False,nightmare=False):
    im=Image.new('RGBA',(W,H),'#d2c8ae' if warm else '#9ba6a3')
    d=ImageDraw.Draw(im)
    # Plaster texture, skirting, floor perspective, fluorescent fixture and clock.
    for y in range(4,110,9):
        for x in range((y*7)%13,W,19):d.point((x,y),'#d9cfb8' if warm else '#aeb8ae')
    d.rectangle((0,113,W,H),fill='#86887e' if warm else '#667b7b')
    line(d,[(0,111),(320,111)],'#586c70',3)
    for y in [124,141,165]:line(d,[(0,y),(320,y)],'#a6a38c' if warm else '#82928a')
    for x in range(-60,390,45):line(d,[(160+(x-160)*.55,113),(x,180)],'#6b7b7b')
    d.rectangle((12,27,122,80),fill='#3e5b56',outline='#6c6757',width=3)
    d.rectangle((16,31,118,76),outline='#829281')
    for y,w in [(41,54),(49,72),(57,43)]:line(d,[(23,y),(23+w,y)],'#acb69d')
    line(d,[(23,65),(53,64),(60,67),(89,64)],'#a8b098')
    d.rectangle((9,81,127,84),fill='#b7ab8c')
    d.rectangle((42,8,104,13),fill='#eef1ce',outline='#879a9a')
    line(d,[(43,14),(101,14)],'#74898e')
    ellipse(d,(139,22,161,44),'#d9d2b5','#536b72')
    ellipse(d,(142,25,158,41),'#ede4c3',None)
    line(d,[(150,26),(150,33),(156,35)],'#64737c')
    window(d,warm=warm)
    for x,y in [(5,105),(78,105),(151,107),(222,111)]:
        # Back rows, visible blue folded chairs beneath warm wood desks.
        polygon(d,[(x+4,y+8),(x+25,y+8),(x+28,y+27),(x+5,y+29)],'#3f6f87')
        line(d,[(x+7,y+11),(x+23,y+11)],'#7196a2')
        desk(d,(x,y,54,9),False)
        line(d,[(x+6,y+20),(x+5,y+36)],'#485d61',2)
    if warm:
        polygon(d,[(197,98),(309,98),(231,180),(54,180)],(246,202,123,45),None)
        for x in [205,244,281]:line(d,[(x,100),(x-91,178)],'#b7a683')
    if nightmare:
        # Color overlay is drawn onto a dedicated layer, preserving detailed room texture.
        veil=Image.new('RGBA',im.size,(40,27,65,95));im=Image.alpha_composite(im,veil);d=ImageDraw.Draw(im)
        for i in range(13):
            x=(i*47)%320;y=15+(i*29)%116
            page(d,x,y,9+i%4,angle=i*.4)
        for side in [-1,1]:
            line(d,[(160+side*130,180),(160+side*98,141),(160+side*112,110),
                    (160+side*78,88),(160+side*87,45)],'#5c496b',4)
    return im


def page(d,x,y,size=10,angle=0):
    coords=[(-size*.6,-size*.8),(size*.6,-size*.8),(size*.6,size*.8),(-size*.6,size*.8)]
    pts=[(x+px*math.cos(angle)-py*math.sin(angle),y+px*math.sin(angle)+py*math.cos(angle)) for px,py in coords]
    polygon(d,pts,'#d9cbb2','#8c7b87')
    for k in [-1,0,1]:line(d,[(x-size*.35,y+k*3),(x+size*.3,y+k*3)],'#929194')


def study():
    im=classroom();d=ImageDraw.Draw(im)
    person=student_sprite('study',scale=1.05);im.alpha_composite(person,(107,56))
    desk(d,(78,122,132,28));book(d,122,128,43,25)
    for i in range(3):
        polygon(d,[(82,129+i*3),(107,127+i*3),(109,132+i*3),(83,135+i*3)],['#758883','#ad6e5d','#7c8a9b'][i])
    ellipse(d,(182,132,192,141),'#a6b7ae')
    d.rectangle((183,121,191,135),fill='#d2d6ba',outline='#728686')
    line(d,[(169,133),(179,125)],'#ddad70',2)
    return im


def sleep():
    im=classroom();d=ImageDraw.Draw(im)
    # Foreground close-up, rather than reusing the wide establishing composition.
    desk(d,(30,115,244,43),False)
    person=student_sprite('sleep',scale=1.65);im.alpha_composite(person,(95,45))
    book(d,50,129,62,33)
    book(d,225,123,30,23,True)
    line(d,[(203,141),(216,128)],'#e1b17b',2)
    for x,y in [(218,143),(221,147),(214,148)]:d.point((x,y),'#68585a')
    return im


def nightmare():
    im=classroom(nightmare=True);d=ImageDraw.Draw(im)
    shadow=resize(final_boss('idle',0,size=128),(105,105));im.alpha_composite(shadow,(181,39))
    # Huge broken clock hangs over the sleeping examinee, indicating exam pressure.
    ellipse(d,(37,20,112,95),'#4a405e','#a993a0',2)
    ellipse(d,(44,27,105,88),'#34364e','#b19791')
    for i in range(12):
        a=i*math.tau/12
        line(d,[(75+math.sin(a)*25,57-math.cos(a)*25),
                (75+math.sin(a)*28,57-math.cos(a)*28)],GOLD)
    line(d,[(75,57),(74,34)],'#d8b890',2);line(d,[(75,57),(95,64)],'#d8b890',2)
    line(d,[(96,27),(84,45),(91,53),(81,69),(85,85)],'#d9ad9b',2)
    im.alpha_composite(student_sprite('fever',scale=1.05),(104,66))
    desk(d,(75,127,128,25),False);book(d,88,132,39,21)
    for x,y in [(128,82),(135,75),(144,80)]:
        arc(d,(x,y),(2,5),0,math.pi,'#c7b4cf')
    return im


def discover_student():
    im=classroom();d=ImageDraw.Draw(im)
    # The freshman arrives from the classroom door, wearing blue, not the examinee's brown.
    d.rectangle((7,27,74,116),fill='#4a565d',outline='#bac0ab',width=3)
    polygon(d,[(11,31),(56,44),(56,125),(11,112)],'#8c7863')
    d.rectangle((45,77,48,80),fill=GOLD)
    im.alpha_composite(student_sprite('stand',True,.93),(12,47))
    im.alpha_composite(student_sprite('fever',scale=.86),(179,69))
    desk(d,(159,125,122,22));book(d,170,130,32,18)
    line(d,[(51,44),(53,40),(56,44)],'#d5d6ba')
    return im


def lake(warm=False):
    im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im)
    sky(d,(0,0,319,86),warm)
    # Long campus library facade behind the lake and a brick path in front.
    polygon(d,[(28,53),(130,53),(139,87),(20,87)],'#647c7a' if warm else '#425a69')
    for x in range(35,128,9):
        line(d,[(x,58),(x,80)],'#d0b18a' if warm else '#819292',2)
    polygon(d,[(19,86),(141,86),(146,91),(14,91)],'#465e62')
    d.rectangle((0,91,W,148),fill='#6c9b98' if warm else '#36576c')
    for i in range(48):
        x=(i*47)%320;y=95+(i*13)%49
        line(d,[(x,y),(x+6+i%8,y)],'#bbbc94' if warm else '#64818b')
    d.rectangle((0,148,W,179),fill='#837968' if warm else '#4e5c60')
    for y in [155,166,178]:line(d,[(0,y),(320,y)],'#b29b78' if warm else '#6b7a75')
    for i in range(12):line(d,[(i*31,148),(i*31-20,180)],'#66766f')
    # Willow foliage and reeds frame both goose shots in the same recognizable place.
    line(d,[(307,0),(285,50),(287,143)],'#435c57',5)
    for k in range(8):
        line(d,[(289+k*3,18),(268+k*5,49),(266+k*5,78)],'#6c8261',2)
    for x in range(11,72,8):
        line(d,[(x,149),(x-5,135),(x-3,125)],'#526e5d')
    return im


def goose_icon(wings=False,size=84):
    im,d=canvas((64,64))
    # A white domestic goose; visually distinct from the black Muscovy enemy.
    for x in [28,37]:
        line(d,[(x,49),(x,56)],'#c98b4a',2)
        polygon(d,[(x-4,58),(x,55),(x+5,58)],'#e7a455')
    ellipse(d,(10,31,46,51),'#f1efda')
    ellipse(d,(15,31,40,43),'#ffffff',None)
    polygon(d,[(36,39),(34,25),(36,13),(43,12),(47,18),(43,27),(44,40)],'#e6e9da')
    ellipse(d,(35,8,48,20),'#f7f2dc')
    polygon(d,[(47,14),(58,17),(57,20),(47,20)],'#e8a152')
    ellipse(d,(45,11,49,15),'#e6a351',None);d.point((44,13),INK)
    if wings:
        for side in [-1,1]:
            polygon(d,[(28,37),(28+side*14,18),(28+side*23,11),
                       (28+side*21,28),(28+side*12,42)],'#e0e5d5')
            for k in range(4):line(d,[(28+side*9,34),(28+side*(19-k),17+k*4)],'#a5bcb8')
    else:
        polygon(d,[(17,36),(29,34),(36,38),(29,45),(17,43)],'#d8e1d4')
        for k in range(3):line(d,[(20+k*4,36),(20+k*3,42)],'#aebfb6')
    return resize(im,(size,size))


def discover_goose():
    im=lake();d=ImageDraw.Draw(im)
    # A warm fever-lit classroom window on the near bank draws the goose's attention.
    d.rectangle((200,40,264,111),fill='#6b655c',outline='#a7977b',width=2)
    d.rectangle((207,47,257,98),fill='#b19d7b')
    tiny=student_sprite('fever',scale=.48);im.alpha_composite(tiny,(213,62))
    line(d,[(230,47),(230,100)],'#d9c7a2',2)
    im.alpha_composite(goose_icon(size=79),(104,98))
    ellipse(d,(178,104,181,108),'#d9d1a4',None)
    return im


def discover_berry():
    im=Image.new('RGBA',(W,H),'#3d5367');d=ImageDraw.Draw(im)
    # Exterior viewpoint through glass; the branch and one red fruit own the foreground.
    d.rectangle((85,14,309,164),fill='#8a918b',outline='#ccd1b9',width=4)
    d.rectangle((92,22,302,154),fill='#a9ab94')
    im.alpha_composite(student_sprite('fever',scale=1.1),(154,58))
    desk(d,(138,127,134,25));book(d,151,132,42,20)
    for x in [93,199,302]:line(d,[(x,20),(x,156)],'#d3d3b9',3)
    line(d,[(90,87),(306,87)],'#c8ccb8',3)
    # Foreground branching has individual leaves with veins and a clearly single fruit.
    line(d,[(0,116),(48,91),(82,58),(119,42)],'#53574c',7)
    line(d,[(47,93),(74,110),(105,114)],'#6b6a52',3)
    for x,y,side in [(35,95,-1),(64,76,1),(84,56,-1),(101,49,1),(80,110,1)]:
        polygon(d,[(x,y),(x+side*15,y-12),(x+side*23,y-6),(x+side*14,y+2)],'#7c8d65')
        line(d,[(x,y),(x+side*18,y-7)],'#a9ac7b')
    im.alpha_composite(berry(size=48),(56,79))
    return im


def enter(kind):
    im=Image.new('RGBA',(W,H),'#27394e');d=ImageDraw.Draw(im)
    stars(d,seed=7,color='#8298a6',count=80)
    # Eight rising landings and seven connections communicate the eight-floor journey.
    for k in range(8):
        x=116+k*15;y=137-k*13
        polygon(d,[(x,y),(x+51,y-1),(x+62,y+6),(x+7,y+9)],'#59677b')
        line(d,[(x+1,y),(x+51,y-1)],'#adadb6')
        if k<7:
            for step in range(4):
                xx=x+30+step*3;yy=y-step*3
                line(d,[(xx,yy),(xx+17,yy)],'#84949e',2)
    im.alpha_composite(final_boss('idle',4,size=70),(228,3))
    # A portal in a broken classroom threshold anchors the transition.
    arc(d,(95,98),(43,62),math.pi*.8,math.pi*2.2,'#b5b7bb',3)
    arc(d,(95,98),(38,57),math.pi*.8,math.pi*2.2,'#6e91a1',2)
    polygon(d,[(0,157),(117,146),(156,180),(0,180)],'#766e68')
    for k in range(4):page(d,31+k*56,28+(k%2)*30,9,(-1)**k*.4)
    if kind=='student': im.alpha_composite(student_sprite('stand',True,.91),(53,79))
    elif kind=='goose': im.alpha_composite(goose_icon(size=84),(41,94))
    else:
        im.alpha_composite(berry(size=58),(58,111))
        for x,y in [(65,169),(104,166),(111,157)]:d.point((x,y),GOLD)
    return im


def wake():
    im=classroom(warm=True);d=ImageDraw.Draw(im)
    im.alpha_composite(student_sprite('wake',scale=1.25),(92,43))
    desk(d,(60,126,165,30),False);book(d,113,134,58,27)
    d.rectangle((78,128,94,136),fill='#829384',outline='#5c6c6a')
    # Warm window light reaches the same red-bookmark notebook.
    line(d,[(195,106),(110,153)],'#efd09c',2)
    return im


def ending_student():
    im=classroom(warm=True);d=ImageDraw.Draw(im)
    # Face-to-face classroom reunion; both people are visible and distinct.
    im.alpha_composite(student_sprite('smile',scale=1.07),(65,53))
    im.alpha_composite(ImageOps.mirror(student_sprite('smile',True,1.07)),(167,54))
    desk(d,(48,126,213,28),False)
    book(d,102,135,45,23);book(d,188,132,30,20,True)
    for x,y in [(74,127),(236,127)]:
        ellipse(d,(x,y,x+8,y+7),'#e4d5b2');line(d,[(x+2,y+2),(x+6,y+2)],'#b6a891')
    return im


def ending_goose():
    im=lake(warm=True);d=ImageDraw.Draw(im)
    # Broad lake, sunset reflection and a large spread-wing goose calling into the sky.
    for k in range(12):
        y=96+k*4;x=235-k*4
        line(d,[(x,y),(260+k*3,y)],'#dfbd7b' if k%2 else '#c7b681',2)
    im.alpha_composite(goose_icon(True,size=115),(105,66))
    for i in range(3):arc(d,(203,91),(10+i*5,8+i*4),-1,.3,'#e9d9a5')
    # The awakened student quietly watches from the near path.
    im.alpha_composite(student_sprite('stand',scale=.48),(31,113))
    return im


def ending_berry():
    im=classroom(warm=True);d=ImageDraw.Draw(im)
    im.alpha_composite(student_sprite('smile',scale=.96),(79,65))
    desk(d,(58,130,104,24),False);book(d,87,137,42,22)
    # A single fruit outside the window sways above the student's eyeline.
    line(d,[(320,44),(289,56),(268,51),(246,64)],'#6f6350',4)
    for x,y,side in [(299,51,1),(280,53,-1),(260,56,1)]:
        polygon(d,[(x,y),(x+side*12,y-11),(x+side*18,y-8),(x+side*12,y+1)],'#819165')
        line(d,[(x,y),(x+side*14,y-7)],'#afad78')
    im.alpha_composite(berry(size=43),(224,54))
    for k in range(3):line(d,[(270,78+k*5),(281,76+k*5),(287,77+k*5)],'#d9c592')
    return im


def confidence():
    im=classroom(warm=True);d=ImageDraw.Draw(im)
    # Wider, calmer composition: closed notebook, then an open clean page and firm pen.
    im.alpha_composite(student_sprite('smile',scale=1.15),(109,49))
    desk(d,(63,128,174,29),False)
    book(d,79,138,39,22,True);book(d,144,134,53,27)
    line(d,[(177,146),(184,134)],'#c49057',2)
    # Subtle protective canopy of campus trees outside the warm windows.
    for x,y in [(211,40),(236,36),(269,40),(291,34)]:
        ellipse(d,(x-10,y-7,x+11,y+9),'#839768',None)
        line(d,[(x,y+10),(x,y+29)],'#7c7b5d')
    # Frame hardware redrawn over exterior foliage.
    line(d,[(249,16),(249,97)],'#c9cbb9',2)
    line(d,[(190,56),(309,56)],'#c9cbb9',2)
    return im


def all_scenes():
    return {
        'ui_story_intro_study':study(),
        'ui_story_intro_sleep':sleep(),
        'ui_story_intro_nightmare':nightmare(),
        'ui_story_intro_discover_student':discover_student(),
        'ui_story_intro_discover_goose':discover_goose(),
        'ui_story_intro_discover_berry':discover_berry(),
        'ui_story_intro_enter_student':enter('student'),
        'ui_story_intro_enter_goose':enter('goose'),
        'ui_story_intro_enter_berry':enter('berry'),
        'ui_story_ending_wake':wake(),
        'ui_story_ending_student':ending_student(),
        'ui_story_ending_goose':ending_goose(),
        'ui_story_ending_berry':ending_berry(),
        'ui_story_ending_confidence':confidence(),
    }
