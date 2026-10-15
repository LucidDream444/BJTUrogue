/**
 * **D1 那三张手绘关的教室，整间铺进 D2 生成的房间里** —— `L` 键三档里的第二档。
 *
 * 文件名 `_` 开头 = **不进测试场菜单**（`arenaCatalog.ts` 的规则，`_classroomLook.ts` 同一条）。
 * 它住在 `joint/` 里，所以「跨域」这件事照样在 `architecture.test.ts` 的
 * `ARENA_FOLDER_DOMAINS` 表里显式写着（`joint: ['combat', 'procgen']`）。
 *
 * | 场子 | 怎么用 | 看什么 |
 * |---|---|---|
 * | `joint/d1d2_rooms` | `L` 键切到它 | 「D1 的教室长这样」和「D2 的房间是这么量的」叠在同一张图上 |
 *
 * ## 谁画什么（这一条最要紧）
 *
 * | 画面上 | 来源 |
 * |---|---|
 * | **整间教室**：地板、地毯、阳光、墙、黑板、窗、书架、盆栽 | **D1 手绘关的原图**（只把桌椅挖掉，见下） |
 * | 课桌 / 椅子的**样子** | **D1 手绘关**里那张桌椅贴图，按多边形切成「桌」和「椅」两块 |
 * | 课桌 / 椅子的**位置和大小** | **D2 的地图数据**（`Room.obstacles` 的矩形，一格不差） |
 * | **门**（门洞与门扇） | **D2 的观感层**（`_classroomLook` 的 `layers: 'doors'`） |
 *
 * ⚠️ 这一层**全是画上去的**，判定仍旧是 D2 那些矩形。这一档存在的意义是
 * 「让联调现场看起来像成品」，**不是**替换几何 —— 所以 `B` 键那一层（碰撞箱）
 * 在任何一档观感下都读同一份几何，随时可以切过去对照。
 *
 * ## 为什么「整间教室」是现成的：D1 已经替我们抠过一遍了
 *
 * `prepareFurnitureTextures()`（D1 的 `FurnitureTextures.ts`）为了给**它自己**的
 * 手绘关做「地板 + 能单独缩放的家具」，早就把那三张 PNG 里的桌椅**从地板上抹掉**
 * （拿一段地板条纹补回去），并给每件家具留了一张按轮廓剪好的贴图。
 * 这一层要的东西正是这两样，所以**一行抠图代码都不用写** —— 写一遍就是第二份
 * 会漂的抠图逻辑（补丁的位置、羽化的宽度、多边形的裁法全都会各说各的）。
 *
 * ## 每一关的**两个框**（都是手量的）
 *
 * | 框 | 是什么 | 怎么来的 |
 * |---|---|---|
 * | `inner` | 画上**地板**的那一块 | 直接抄 D1 自己的 `stage-collisions.json`：那儿写着哪块能走 |
 * | `crop` | 要留下的**整张画**（地板 + 四周的墙） | 手量的：贴着画的四条外边，切掉画外的黑底 |
 *
 * 摆法：**`inner` 的左上角对到房间内沿的左上角**，`inner` 铺满房间内沿
 * （`inflate(room.rect, -wallThickness / 2)` = 墙的内表面）。于是
 * **画上的地板边界和 D2 的门洞严丝合缝** —— 这正是这一档要看的对接。
 *
 * ⚠️ 长宽比是**横向、纵向各拉一次**的（`setScale(sx, sy)`，两个系数不相等）。
 * D2 的房间有三种宽（400 / 520 / 640）而手绘关只有一种，硬要等比就只能
 * 「裁掉一截」或「外面留一圈地板」——**那两种都会让 D2 的门悬在画出来的地板上**，
 * 也就是这一档最该避免的东西。代价写在「已知偏差」里。
 *
 * 量法：拿 `artcrop.mjs`（见改动日志）把某一块裁出来放大、叠上 64px 的坐标网格，
 * **用眼睛读**边界。⚠️ 坐标是 `sourceSize`（2048×1152）的，不是 PNG 自己的
 * 3840×2160 —— `prepareFurnitureTextures()` 第一步就把 PNG 重采样进 `sourceSize`
 * 那张画布，`bounds` / `polygons` 也全标在这个空间里。拿 PNG 的像素去量、
 * 再写进这张表，会整体放大 1.875 倍，而**它不报错**，只是整个房间错位。
 *
 * ## 桌椅为什么要**切成两块**（而不是整张贴上去）
 *
 * D1 那张贴图里椅子是**居中贴在桌子正下方**的（`front_left`：桌面 190 宽，
 * 椅子 96 宽、正好居中）。而 D2 的椅子是**桌子跨度里的某一格**（由种子抽，
 * 见 `gen/obstacles.ts` 的 ⚠️）—— 整张贴上去的话，画面上椅子跨在两格中间，
 * 而判定只堵其中一格，正是这一档最该避免的「看得见 ≠ 撞得到」。
 *
 * 所以切成两块，各按各的矩形摆：
 *
 * | 块 | 从贴图里切哪一块 | 摆到哪儿 | 缩放 |
 * |---|---|---|---|
 * | 桌 | 除椅子外**所有多边形的并集**（桌面 + 两条腿） | D2 的课桌矩形 | **按宽度铺满**，左上角对齐 |
 * | 椅 | **最靠下**的那个多边形 | D2 的椅子格 | **等比缩到放得进那一格**，居中 |
 *
 * 哪一块是椅子是**从几何读出来的**（y 最靠下），不是写死「最后一个多边形」——
 * 和 `model/furniture.ts` 读「哪把椅子属于哪张桌」是同一条思路：
 * 判据从几何来，就不存在「字段和几何各说各的」。
 *
 * ## 画上自带的开口和门扇要**补掉**（`patches`）
 *
 * 三张手绘图里各画着**一扇 D1 自己的门**（开着或关着），而 D2 的门是
 * **另按种子开的**，位置对不上。不补的话，东墙上会多出一扇「通往画外」的门，
 * 地上还会横着一片门板 —— 看起来像 D2 把门开错了地方。
 *
 * 两种补法，按**旁边有没有现成的干净材料**选：
 *
 * | 补法 | 什么时候用 | 怎么算 |
 * |---|---|---|
 * | `from` + 取一块 | 旁边有干净的地板 / 墙面 | 从 `from` 取一块铺到洞上；**一样大就是原样平移**，不一样大就缩放到洞那么大 |
 * | `axis` + 插值 | 旁边没有干净的一块 | 洞里每一行（列）都在它紧挨着的那两条边界线之间线性插过去 |
 *
 * `from` 有三种用法，各对应一种「干净材料」：
 *
 * - **原样平移**：补地板上的门扇。从**同一高度**的另一段地板拷过来，木地板的板缝才对得上
 *   （竖着插值会把板缝糊成一团，所以地板上的洞**不能用**插值）。也可以从**紧挨着下面**
 *   同一列的地板挪上来 —— 门口那一片连门槛的阴影都是同一套，接得最顺（第 3 关）。
 * - **从同高度的一条竖条横向拉满**：补墙。墙的看头在**竖方向**（墙皮 / 护墙板 /
 *   踢脚线一层一层），从旁边一条干净竖条（`from.width` 二三十像素）横着拉平，
 *   正好把这些层次原样留住（第 2 关北墙那扇门）。
 * - **从别处的一块素墙皮拉伸**：连「旁边一条」都没有时用（第 3 关那扇门贴着墙角，
 *   门框两边一边是画上去的书柜、一边直接是墙角）。素色墙皮横竖都拉得起；
 *   ⚠️ **带花纹的墙不能这么补**，花纹会被摊成一片糊。
 *
 * 插值是最后的办法，**只有洞的两条边界都是墙**时才成立（第 1 关东墙上那个门洞：
 * 洞上下都是同一段墙，洞又占满了整面墙的厚度，没有「旁边」可借）。
 * ⚠️ 边界列要是**门框 / 门扇**的话，插出来的整块洞会跟着门框的颜色走 ——
 * 表现是「明明补掉了，墙上还留着一扇门的形状」（第 3 关第一版就是这么翻的车，
 * 见改动日志）。那种情况就得把洞放宽到门框外面，改用 `from` 拉。
 *
 * ## 四处**已知的**偏差（都不是 bug，是这一档的取舍）
 *
 * 1. **长宽比会拉**：第 3 关的教室（2400×670 的画）塞进 400 宽的房间要横向压掉 41%，
 *    第 1 关塞进 640 反而横向拉长 12%。桌椅**不跟着拉**（按自己的比例画），
 *    所以房间越窄、桌椅看着越"胖"。
 * 2. **北墙会伸到房间外面**：`crop` 比 `inner` 高出来的那一截（含黑板那条墙）
 *    落在房间上沿之外 —— 一个房间高 280、画里的墙高 336，那条墙会比房间高出一截，
 *    悬在地图顶上的空白里。看着像「教室的墙立在地图边上」，不是错位。
 * 3. **桌椅贴图比判定框略小**：桌子的腿只到桌子那一排的 70% 处，
 *    椅子那 96×106 的图缩进 40×40 的格子里也留了点边。宁可小一圈：
 *    贴图**画到判定框外面**会让人以为那儿撞得到，而反过来只是「框比画大一点」。
 * 4. **画上贴着墙的柜子、标本柜、挂衣区是穿得过去的**：`stage-collisions.json`
 *    只把桌椅和讲台当成家具条目，那些柜子是**画在地板上的**，抠不掉。
 *    它们会落在房间的可走区里，而判定里没有它们 —— 白箱那一档（`B`）能看出这件事。
 */

