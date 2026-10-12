/**
 * 测试场的**独立入口**（`test.html` 用的）。
 *
 * 为什么是独立入口而不是「`main.ts` 里读个 URL 参数决定加载谁」：
 *
 * 1. **测试场不能是产品的运行时依赖**（`AGENTS.md` §五）。分开两个 HTML → 两个入口，
 *    产品的产物里就**根本不存在**测试场这份代码，不是「靠一个 if 拦住」——
 *    后者只要那个 if 被误改，测试场就跟着发到线上了。
 * 2. 五个域里任何一个把测试场写坏，都只弄坏 `test.html`，游戏本体照常跑。
 * 3. `npm run dev` 打开的是游戏，`/test.html` 打开的才是测试场。
 *    **默认打开哪一个，说明了哪一个是正经东西。**
 *
 * 这个文件只做三件事：建游戏、注册场景、开菜单。所有场子由
 * `registerArenaScenes` 从目录里自动注册 —— 加场子不用改这里。
 */

import Phaser from 'phaser'
import { registerArenaScenes } from './ArenaMenu'

function boot(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    backgroundColor: '#0b0b10',
    // 不开 `roundPixels`（默认就是关的）：开着的话位置会被取整到整像素，
    // 两只物理上只差 0.4px 的怪会画在同一个像素上 —— 于是「分离力有没有生效」
    // 在画面上看不出来。测试场不在乎糊，在乎**白方块画在真实的物理位置上**。
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    physics: {
      default: 'arcade',
      arcade: {
        // 测试场里没有重力：俯视角。
        gravity: { x: 0, y: 0 },
        // ⚠️ **不要开 debug 画物理体。** 200 只怪时它每帧画几百个圆，
        // 帧率会掉到看不出「是不是 AI 慢」的程度 —— 而调试这个场子的时候，
        // 你判断的依据正是帧率。要单看某个怪就用 `physics.world.drawDebug` 单独开。
        debug: false,
      },
    },
  })

  // ⚠️ 音频解锁：浏览器不许页面自动出声，必须有一次用户手势。
  // Phaser 的 SoundManager 会自己挂一次性监听来解锁，所以这里**不写额外代码** ——
  // 但它意味着「进测试场之后要先点一下才会响」。HUD 上专门写了这句提示，
  // 因为「音效没响」最容易被误判成「音效坏了」。
  registerArenaScenes(game)
}

boot()