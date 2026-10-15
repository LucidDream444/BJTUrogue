"""把玩家持枪图集拆成三层：身体 / 手臂 / 枪械，运行时用代码拼回去。

## 为什么这么拆

原图是**一把武器一张图集**，于是每加一把枪就要多画一整套身体和手臂 ——
而实测那 5 张步枪躯干是**逐字节相同**的，手臂也只有枪那一块不同。
按原样一张一张切，等于把同一份躯干复制 5 遍（之前就是这么错的）。

拆成三层之后：

| 层 | 张数 | 复用 |
|---|---|---|
| 身体 | 4（步枪/手枪 × 站立/奔跑） | 步枪那 5 把共用 |
| 手臂 | 4（同上；手枪那两张的枪没拆，见下） | 步枪那 5 把共用 |
| 枪械 | 5（每把步枪一张） | —— |

**新增一把步枪只要加 1 张图**，而不是 2 张。

## 枪怎么从手臂里认出来

**跨武器像素比对**：同一状态下 5 把步枪的图集逐像素比，**变的那块就是枪**
（实测占手臂带约 35%）。比按颜色认可靠得多 —— 试过按颜色，近黑的描边
（和头发同色）、flare 的黄枪、smg 的橙枪，全都骗过判据。

枪是**刚体**：实测每一帧的包围盒都是 24×17，位置变化与 `combat.json` 的
`gunMuzzles` 逐帧位移**完全同步**。所以**不需要新增偏移表** ——
渲染时枪的逐帧位置直接从 `gunMuzzles` 推。

## 手枪为什么特殊

手枪（pencil）只有一把武器，**没有第二把可比对**，也就没有「跨武器复用」可言。
所以它的枪不拆，留在手臂层里 —— 少 2 张图、少一个分支。

## 切分线只能手填

`headCut` / `torsoCut` **别再去试自动检测**，三条路都试过并失败（见 SPECS 的注释）。
填错会啃掉脸 —— 这次就是玩的人先发现的，比脚本先发现。
"""
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib, json

import numpy as np

client = Path(__file__).resolve().parents[5]
player = client / 'public/assets/sprites/player'

# 分组：几把武器共用一套身体和手臂。只有一把的组不拆枪。
GROUPS = {
    'rifle': ['pulse', 'venom', 'flare', 'rail', 'smg'],
    'pencil': ['pencil'],
}

# 枪只从**这一个状态**导出，且一个分组只导一次。
#
# ⚠️ 两个状态各导一次会**互相覆盖同名文件**（`player_gun_pulse.png`），
#    谁后跑谁赢 —— 于是另一个状态的枪位置就全错了。这个坑踩过。
#
# 枪是刚体，枪口位置就是枪的位置，所以另一个状态的位置差可以直接从
# `combat.json` 的 `gunMuzzles` 推：`muzzle[状态][帧] - muzzle[射击][0]`。
GUN_REFERENCE_STATE = 'shoot'

# (分组, 状态) → sheet key 模板、帧宽高、帧数、手臂带 bandY0/bandY1、
#                 头部/躯干分界 splitRow、headCut、torsoCut、补齐宽度 fill
#
# ⚠️ headCut / torsoCut 只能手填：**头和枪在同样的行里横向重叠**
#    （步枪射击第一帧：脸到 x≈55、枪从 56 开始，而头顶几行头发伸到 58），
#    竖切分不开、颜色又分不出来。试过并放弃的自动方案：
#      ① 按「最右几列最常见的颜色」认枪 → 认到近黑描边，和头发同色，一匹配就啃头
#      ② 按「最饱和的颜色」认 → flare 的黄枪 (233,196,75)、smg 的橙枪骗过肤色判据
#      ③ 从精灵顶端往下量头宽 → 后坐帧里枪会抬到头部高度
SPECS = {
    # ⚠️ 手臂带要**完整覆盖枪的纵向范围**（实测步枪射击是 y∈[33,53]）。
    #    带口窄一行，那一行的枪像素就会留在身体层里、不跟着手臂转 —— 表现为「枪少一横条」。
    ('rifle', 'shoot'):  ('player_{w}_shoot_equipped', 96, 80, 16, 33, 53, 45, 56, 52, 6),
    ('rifle', 'run'):    ('player_{w}_run_equipped',   96, 80, 14, 32, 52, 43, 62, 56, 6),
    ('pencil', 'shoot'): ('player_student_shoot',      72, 72, 16, 34, 48, 43, 55, 50, 5),
    ('pencil', 'run'):   ('player_student_run_gun',    71, 71, 14, 33, 48, 42, 58, 46, 5),
}
# 最后一个数是 `fill`：躯干被切走后**要补回多少列**（从 torsoCut 往右算）。
# 只能手填 —— 试过从带外相邻行推轮廓：**裙子那行比躯干本身窄**，推出来会短 4 列；
# 带顶那行在跑动姿势里已经被手/枪占了，推出来又会宽一大截。

def silhouette_right(frame, fw, y):
    """某一行最靠右的不透明像素 —— 用来量**手臂带之外**那几行的身体轮廓。"""
    xs = [x for x in range(fw) if frame[y, x, 3] > 0]
    return max(xs) if xs else 0


