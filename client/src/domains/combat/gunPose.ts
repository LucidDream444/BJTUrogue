/** Frame coordinates use the same foot anchor, scale and horizontal reflection as the sprite. */
export function gunMuzzlePosition(
  position: { x: number; y: number },
  size: { frameWidth: number; frameHeight: number },
  anchor: readonly number[],
  point: readonly [number, number],
  scale: number,
  flip: boolean,
): { x: number; y: number } {
  const dx = (point[0] - size.frameWidth * anchor[0]!) * scale
  return {
    x: position.x + (flip ? -dx : dx),
    y: position.y + (point[1] - size.frameHeight * anchor[1]!) * scale,
  }
}

/**
 * 手臂能偏离朝向正前方多少（弧度）。`π/2` 正好是半圆，这里多给一点余量，
 * 免得鼠标恰好在正上/正下时卡在边界上来回抖。
 *
 * **正常情况下这个夹取永远不会生效** —— 朝向本身是按鼠标在哪一侧选的
 * （见 `Player.aim`），所以瞄准方向必然落在当前朝向的半圆里。
 * 它是兜底：万一朝向和目标对不上（死区里、或别的代码改了朝向），
 * 手臂最多偏离正前方 101°，**绝不会横穿身体**。
 */
const FACING_SLACK_RAD = 0.2

function clampToFacing(angle: number, flip: boolean): number {
  const axis = flip ? Math.PI : 0
  const delta = Math.atan2(Math.sin(angle - axis), Math.cos(angle - axis))
  const limit = Math.PI / 2 + FACING_SLACK_RAD
  return axis + Math.max(-limit, Math.min(limit, delta))
}

export interface ArmPose {
  /** 肩部枢轴的世界坐标 —— 手臂图层就绕它旋转。 */
  pivot: { x: number; y: number }
  /** 枪口的世界坐标。**一定落在「枢轴 → 鼠标」这条射线上**，见下面的推导。 */
  muzzle: { x: number; y: number }
  /** 手臂图层的屏幕旋转角（弧度），直接交给 `setRotation`。 */
  rotation: number
}

/**
 * 手臂+枪图层的姿态：枢轴、枪口、旋转角。
 *
 * ## 为什么枪口一定要在射线上
 *
 * 这是这套素材要解决的问题本身。原图里手臂和枪烘焙在身体上，枪管只能横着，
 * 而子弹朝鼠标飞 —— 贴脸时「枪管指向」和「弹道方向」能差近 90°，玩家看着别扭。
 *
 * 所以手臂绕肩旋转后，**枪管必须指向鼠标**。做法是：取枪口相对枢轴的局部向量
 * `local`，把它整体旋转到「枢轴 → 鼠标」的方向上。旋转不改变长度，于是枪口
 * 恰好落在射线上、距离枢轴 `|local|` 处 —— 枪管指向和弹道因此天然一致。
 *
 * `Player.angle` 仍然是 `atan2(aim - muzzle)`，喂进去的就是这个枪口，
 * 所以它算出来的正好是手臂的方向，不需要另开一条真值来源。
 *
 * ## 左右朝向：为什么两支用同一个式子
 *
 * 手臂素材只画了朝右一份，朝左靠 `flipX` 镜像。Phaser 的变换是 `T·R·S` ——
 * **先镜像内容、再旋转**，所以「旋转前的枪管朝向」等于镜像后的 `baseAngle`。
 * 而 `baseAngle` 是用**已经镜像过的** `lx` 算的，镜像那一步已经算进去了 ——
 * 于是 `aimAngle - baseAngle` 对两个朝向都成立，不需要分情况再减一个 π。
 *
 * （早先在这里按朝向分了支，朝左时会多减一个 π，表现为朝左瞄准时枪管上下颠倒。）
 */
export function armPose(
  position: { x: number; y: number },
  size: { frameWidth: number; frameHeight: number },
  anchor: readonly number[],
  pivot: readonly [number, number],
  point: readonly [number, number],
  scale: number,
  flip: boolean,
  aimX: number,
  aimY: number,
): ArmPose {
  // 枢轴本身就是一个「帧坐标点」，所以直接复用同一个换算，锚点语义只有一份。
  const pivotWorld = gunMuzzlePosition(position, size, anchor, pivot, scale, flip)
  const mirror = flip ? -1 : 1
  const lx = (point[0] - pivot[0]) * scale * mirror
  const ly = (point[1] - pivot[1]) * scale
  const length = Math.hypot(lx, ly)
  const dx = aimX - pivotWorld.x
  const dy = aimY - pivotWorld.y
  const distance = Math.hypot(dx, dy)
  const baseAngle = Math.atan2(ly, lx)
  const aimAngle = clampToFacing(Math.atan2(dy, dx), flip)
  return {
    pivot: pivotWorld,
    // 用夹取后的方向算枪口，不是原始瞄准方向 —— 枪口和枪管必须一致，
    // 否则夹取生效时又会回到「枪管指一边、子弹飞另一边」的老问题上。
    muzzle:
      distance > 0
        ? {
            x: pivotWorld.x + Math.cos(aimAngle) * length,
            y: pivotWorld.y + Math.sin(aimAngle) * length,
          }
        : { x: pivotWorld.x + lx, y: pivotWorld.y + ly },
    rotation: aimAngle - baseAngle,
  }
}
