import Phaser from 'phaser'
import { MainMenuScene } from '@/GameScenes'
import { BattleScene } from '@/domains/combat/BattleScene'
import { MainMenuScene as MetaMenuScene } from '@/domains/meta/scenes/MainMenuScene'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#0b0b10',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  physics: {
    default: 'arcade',
    // ⚠️ **`fixedStep: false` 是修「走路一卡一卡」的，不要当默认值改回去。**
    //
    // Phaser 3.60 起 Arcade 默认定步长：`World.update()` 里 `_elapsed += delta`，
    // 累够 `_frameTimeMS`（16.667ms，`World.js:170`）才 `body.update()`，
    // 而 `Body.preUpdate(willStep, …)` 在 `willStep` 为假时**完全不积分**（`Body.js:1148`）。
    // 于是**渲染帧里有一部分身体一动不动**。屏幕是 143Hz（本机实测 delta 6.99ms）时：
    //
    //   [实测，1280×720，按住 D 走 2.4s，见 `_d2probe/walk_ab.mjs` / `walk_ab2.mjs`]
    //   fixedStep=true ：身体 0 位移 190/329 帧（**57.8%**），每步跳 4.33px；
    //                    屏幕 x 逐帧位移 −1.73…+2.60px（跨度 4.33px），负 186 / 正 136 帧
    //   fixedStep=false：身体 0 位移 0/251 帧，每帧都走；跨度 1.73px（= ±1 个屏幕像素）
    //
    // 而相机是 `startFollow` + lerp 0.14，**每个渲染帧都在动**（0 位移 5/329 帧）。
    // 两个时间轴一错开，角色相对地面就按 ~1/3 的帧率来回锯 —— 这就是「一卡一卡的闪」。
    // 同样的量在 1279 帧里分四次做过 2×2 拆因子（`walk_ab2.mjs`）：
    // 停帧只由 `fixedStep` 造成（`roundPixels` 一格一格是 4.33 → 3.85px），
    // 取整只贡献那 1px 的残差。**别去动 `roundPixels` 治这个**：关掉它确实能到 0.91px，
    // 但那是拿「像素画在半个像素上采样」换来的，会从「卡」变成「沙沙地闪」，更糟。
    //
    // ## 为什么敢关（定步长唯一的功劳是防穿墙，而它由别处兜着）
    //
    // 关掉之后物理步长 = 渲染帧 delta，低帧率时步长变粗，理论上会穿墙。实际不会：
    // `TimeStep.smoothDelta()` 有两道网 —— `!inFocus || _coolDown` 时
    // `delta = min(delta, _target)`（16.667ms，`TimeStep.js:571`），
    // 而 `delta > _min`（200ms）时**直接用历史里的合理值顶替**（`TimeStep.js:576`）。
    // 切标签页回来走的是 `focus() → resetDelta()`（`TimeStep.js:457`），delta 从 0 起，
    // 且 `_coolDown` 帧内钳在 16.667ms。所以单个卡顿**递不到物理世界**。
    //
    // 代价实测（D3 的 `swarm_stress`，184 只怪，20fps，A/B/A/B 四次，`_d2probe/swarm_perf.mjs`）：
    // **反而快 3.3%** —— 定步长在 20fps 下要一帧追 3.38 步（68 步/s），
    // 关掉之后一帧 1 步（23 步/s）。低帧率下少跑一半多的物理。
    //
    // ## 别的域挂在这个事件上的东西都查过了，没有按 60Hz 算的
    //
    // `WORLD_STEP` 的三个监听方：`Weapons` 的扫掠射线用 `b.previous → b.body.center`
    // 逐段测（步变短只会更准，`nextTrailMs`/`nextPierceSpecialMs` 都是按时间闸的）、
    // `EnemySystem` 的 AI 本来就**按渲染帧闸一次**并用真实 `dtSec`（`EnemySystem.ts:659`）、
    // `damage.ts` 的账本按 `nextTickAtMs` 时间闸。
    // 接触伤害那边 `ContactResolver` 的文件头就是为这件事写的（「物理步数在掉帧时会变多」）：
    // 冲击每个 (源,怪) 只算一次，帧伤进账本。**别把它改成按步结算**，那才是真的会翻倍。
    arcade: { gravity: { x: 0, y: 0 }, debug: false, fixedStep: false },
  },
  // `MainMenuScene` 是 D1 的标题画面（key `main-menu`），`MetaMenuScene` 是 D4 的
  // 局外成长主菜单（key `MainMenu`）—— **两个 key 不冲突**，后者由标题画面上的
  // 「局外成长」按钮进入。
  scene: [MainMenuScene, BattleScene, MetaMenuScene],
})

const warnDuringBattle = (event: BeforeUnloadEvent): void => {
  if (!game.scene.isActive('battle')) return
  event.preventDefault()
  event.returnValue = ''
}
window.addEventListener('beforeunload', warnDuringBattle)
game.events.once(Phaser.Core.Events.DESTROY, () =>
  window.removeEventListener('beforeunload', warnDuringBattle),
)

export default game
