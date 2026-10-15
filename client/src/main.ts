import Phaser from 'phaser'
import { MainMenuScene } from '@/GameScenes'
import { BattleScene } from '@/domains/combat/BattleScene'

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
  scene: [MainMenuScene, BattleScene],
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
