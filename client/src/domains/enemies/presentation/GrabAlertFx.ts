import type Phaser from 'phaser'
import type { EnemySystem } from '../EnemySystem'
import type { GrabberDef } from '@/core/config'

/**
 * 抓取怪头顶的两样信号，一层 Graphics + 一块 Text 画完。
 *
 * | 信号 | 什么时候 | 为什么必须看得见 |
 * |---|---|---|
 * | **「!」** | 预警期（站定 2 秒） | 这是玩家**唯一**的躲开窗口。没有它，抓取就是天上掉下来的 |
 * | **红色倒计时** | 抓取中（每 4 秒一口） | 玩家要知道「我还有多久」，才知道该不该拼命连点 |
 *
 * **抓取进度不用另画** —— 它头上的血条就是进度（扣血口径是「每次按下扣最大血量的 5%」），
 * `EnemyHealthBars` 已经在画了。多画一条只会和血条对不上号。
 *
 * ⚠️ 时间用 `clock.realNowMs`：抓取期间世界冻结（`nowMs` 停），而这两样信号**恰恰是
 * 冻结期间唯一还在动的东西**。倒计时的数字来自 `grabStatus()`（电影时间），
 * 切走标签页时它跟着停 —— 玩家不会在看不见的时候被咬，回来也不会发现「已经咬死我了」。
 */
export class GrabAlertFx {
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly countdown: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    private readonly enemies: EnemySystem,
    private readonly def: GrabberDef,
  ) {
    this.gfx = scene.add.graphics().setDepth(4650)
    this.countdown = scene.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '15px',
        // 红色，而且带描边 —— 它在很暗的地板与各种特效上都要读得出来
        color: '#ff6b6b',
        stroke: '#1a0505',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(4651)
      .setVisible(false)
  }

  /**
   * @param realNowMs 表现时间（`clock.realNowMs`）—— 只用来驱动呼吸，不参与任何判定
   */
  update(realNowMs: number): void {
    this.gfx.clear()
    this.countdown.setVisible(false)

    const pulse = 0.55 + 0.45 * Math.sin((realNowMs / 1000) * this.def.juice.alertFlashHz * Math.PI * 2)

    // ---- 预警中的每一只：头顶「!」----
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || model.enemyKind !== 'grabber') continue
      if (model.state !== 'windup') continue
      const x = view.x
      const y = view.y - view.displayHeight / 2 - 30
      // 一个小小的感叹号：竖条 + 点。白盒，但在很远也认得出来
      this.gfx.fillStyle(0xffe066, pulse).fillRect(x - 3, y - 16, 6, 13)
      this.gfx.fillStyle(0xffe066, pulse).fillRect(x - 3, y + 1, 6, 5)
      this.gfx.lineStyle(2, 0x2a1a00, 0.9).strokeRect(x - 3, y - 16, 6, 13)
    }

    // ---- 抓取中：头顶红色倒计时 ----
    const status = this.enemies.grabStatus()
    if (!status || status.phase !== 'holding') return
    const entry = this.enemies.liveEnemies.find((e) => e.model.id === status.enemyId)
    if (!entry) return
    const seconds = Math.max(0, status.msUntilBite) / 1000
    // 咬击临近时跳一下，最后 0.8 秒更急
    const urgent = seconds <= 0.8
    const bump = urgent ? 1 + 0.12 * Math.sin(realNowMs / 60) : 1
    this.countdown
      .setVisible(true)
      .setPosition(entry.view.x, entry.view.y - entry.view.displayHeight / 2 - 34)
      .setScale(bump)
      .setText(`咬！ ${seconds.toFixed(1)}s`)
  }

  destroy(): void {
    this.gfx.destroy()
    this.countdown.destroy()
  }
}