import type Phaser from 'phaser'
import { prepareFurnitureTextures } from '@/domains/combat/FurnitureTextures'
import { STAGE_BACKGROUNDS } from '@/domains/combat/StageBackground'
import type { MapFurniture, StageCollisionConfig } from '@/domains/combat/StageGeometry'
import type { RoomsConfig } from '@/domains/procgen/config'
import { furnitureUnits, unitBox, type FurnitureUnit } from '@/domains/procgen/model/furniture'
import { inflate, left, top } from '@/domains/procgen/model/rect'
import type { Room } from '@/domains/procgen/model/types'
import type { Mapper } from '@/domains/procgen/presentation/floorplan'

/**
 * 源图里的一个矩形。**坐标系是 `stage-collisions.json` 的 `sourceSize`（2048×1152）**，
 * 见文件头「每一关的两个框」。
 */
interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 画上自带的一处「不该有的东西」（门洞、门扇），上色之前先补掉。见文件头那一节。 */
interface Patch {
  /** 要盖掉的那一块 */
  readonly hole: Box
  /**
   * 从哪儿取材料 —— 铺满 `hole`：一样大就是原样平移（补地板），
   * 小了就拉到洞那么大（补墙，见文件头）。给了这个就不看 `axis`。
   */
  readonly from?: Box
  /**
   * 没有干净材料时，顺着哪个轴把洞拉平：
   * - `'x'`：每**行**在洞左边和右边那两条**竖线**之间插值（东西向的墙用这个）
   * - `'y'`：每**列**在洞上边和下边那两条**横线**之间插值（南北向的墙用这个）
   *
   * ⚠️ 两条边界列得是**墙**，是门框 / 门扇的话整块洞会跟着那个颜色走（见文件头）。
   */
  readonly axis?: 'x' | 'y'
}

