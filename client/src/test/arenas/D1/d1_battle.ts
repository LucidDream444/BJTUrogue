import { BattleScene } from '@/domains/combat/BattleScene'

export const arena = {
  displayName: 'D1 战斗核心：异次元校园',
  description: '手枪战斗、三层校园地图、每轮三选一强化与首领战。',
  scene: class extends BattleScene {
    constructor() {
      super('')
    }
  },
}
