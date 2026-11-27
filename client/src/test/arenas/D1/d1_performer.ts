import { BattleScene, type BattleSceneData } from '@/domains/combat/BattleScene'

/**
 * 新角色“演奏家大鹅”的完整战斗入口。
 *
 * 使用正式 BattleScene、正式敌人和正式 meta 技能表，只把测试档预设为演奏家大鹅，
 * 因此不污染本地存档。打开后先按 Space 开始演奏，再跟着底部节拍条按左键 / 右键；
 * 每首歌消耗魔力，耗尽自动结束，再按 Space 可手动停止。
 */
class PerformerArena extends BattleScene {
  constructor() {
    super('')
  }

  override init(data: BattleSceneData = {}): void {
    super.init({
      ...data,
      skillLab: true,
      skillLabCharacterId: 'performer',
      characterId: 'performer',
      skillLabLevel: 4,
    })
  }

  override create(): void {
    super.create()
    this.input.keyboard?.addCapture(['SPACE'])
  }
}

export const arena = {
  displayName: 'D1 演奏家大鹅',
  description:
    'Space 开始/结束演奏；节拍圆重合时左键红歌、右键蓝歌叠层并消耗魔力。魔力耗尽会自动停止；演奏中无法使用武器。',
  scene: PerformerArena,
}