/**
 * 一关的画里，「教室」那间房的两个框 + 要补的洞。
 *
 * ⚠️ 这里的三组数字**全是手量的**，量法与注意事项见文件头。换图（美术重画）
 * 就得重量一遍 —— 表现上会看到的症状是「房间和门错位」或「画的角落露出黑底」。
 */
interface ArtRoom {
  /** 画上**地板**的那一块（贴到房间内沿上） */
  readonly inner: Box
  /** 要留下的**整张画**（地板 + 四周的墙，切掉画外的黑底） */
  readonly crop: Box
  readonly patches: readonly Patch[]
}

const ART: Record<number, ArtRoom> = {
  // 第 1 关（教室）：西墙挂着窗、北墙是黑板、东墙是书架；东墙正中画着一扇开着的门，
  // 门扇朝屋里甩（`x 1697..1806, y 420..733`），门洞下方的门槛在 `y 653..780`。
  1: {
    inner: { x: 380, y: 354, width: 1368, height: 694 },
    crop: { x: 246, y: 18, width: 1553, height: 1072 },
    patches: [
      // 门扇落在地板上那一条（`x 1697..1748`）：从同高度的干净地板平移过来
      // —— `x 1470..1522` 那一竖条是空的（桌椅的 `bounds` 都在它西边，地毯在它西边更远）
      { hole: { x: 1696, y: 420, width: 52, height: 360 }, from: { x: 1470, y: 420, width: 52, height: 360 } },
      // 门洞本身 + 门扇压在墙上的那一条（`x 1748..1799`，正是一整面墙的厚度，
      // 旁边没有可借的墙）：沿墙插值 —— 洞上下的两条边都是同一段东墙
      { hole: { x: 1748, y: 400, width: 51, height: 416 }, axis: 'y' },
    ],
  },
  // 第 2 关（实验室）：西墙是窗、北墙是黑板、东侧是标本柜和器材柜；
  // 北墙东头画着一扇**关着的**门（含门楣 `x 1642..1785`），门底下的门槛到 `y 405`。
  2: {
    inner: { x: 248, y: 350, width: 1562, height: 698 },
    crop: { x: 60, y: 16, width: 1785, height: 1074 },
    patches: [
      // 门 + 门楣 + 门槛：洞左右都是同一段墙（上半截是米色墙皮、下半截是深色护墙板），
      // 横着插过去正好接得上。⚠️ 左边界 `x 1639` 要的**就是墙**——
      // 器材柜的边在 `x 1575`，门框的左外沿在 `1642`，中间那几十像素是空的
      { hole: { x: 1640, y: 150, width: 148, height: 255 }, axis: 'x' },
    ],
  },
  // 第 3 关（教室）：画得比前两关「平」（墙薄）；北墙东头画着一扇开着的门
  // （门洞 `x 1755..1924, y 179..441`），门扇甩在屋里（`x 1900..1974, y 185..560`），
  // 门里还挂着一盏油灯。屋里东侧另有挂衣区 / 盆栽 / 书堆（见偏差 4）。
  3: {
    inner: { x: 272, y: 380, width: 1702, height: 670 },
    crop: { x: 16, y: 50, width: 1990, height: 1040 },
    patches: [
      // 门扇甩进屋里的那一段（`x 1892..1974, y 441..561`，`y 441` 以下屋子里面）：
      // 从同高度的干净地板平移过来 —— `x 1790..1872` 是空的
      // （门扇自己的下摆在 `x 1892` 往东，探针逐列量过）
      { hole: { x: 1892, y: 441, width: 82, height: 120 }, from: { x: 1790, y: 441, width: 82, height: 120 } },
      // 墙面那一段（`y 158..352`，从门楣的上沿到地板线）：门楣 + 门框 + 门洞 + 门里的
      // 油灯 + 门扇压在墙上的那一截，**整块补成素墙**。材料取**门的正上方**那块墙皮
      // （`x 1800..1930, y 110..160`，五行五点探针读数一致），拉到洞那么大 ——
      // 素色墙皮横竖都拉得起，拉完看不出接缝。
      // ⚠️ 这一面墙上**没有第二段干净墙皮**可借：西边是画上去的书柜（`x →1684`）、
      // 东边直接是墙角（`x 1974→`），门框两边都不空。第一版从门框西边那一竖条
      // （`x 1684..1703`）横着拉，拉出来是一扇**门框形状的棕色**（见改动日志）。
      { hole: { x: 1686, y: 158, width: 288, height: 194 }, from: { x: 1800, y: 110, width: 130, height: 50 } },
      // 地板那一段（`y 352..448`，门框和门扇的下沿比地板线低，压在房间上沿的这一截）：
      // 从**紧挨着下面**的地板原样搬上来（1:1 平移，不是拉伸）—— 门口这一片木头
      // 连门槛的阴影都是同一套，搬上来在 `y 352` 那条线上接得最顺。
      // 东边分两块，是因为 `x 1892` 往东是**门扇的下摆**、不是地板，不能当材料；
      // 那一段改从西边同一水平线上横向压过去填掉（木头花纹压窄点看不出）。
      { hole: { x: 1686, y: 352, width: 206, height: 96 }, from: { x: 1686, y: 448, width: 206, height: 96 } },
      { hole: { x: 1892, y: 352, width: 82, height: 96 }, from: { x: 1686, y: 448, width: 206, height: 96 } },
    ],
  },
}

