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
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
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