layers, notes = [], {}

for (group, state), spec in SPECS.items():
    tmpl, fw, fh, count, by0, by1, split, head_cut, torso_cut, fill = spec
    weapons = GROUPS[group]
    sheets = []
    for w in weapons:
        im = Image.open(player / (tmpl.format(w=w) + '.png')).convert('RGBA')
        # ⚠️ 列数**从图里算，不能写死**：步枪跑动是 7 列 × 2 行（672×160），
        # 射击是 4 列 × 4 行（384×320）。写死 4 会把跑动后半段读错位或读出界，
        # 生成的图层整片是空的 —— 表现是「人物一走起来，身体和脸就没了」。
        cols, rows = im.width // fw, im.height // fh
        if cols * rows < count:
            raise SystemExit(f'{group}/{state}/{w}: 图集 {im.size} 装不下 {count} 帧')
        sheets.append((cols, rows, np.array(im).astype(int)))

    cols0, rows0, base = sheets[0]
    body_img = Image.new('RGBA', (fw * cols0, fh * rows0), (0, 0, 0, 0))
    arm_img = Image.new('RGBA', body_img.size, (0, 0, 0, 0))
    gun_imgs = {w: None for w in weapons} if len(weapons) > 1 and state == GUN_REFERENCE_STATE else {}
    gun_box = None
    vary_all = np.zeros((fh, fw), bool)

    for i in range(count):
        r, c = divmod(i, cols0)
        frames = [a[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] for _, _, a in sheets]
        f0 = frames[0]
        # 跨武器差异 = 枪。只有一把武器时全 False（= 不拆枪，枪留在手臂层里）
        #
        # ⚠️ 判据要写成「**任意一把**在此不透明，且**不是所有武器都相同**」，
        #    不能拿第一把的不透明区去限定差异 —— 某把枪比别的枪伸出一格、
        #    而那一格在第一把上是透明的时，那些像素会被漏掉（画出来就是枪缺一角）。
        any_opaque = np.zeros((fh, fw), bool)
        all_same = np.ones((fh, fw), bool)
        for fr in frames:
            any_opaque |= (fr[:, :, 3] > 0)
        for o in frames[1:]:
            all_same &= (f0 == o).all(axis=2)
        vary = any_opaque & ~all_same

        # ---- 身体层：切分线左侧，切走的那块**补到躯干原来的轮廓边** ----
        #
        # ⚠️ 只补固定几像素是不够的：**躯干比切分线还要往右伸几个像素**，
        #    补少了手臂一转开、身体侧面就缺一块直上直下的口子。
        #
        # 轮廓边从**手臂带上下相邻的两行**插值推出来 —— 那两行没有手臂，
        # 量到的就是身体自己的边（上面是头发/肩，下面是裙子）。
        # 补出来的最后 1 像素用轮廓色，免得补出来是一块没有描边的平色。
        body_frame = f0.copy()
        # ⚠️ 补洞的边界**只能从手臂带下面那一行推**（那里是裙子，一定没有手臂）。
        #    用带顶那一行会出事：跑动姿势里带顶那行已经被手/枪占了，推出来的边界
        #    比身体宽一大截，会把头发也一起补出来。
        bottom_edge = silhouette_right(f0, fw, min(fh - 1, by1 + 1))
        outline = f0[min(fh - 1, by1 + 1), min(fw - 1, bottom_edge)]
        for y in range(by0, by1 + 1):
            cut = head_cut if y < split else torso_cut
            # 头部各行：切分线本来就在头的右边，只需把啃掉的 1~2 列补回；
            # 躯干各行：要补到躯干原来的轮廓边，否则手臂一转开侧面就是个缺口。
            # 头部各行只补 1 像素：切分线本来就贴着头的右缘，多补会把头发一起补宽
            # （跑动那套实测被补到 x=64，比头宽 3 列）。
            # 躯干各行补到 `torsoCut + fill`；下面那圈 `f0[y,x,3]==0` 的 continue
            # 保证补出来的不会越过原图自己的轮廓。
            target = cut if y < split else torso_cut + fill
            source = None
            for x in range(cut - 1, -1, -1):
                if f0[y, x, 3] > 0:
                    source = f0[y, x]
                    break
            for x in range(cut, fw):
                if f0[y, x, 3] == 0:
                    continue
                if source is None or x > target:
                    body_frame[y, x] = (0, 0, 0, 0)
                elif x == target:
                    body_frame[y, x] = outline
                else:
                    body_frame[y, x] = source

        # ---- 手臂层：切分线右侧、且**不随武器变化**的那部分 ----
        #
        # ⚠️ 必须**从零开始按掩码取**，不能「复制整帧再擦掉不要的」。
        #    擦的时候只擦得到 x>=cut，**切分线左边的身体会留在手臂层里** ——
        #    那一片躯干（衬衫那一大块）就会跟着手臂一起转。
        #    这个错合成测试抓不到：rotation=0 时它正好压在身体上、逐像素完全一致，
        #    一转才露馅。所以下面还有一道「手臂层的包围盒必须在切分线右侧」的断言。
        arm_frame = np.zeros_like(f0)
        for y in range(by0, by1 + 1):
            cut = head_cut if y < split else torso_cut
            for x in range(cut, fw):
                if f0[y, x, 3] > 0 and not vary[y, x]:
                    arm_frame[y, x] = f0[y, x]

        body_img.paste(Image.fromarray(body_frame.astype(np.uint8)), (c * fw, r * fh))
        arm_img.paste(Image.fromarray(arm_frame.astype(np.uint8)), (c * fw, r * fh))

        # ---- 枪：每把武器一张，取第 0 帧那份；逐帧位置由 combat.json 的 gunMuzzles 推 ----
        vary_all |= vary
        if gun_imgs and i == 0:
            ys, xs = np.nonzero(vary)
            gun_box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
            for wi, w in enumerate(weapons):
                here = vary & (frames[wi][:, :, 3] > 0)
                g = np.zeros((fh, fw, 4), np.uint8)
                g[here] = frames[wi][here].astype(np.uint8)
                gun_imgs[w] = Image.fromarray(g)

    body_key, arm_key = f'player_body_{group}_{state}', f'player_arm_{group}_{state}'
    body_img.save(player / f'{body_key}.png')
    arm_img.save(player / f'{arm_key}.png')
    for key, im in ((body_key, body_img), (arm_key, arm_img)):
        layers.append({
            'key': key, 'role': key.split('_')[1], 'group': group, 'state': state,
            'frameWidth': fw, 'frameHeight': fh, 'count': count,
            'sha256': hashlib.sha256((player / f'{key}.png').read_bytes()).hexdigest(),
        })
    for w, gi in gun_imgs.items():
        if gi is None:
            continue
        key = f'player_gun_{w}'
        gi.save(player / f'{key}.png')
        layers.append({
            'key': key, 'role': 'gun', 'weapon': w, 'group': group, 'state': state,
            'frameWidth': fw, 'frameHeight': fh, 'count': 1, 'box': gun_box,
            'sha256': hashlib.sha256((player / f'{key}.png').read_bytes()).hexdigest(),
        })
    # 断言：手臂带必须**完整覆盖枪的纵向范围**。窄一行的话，那一行的枪像素会留在
    # 身体层里、不跟着手臂转 —— 表现是「枪少一横条」，很难往回查。
    if len(weapons) > 1:
        ys = np.nonzero(vary_all)[0]
        if len(ys) and (ys.min() < by0 or ys.max() > by1):
            raise SystemExit(
                f'{group}/{state}: 枪的纵向范围是 y∈[{ys.min()},{ys.max()}]，'
                f'而手臂带是 [{by0},{by1}] —— 带口要把枪完整包住'
            )

    # 断言：手臂层不许有切分线左边的像素 —— 那是身体，会跟着手臂一起转。
    # 合成测试看不出来（rotation=0 时它压在身体上），所以在这里单独盯。
    a = np.array(arm_img).astype(int)
    xs = np.nonzero(a[:, :, 3] > 0)[1]
    left = int(xs.min() % fw) if len(xs) else fw
    if left < torso_cut - 1:
        raise SystemExit(
            f'{group}/{state}: 手臂层伸到了 x={left}，越过切分线({torso_cut}) —— '
            f'切分线左边的身体混进手臂层了，那一片躯干会跟着手臂转'
        )
    notes[f'{group}_{state}'] = {
        'weapons': weapons, 'gunBox': gun_box, 'frames': count,
        'armLeft': left, 'torsoCut': torso_cut,
    }