/** 多边形外框。 */
function polyBox(polygon: readonly (readonly [number, number])[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of polygon) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function unionBox(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.width))
  const y1 = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * 一件家具（`desk_*` 与 `chair_*` 成对的那一件）切成「桌」和「椅」两个裁切框。
 *
 * 坐标换成了 **`bounds` 的相对坐标** —— `objectKey(id)` 那张画布的原点就是 `bounds`
 * 的左上角（见 `prepareFurnitureTextures`），拿源图坐标去切会整块偏出去。
 */
function deskChairBoxes(f: MapFurniture): { desk: Box; chair: Box } {
  const boxes = f.polygons.map(polyBox)
  // 椅子 = **最靠下**的那个多边形（见文件头那张表）
  let seat = 0
  boxes.forEach((b, i) => {
    const cur = boxes[seat]
    if (cur !== undefined && b.y + b.height > cur.y + cur.height) seat = i
  })
  const chair = boxes[seat]
  if (chair === undefined) throw new Error(`_d1Scenes：家具 ${f.id} 一个多边形都没有`)
  const rest = boxes.filter((_, i) => i !== seat)
  if (rest.length === 0) throw new Error(`_d1Scenes：家具 ${f.id} 只有椅子，没有桌子`)
  return {
    desk: shift(unionBox(rest), -f.bounds.x, -f.bounds.y),
    chair: shift(chair, -f.bounds.x, -f.bounds.y),
  }
}

