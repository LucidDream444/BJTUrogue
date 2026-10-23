import Phaser from 'phaser'
import {
  BattleScene,
  type BattleSceneData,
} from '@/domains/combat/BattleScene'
import { SkillLabHud } from './_SkillLabHud'

class D1BattleArena extends BattleScene {
  private labHud!: SkillLabHud

  constructor() {
    super('')
  }

  override init(data: BattleSceneData = {}): void {
    super.init({ ...data, skillLab: true })
  }

  override create(): void {
    super.create()
    const keyboard = this.input.keyboard
    if (!keyboard) return
    keyboard.on('keydown-OPEN_BRACKET', () => this.cycleSkillLabCharacter(-1))
    keyboard.on('keydown-CLOSED_BRACKET', () => this.cycleSkillLabCharacter(1))
    keyboard.on('keydown-MINUS', () => this.changeSkillLabLevel(-1))
    keyboard.on('keydown-PLUS', () => this.changeSkillLabLevel(1))
    keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET,
      Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET,
      Phaser.Input.Keyboard.KeyCodes.MINUS,
      Phaser.Input.Keyboard.KeyCodes.PLUS,
    ])
    this.labHud = new SkillLabHud(this, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.labHud.destroy())
  }

  override update(time: number, delta: number): void {
    super.update(time, delta)
    this.labHud.update()
  }
}

export const arena = {
  displayName: 'D1 战斗核心：异次元校园',
  description:
    '完整战斗场景。技能调试台：[ / ] 切角色，- / = 调技能等级，R 重开；使用内存测试档，不污染正式存档。',
  scene: D1BattleArena,
}