report_path = client.parent / 'artifacts/arm-split.json'
report_path.write_text(json.dumps({'layers': layers, 'notes': notes}, ensure_ascii=False, indent=2),
                       encoding='utf8')
print(json.dumps({'files': len(layers), 'notes': notes}, ensure_ascii=False))

# ---- 校验对照图：身体 / 手臂各一套前 4 帧，看有没有破洞或残留 ----
Z, pad = 5, 14
rows = []
for (group, state) in SPECS:
    fw, fh = SPECS[(group, state)][1], SPECS[(group, state)][2]
    for role in ('body', 'arm'):
        key = f'player_{role}_{group}_{state}'
        im = Image.open(player / f'{key}.png').convert('RGBA').crop((0, 0, fw * 4, fh))
        bg = Image.new('RGBA', im.size, (255, 0, 255, 255))
        bg.alpha_composite(im)
        rows.append((key, bg))
cw = max(c.width for _, c in rows) * Z
sheet = Image.new('RGB', (pad * 2 + cw, pad + sum(c.height * Z + 20 + pad for _, c in rows)),
                  (25, 25, 35))
d = ImageDraw.Draw(sheet)
y = pad
for label, canvas in rows:
    d.text((pad, y), label + '  (前4帧)', fill=(255, 255, 255))
    y += 16
    sheet.paste(canvas.resize((canvas.width * Z, canvas.height * Z), Image.NEAREST).convert('RGB'),
                (pad, y))
    y += canvas.height * Z + pad
sheet.save(client.parent / 'artifacts/arm-split-contact.png')