function shift(b: Box, dx: number, dy: number): Box {
  return { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height }
}

function boxText(b: Box): string {
  return `(${b.x},${b.y}) ${b.width}×${b.height}`
}

/**
 * 这一组桌椅用哪一张变体贴图。**按它在房间里的位置挑**，与 D1 自己的用法同一个口径：
 *
 * - `front` / `back` = 房间的北半 / 南半（讲台在教室北边，所以北半是「前排」）
 * - `left` / `right` = 房间的西半 / 东半
 *
 * ⚠️ **名字里的 `_left` / `_right` 说的是桌子在房间哪半边**，不是椅子贴在哪一边
 * （椅子在四张变体里都是居中的，见文件头）。
 *
 * 第 2 关那四件的 id 是 `lab_front_left` 之类（实验台，不是课桌），所以这里
 * 先找同名的、再找以它结尾的 —— 写死 id 的话，换个关就会「找不到桌椅」
 * 而那是**画面上什么都没有**，看起来像这一层没接上。
 */
function variantOf(
  furniture: readonly MapFurniture[],
  room: Room,
  unit: FurnitureUnit,
): MapFurniture {
  const box = unitBox(unit)
  const want = `${box.y < room.rect.y ? 'front' : 'back'}_${box.x < room.rect.x ? 'left' : 'right'}`
  const f =
    furniture.find((it) => it.id === want) ?? furniture.find((it) => it.id.endsWith(want))
  if (f === undefined)
    throw new Error(
      `_d1Scenes：这一关的家具表里没有 "${want}"（有的：${furniture.map((it) => it.id).join(', ')}）`,
    )
  return f
}

/** 这一块必须整个在裁切框里，否则当场炸（理由见下面 `fillHole` 的 ⚠️）。 */
function insideCrop(box: Box, crop: Box, what: string): void {
  if (
    box.x < crop.x ||
    box.y < crop.y ||
    box.x + box.width > crop.x + crop.width ||
    box.y + box.height > crop.y + crop.height
  )
    throw new Error(
      `_d1Scenes：补丁的 ${what} ${boxText(box)} 不在裁切框 ${boxText(crop)} 里 —— 要么把 crop 放宽，要么改它`,
    )
}

/**
 * 把 `hole` 那一块补掉。坐标都是**源图坐标**，`crop` 是烘这张贴图时裁的框
 * （补丁表写的是源图坐标，烘的时候要减掉 `crop` 的左上角）。
 *
 * 两种补法见文件头「画上自带的开口和门扇要补掉」。越界一律**当场抛** ——
 * 补丁写到 `crop` 外面的话，`getImageData` 会安静地回一坨黑的，
 * 补出来的是一条黑边，看起来像「美术图有黑边」而不像「补丁写错了坐标」。
 */
