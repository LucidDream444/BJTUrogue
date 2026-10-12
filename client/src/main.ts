/**
 * **游戏本体的入口**（`index.html` 用的）。测试场在 `test.html` → `src/test/launcherMain.ts`。
 *
 * ---
 *
 * ## 现在这里还没有游戏
 *
 * 主菜单归 D4（局外成长与存档），战斗场景归 D1。这个文件目前的职责只有两件：
 *
 * 1. **证明 `index.html` 指向的入口存在。** 在此之前 `index.html` 引用的是一个
 *    不存在的文件 —— 那种「打开首页一片空白，控制台一行 404」的坑，
 *    每个克隆仓库的人都会踩一次。
 * 2. **把浏览器的那几条硬约束摆在这里**（见下面的块注释），
 *    因为它们是**全局的**：谁接了第一个场景，谁就继承了这几条，
 *    而在场景里再补比在这里补容易漏。
 *
 * 谁先接上第一个真实场景，就把 `scene: [ ... ]` 填上，
 * 并把这段「还没有游戏」的说明删掉。
 */

import Phaser from 'phaser'

/**
 * 全局的浏览器约束。**在写任何场景之前先读这段。**
 *
 * 1. **`delta` 必须钳制。** 切标签页时 `requestAnimationFrame` 会停，
 *    切回来的第一帧 `delta` 可能是几十秒。不钳制会产生穿墙、
 *    以及「按时间累积的伤害一次性结算几百次」。
 *    → 场景里统一走 `GameClock.advance()`（`core/time.ts` 里已经钳过）。
 * 2. **音频要一次用户点击才能解锁**，所有浏览器通用。
 * 3. **全屏 / 指针锁定必须写在点击处理函数内**，不能在加载时自动触发。
 * 4. **F5 刷新 = 本局进度全丢**，`beforeunload` 要拦。
 *
 * 这几条的细节见 `docs/技术选型.md` §8。
 */
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
    arcade: {
      // 俯视角，没有重力。
      gravity: { x: 0, y: 0 },
      // **不要开。** 在 200 只怪时它每帧画几百个圆，帧率会掉到分不清是渲染慢还是 AI 慢。
      debug: false,
    },
  },
  // 场景由 D1 / D4 接。在那之前这里刻意留空 —— 空数组不会报错，
  // 页面就是一块纯色，而不是一个「场景不存在」的控制台报错。
  scene: [],
})

// 让 `noUnusedLocals` 满意（`game` 是必要的副作用，后面接场景时会用到它）。
export default game