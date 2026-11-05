import Phaser from 'phaser'
import { BattleScene, type BattleSceneData } from '@/domains/combat/BattleScene'
import type { CombatSession } from '@/domains/combat/CombatSession'
import type { DungeonStages } from '@/domains/combat/DungeonStages'
import type { RunFlow } from '@/domains/combat/RunFlow'
import type { ShopWorld } from '@/domains/combat/ShopWorld'
import type { MetaConfig } from '@/domains/meta/metaConfig'
import type { RunLedger } from '@/domains/meta/run/RunLedger'
import type { ShopRun } from '@/domains/meta/shop/ShopRun'
import { MENU_SCENE_KEY } from '../../arenaCatalog'

interface ShopArenaSeam {
  session: CombatSession
  flow: RunFlow | null
  ledger: RunLedger
  meta: MetaConfig | null
  shopRun: ShopRun
  shopWorld: ShopWorld
  skillLab: boolean
  floor: number
  dungeon: DungeonStages
  roomOrder: number
  goToFloor(target: number): void
}

/**
 * D1 × D4 联调：直接进入 3F（一局第 3 层）的 `SHOP` 房间。
 *
 * 用正式 BattleScene 与正式 ShopWorld，不替身商店逻辑。面板只提供
 * “补币 / 受伤 / 重新进入商店”几个观察入口；购买仍然必须走近商品按 F。
 */
class ShopArena extends BattleScene {
  private status: HTMLDivElement | null = null
  private panel: HTMLDivElement | null = null
  private message = '已进入商店；靠近任意商品查看情报，按 F 购买。'

  constructor() {
    super('')
  }

  override init(data: BattleSceneData = {}): void {
    // 先让 BattleScene 使用内存档；create 完成后再关闭 skillLab 展示正常结算路径。
    super.init({ ...data, skillLab: true })
  }

  override create(): void {
    super.create()
    const seam = this.testSeam
    if (!seam.session || !seam.flow || !seam.ledger) return
    this.enterShopFloor()
    this.createPanel()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.panel?.remove()
      this.panel = null
      this.status = null
    })
  }

  override update(time: number, delta: number): void {
    super.update(time, delta)
    this.refreshStatus()
  }

  private get testSeam(): ShopArenaSeam {
    return this as unknown as ShopArenaSeam
  }

  private enterShopFloor(): void {
    const seam = this.testSeam
    seam.skillLab = false
    if (seam.floor !== 3) seam.goToFloor(3)
    const shop = seam.dungeon.rooms.find((unit) => unit.room.kind === 'shop')
    if (!shop) {
      this.message = '错误：第 3 层没有 shop 房。'
      return
    }
    seam.session.player.body.reset(shop.room.rect.x, shop.room.rect.y)
    seam.roomOrder = -1
    this.message = '商店已打开。默认满血满能量，因此血药/蓝药会显示不能购买；可用面板先降低资源。'
  }

  private refreshShop(): void {
    const seam = this.testSeam
    seam.shopWorld.leaveRoom()
    const shop = seam.dungeon.rooms.find((unit) => unit.room.kind === 'shop')
    if (!shop) return
    seam.shopWorld.showRoom(seam.floor, shop)
    this.message = '已模拟离开后重新进入：商品和售罄状态应保持不变。'
  }

  private damageAndDrain(): void {
    const player = this.testSeam.session.player
    player.model.hp = Math.max(1, player.model.hp - 20)
    player.stamina = Math.max(0, player.stamina - 20)
    this.message = '生命和能量各降低 20，可测试血药/蓝药购买。'
  }

  private grantCoins(): void {
    const seam = this.testSeam
    seam.ledger.grant(10)
    this.message = '已通过未来掉币预留入口补充 10 局内货币。'
  }

  private createPanel(): void {
    const root = document.createElement('div')
    root.style.cssText =
      'position:fixed;right:10px;top:80px;width:300px;padding:12px;border:1px solid #8b7954;border-radius:8px;background:#0d1722ed;color:#f5e8c8;font:13px/1.5 system-ui;z-index:100;box-sizing:border-box'
    const title = document.createElement('strong')
    title.textContent = 'D1 × D4 · 局内商店'
    const help = document.createElement('p')
    help.textContent =
      'WASD 移动，靠近桌子看情报，F 购买。买下第二把武器后，按 E 再按 1/2 替换；Esc 取消。R 重开新局会重新随机。'
    this.status = document.createElement('div')
    this.status.style.cssText = 'white-space:pre-wrap;color:#a9ddf2;margin:8px 0'
    root.append(title, help, this.status)
    const add = (label: string, action: () => void): void => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.style.cssText =
        'display:inline-block;margin:3px;padding:6px 8px;cursor:pointer;border:1px solid #7f9caf;border-radius:4px;background:#1c3a4d;color:white;font:inherit'
      button.onclick = () => {
        action()
        button.blur()
      }
      root.append(button)
    }
    add('补 10 局内币', () => this.grantCoins())
    add('生命/能量 -20', () => this.damageAndDrain())
    add('模拟离开再回商店', () => this.refreshShop())
    add('返回测试菜单', () => this.returnToMenu())
    root.addEventListener('keydown', (event) => event.stopPropagation())
    document.body.append(root)
    this.panel = root
    this.refreshStatus()
  }

  private refreshStatus(): void {
    if (!this.status) return
    const seam = this.testSeam
    if (!seam.session || !seam.ledger || !seam.meta) return
    const shopId = seam.shopWorld.visitedShopId
    const stock = shopId ? seam.shopRun.stock(shopId) : null
    const sold = stock?.soldIds.size ?? 0
    this.status.textContent =
      `局内货币 ${seam.ledger.remaining(seam.meta)} · 已花费 ${seam.ledger.spent}\n` +
      `生命 ${Math.ceil(seam.session.player.model.hp)}/${seam.session.player.model.maxHp} · ` +
      `能量 ${Math.ceil(seam.session.player.stamina)}/${seam.session.player.maxStamina}\n` +
      `武器 ${seam.session.inventory.join(' / ')} · 待交换 ${seam.session.pendingWeapons.join(' / ') || '无'}\n` +
      `库存 ${stock?.items.map((item) => item.id).join(' / ') ?? '未生成'} · 已售 ${sold}\n\n${this.message}`
  }

  private returnToMenu(): void {
    this.testSeam.session.destroy()
    const url = new URL(window.location.href)
    url.searchParams.delete('arena')
    window.history.replaceState(null, '', url)
    this.scene.start(MENU_SCENE_KEY)
  }
}

export const arena = {
  displayName: '联调 D1×D4：局内商店与双货币',
  description:
    '正式战斗场景中的 5 桌商店；验证靠近情报、F 购买、满资源失败、售罄保留、满武器待交换和局内货币 HUD。',
  scene: ShopArena,
}