function fillHole(ctx: CanvasRenderingContext2D, crop: Box, patch: Patch): void {
  const { hole } = patch
  insideCrop(hole, crop, 'hole')
  const from = patch.from
  if (from !== undefined) {
    insideCrop(from, crop, 'from')
    // `drawImage` 带缩放：`from` 和洞一样大就是原样平移，小就是拉满那个洞
    ctx.drawImage(
      ctx.canvas,
      from.x - crop.x,
      from.y - crop.y,
      from.width,
      from.height,
      hole.x - crop.x,
      hole.y - crop.y,
      hole.width,
      hole.height,
    )
    return
  }
  const axis = patch.axis
  if (axis === undefined) throw new Error(`_d1Scenes：补丁 ${boxText(hole)} 既没给 from 也没给 axis`)

  const hx = hole.x - crop.x
  const hy = hole.y - crop.y
  // 洞外紧挨着的两条边：一条在洞前、一条在洞后（`axis` 说沿哪根轴插）
  const across = axis === 'x' ? hole.height : hole.width
  const near =
    axis === 'x'
      ? ctx.getImageData(hx - 1, hy, 1, across)
      : ctx.getImageData(hx, hy - 1, across, 1)
  const far =
    axis === 'x'
      ? ctx.getImageData(hx + hole.width, hy, 1, across)
      : ctx.getImageData(hx, hy + hole.height, across, 1)
  const each = axis === 'x' ? hole.width : hole.height
  const filled = ctx.createImageData(hole.width, hole.height)
  for (let n = 0; n < across; n++) {
    const edge = n * 4
    for (let k = 1; k <= each; k++) {
      // 两头各留一半：k/(each+1) 从 >0 走到 <1，边界像素不会被复制成两条硬边
      const t = k / (each + 1)
      const at = (axis === 'x' ? n * hole.width + k - 1 : (k - 1) * hole.width + n) * 4
      for (let c = 0; c < 3; c++)
        filled.data[at + c] = near.data[edge + c] + (far.data[edge + c] - near.data[edge + c]) * t
      filled.data[at + 3] = 255
    }
  }
  ctx.putImageData(filled, hx, hy)
}

/**
 * 在已有纹理上**取一块矩形当一个帧**。重复调用只建一次 —— `scene.restart()`
 * 复用纹理管理器，第二次进来 `has()` 会命中，于是不会在同一个 key 上堆一串同名的帧。
 */
function cropFrame(scene: Phaser.Scene, key: string, name: string, box: Box): string {
  if (!scene.textures.exists(key))
    throw new Error(`_d1Scenes：纹理 ${key} 不在，D1 的关图没加载上（它在 assetManifest 的清单里）`)
  const tex = scene.textures.get(key)
  if (!tex.has(name)) tex.add(name, 0, box.x, box.y, box.width, box.height)
  return name
}

const ROOM_TEXTURE_SUFFIX = '_d1_room_v1'

/**
 * 把「整间教室」烘成一张贴图：从 D1 那份**已经抠掉桌椅**的地板画布上裁出 `crop`，
 * 再把画上自带的开口 / 门扇补掉（`patches`）。返回纹理 key。
 *
 * ⚠️ `crop` 一下就 `refresh()`，之后**只读**：`scene.restart()` 会复用这张贴图
 * （`textures.exists` 那一句），所以补丁**只会打一次** —— 也就要求 `patches` 之间
 * 互不重叠、且都不读 `crop` 以外的地方（`fillHole` 会替我们卡住后者）。
 */
function bakeRoomTexture(
  scene: Phaser.Scene,
  floorKey: string,
  key: string,
  artRoom: ArtRoom,
): string {
  const name = `${key}${ROOM_TEXTURE_SUFFIX}`
  if (scene.textures.exists(name)) return name
  const crop = artRoom.crop
  const canvas = scene.textures.createCanvas(name, crop.width, crop.height)
  if (canvas === null) throw new Error(`_d1Scenes：建不出画布纹理 ${name}`)
  const ctx = canvas.context
  // `floorKey` 那张就是 `prepareFurnitureTextures()` 用 `createCanvas` 建的，源图是画布
  const source = scene.textures.get(floorKey).getSourceImage() as HTMLCanvasElement
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  for (const patch of artRoom.patches) fillHole(ctx, crop, patch)
  canvas.refresh()
  return name
}

/** `drawD1StageLook()` 要的那几样。**全是地图坐标**，换算在函数里走 `mapper`。 */
export interface D1StageLook {
  /** D1 的真配置（`stage-collisions.json`）—— 桌椅的框、多边形、缩放全在里面 */
  art: StageCollisionConfig
  /** 这一间是第几关（1 起）：决定用哪张手绘关图 */
  stage: number
  room: Room
  cfg: RoomsConfig
  /** 地图 → 屏幕的换算器。**一个场子只有一份**，不许在这里自己算平移 */
  mapper: Mapper
  /** 画在哪一层。**这一层是底** —— D2 的门那一层（`layers: 'doors'`）要比它高 */
  depth: number
}

/**
 * 把这一间画成 D1 那三张手绘关里的一间，返回那个 `Container`
 * （调用方靠 `setVisible` 在三档观感之间切，见 `joint/d1d2_rooms` 的 `L` 键）。
 *
 * ⚠️ `stage` 与 `art` 都要是**真的那一关**：关号不同 = 换一张手绘图，
 * 而 D2 这一层里「三间 = 三关」是 `generateDungeon` 的房间顺序定的。
 */
export function drawD1StageLook(scene: Phaser.Scene, look: D1StageLook): Phaser.GameObjects.Container {
  const { art, stage, room, cfg, mapper } = look
  const layout = art.stages.find((s) => s.stage === stage)
  if (layout === undefined)
    throw new Error(`_d1Scenes：stage-collisions.json 里没有第 ${stage} 关，这一层不知道拿哪张图当教室`)
  const key = STAGE_BACKGROUNDS[stage - 1]
  if (key === undefined) throw new Error(`_d1Scenes：第 ${stage} 关没有对应的关图（只有三张）`)
  const artRoom = ART[stage]
  if (artRoom === undefined) throw new Error(`_d1Scenes：第 ${stage} 关还没量「两个框」（见 ART）`)

  const tex = prepareFurnitureTextures(scene, key, art, layout.furniture)
  const roomKey = bakeRoomTexture(scene, tex.floorKey, key, artRoom)
  const layer = scene.add.container(0, 0).setDepth(look.depth)

  // 0. 整间教室：`crop` 铺在房间上，其中 `inner` 那一块**正好落在房间内沿上**
  //    （墙的内表面，`inflate(-wallThickness/2)`）。横向纵向各拉一次，见文件头。
  const inner = inflate(room.rect, -cfg.wallThickness / 2)
  const at = mapper.toScreen(left(inner), top(inner))
  const sx = (inner.width * mapper.scale) / artRoom.inner.width
  const sy = (inner.height * mapper.scale) / artRoom.inner.height
  layer.add(
    scene.add
      .image(
        // `inner` 在 `crop` 里偏出去的那一截，就是画面上「房间外面」的部分（墙）
        at.x - (artRoom.inner.x - artRoom.crop.x) * sx,
        at.y - (artRoom.inner.y - artRoom.crop.y) * sy,
        roomKey,
      )
      .setOrigin(0)
      .setScale(sx, sy),
  )

  // 1. 桌椅：**一件一件摆**（D2 的矩形说了算），不整张贴
  for (const unit of furnitureUnits(room)) {
    const f = variantOf(layout.furniture, room, unit)
    const id = tex.objectKey(f.id)
    const cut = deskChairBoxes(f)

    // 桌：按宽度铺满那两格。**左上角对齐** —— 桌面的上沿就是格子的上沿
    const deskScale = (unit.desk.width / cut.desk.width) * mapper.scale
    const dp = mapper.toScreen(left(unit.desk), top(unit.desk))
    layer.add(
      scene.add
        .image(dp.x, dp.y, id, cropFrame(scene, id, 'desk', cut.desk))
        .setOrigin(0)
        .setScale(deskScale),
    )

    // 椅：等比缩到放得进那一格，居中摆
    const chairScale =
      Math.min(unit.chair.width / cut.chair.width, unit.chair.height / cut.chair.height) *
      mapper.scale
    const cp = mapper.toScreen(left(unit.chair), top(unit.chair))
    layer.add(
      scene.add
        .image(
          cp.x + (unit.chair.width * mapper.scale - cut.chair.width * chairScale) / 2,
          cp.y + (unit.chair.height * mapper.scale - cut.chair.height * chairScale) / 2,
          id,
          cropFrame(scene, id, 'chair', cut.chair),
        )
        .setOrigin(0)
        .setScale(chairScale),
    )
  }

  return layer
}