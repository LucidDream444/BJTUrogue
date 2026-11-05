import Phaser from 'phaser'
import { textureKeyFor } from '@/core/assets'
import { SHOP_ITEM_ART } from '@/core/assetManifest'
import {
  ShopRun,
  type ShopItem,
  type ShopStock,
  type ShopWallet,
} from '@/domains/meta/shop/ShopRun'
import type { DungeonRoom } from './DungeonStages'
import type { CombatSession } from './CombatSession'

const INTERACT_RADIUS = 130

interface OfferRuntime {
  readonly item: ShopItem
  readonly container: Phaser.GameObjects.Container
  readonly icon:
    | Phaser.GameObjects.Rectangle
    | Phaser.GameObjects.Star
    | Phaser.GameObjects.Image
  readonly info: Phaser.GameObjects.Text
}

export interface ShopWorldOptions {
  readonly scene: Phaser.Scene
  readonly session: CombatSession
  readonly shopRun: ShopRun
  readonly wallet: ShopWallet
  readonly notice: (message: string) => void
}

/**
 * D1 的商店世界表现与交互。
 *
 * 库存、价格和购买事务归 D4；这里只负责把 D4 的库存摆成 5 张桌子、
 * 处理靠近显示情报、F 购买，以及武器待交换的世界提示。
 */
export class ShopWorld {
  private readonly scene: Phaser.Scene
  private readonly session: CombatSession
  private readonly shopRun: ShopRun
  private readonly wallet: ShopWallet
  private readonly notice: (message: string) => void
  private readonly offers: OfferRuntime[] = []
  private readonly pendingText: Phaser.GameObjects.Text
  private merchant: Phaser.GameObjects.Container | null = null
  private currentShopId: string | null = null
  private exchangeActive = false

  constructor(options: ShopWorldOptions) {
    this.scene = options.scene
    this.session = options.session
    this.shopRun = options.shopRun
    this.wallet = options.wallet
    this.notice = options.notice
    this.pendingText = this.scene.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '13px',
        color: '#f8e8bb',
        backgroundColor: '#101923e8',
        padding: { x: 8, y: 4 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(6000)
      .setVisible(false)
  }

  get exchangePending(): boolean {
    return this.exchangeActive
  }

  get visitedShopId(): string | null {
    return this.currentShopId
  }

  showRoom(floor: number, unit: DungeonRoom): void {
    this.leaveRoom()
    const shopId = `${floor}:${unit.room.id}`
    this.currentShopId = shopId
    const stock = this.shopRun.ensureStock(shopId, {
      upgradeIds: this.session.shopUpgradeCandidates(),
      weaponIds: this.session.shopWeaponCandidates(),
    })
    this.buildOffers(stock, unit)
    this.notice(`${unit.room.id} 商店 · 靠近商品查看情报 · F 购买`)
  }

  leaveRoom(): void {
    for (const offer of this.offers) offer.container.destroy(true)
    this.offers.length = 0
    this.merchant?.destroy(true)
    this.merchant = null
    this.currentShopId = null
    this.exchangeActive = false
  }

  update(): void {
    const player = this.session.player
    const alive = player.model.alive
    for (const offer of this.offers) {
      const near =
        alive &&
        Phaser.Math.Distance.Between(player.x, player.y, offer.container.x, offer.container.y) <=
          INTERACT_RADIUS
      offer.info.setVisible(near)
    }

    const pending = this.session.pendingWeapons
    this.pendingText.setVisible(alive && pending.length > 0)
    if (!alive || pending.length === 0) {
      this.exchangeActive = false
      return
    }
    const weapon = this.session.cfg.weapons.find((entry) => entry.id === pending[0])
    const more = pending.length > 1 ? `（另有 ${pending.length - 1} 把）` : ''
    this.pendingText
      .setText(
        this.exchangeActive
          ? `${weapon?.name ?? pending[0]} · 按 1 / 2 替换槽位 · Esc 取消`
          : `已购买 ${weapon?.name ?? pending[0]}${more} · 按 E 交换武器`,
      )
      .setPosition(player.x, player.y - player.model.stats.radius - 28)
  }

  /** 返回 true 表示 E 已被待交换武器消费。 */
  interact(): boolean {
    if (
      !this.session.player.model.alive ||
      this.session.clock.paused ||
      this.session.clock.frozen ||
      this.session.pendingWeapons.length === 0
    )
      return false
    this.exchangeActive = !this.exchangeActive
    return true
  }

  chooseReplacement(slot: number): boolean {
    if (!this.exchangeActive) return false
    const weaponId = this.session.pendingWeapons[0]
    if (!weaponId) return false
    if (!this.session.exchangePendingWeapon(slot)) {
      this.notice('这个武器槽不能替换')
      return true
    }
    this.exchangeActive = false
    const weapon = this.session.cfg.weapons.find((entry) => entry.id === weaponId)
    this.notice(`已装备 ${weapon?.name ?? weaponId} · 旧武器掉在脚边`)
    return true
  }

  cancelReplacement(): boolean {
    if (!this.exchangeActive) return false
    this.exchangeActive = false
    this.notice('已取消本次武器交换')
    return true
  }

  /**
   * 靠近商品按 F。返回 true 表示按键被商品桌消费：
   * 包括“已售罄 / 钱不够 / 满状态”这些失败，避免同一下误触楼梯入口。
   */
  tryPurchase(): boolean {
    if (!this.currentShopId || !this.session.player.model.alive) return false
    const player = this.session.player
    let nearest: OfferRuntime | null = null
    let distance = INTERACT_RADIUS
    for (const offer of this.offers) {
      const next = Phaser.Math.Distance.Between(
        player.x,
        player.y,
        offer.container.x,
        offer.container.y,
      )
      if (next <= distance) {
        distance = next
        nearest = offer
      }
    }
    if (!nearest) return false

    const result = this.shopRun.purchase({
      shopId: this.currentShopId,
      itemId: nearest.item.id,
      wallet: this.wallet,
      unavailableReason: () => this.unavailableReason(nearest!.item),
      apply: () => this.apply(nearest!.item),
    })
    if (result.ok) {
      this.markSold(nearest)
      this.notice(`已购买 ${this.itemName(nearest.item)} · 花费 ${nearest.item.price}`)
    } else {
      this.notice(result.detail ?? this.reasonText(result.reason))
    }
    return true
  }

  destroy(): void {
    this.leaveRoom()
    this.pendingText.destroy()
  }

  private buildOffers(stock: ShopStock, unit: DungeonRoom): void {
    const rect = unit.room.rect
    const gapX = Math.min(250, rect.width * 0.28)
    const rowGap = Math.min(180, rect.height * 0.22)
    const spots = [
      { x: rect.x - gapX, y: rect.y - rowGap },
      { x: rect.x, y: rect.y - rowGap },
      { x: rect.x + gapX, y: rect.y - rowGap },
      { x: rect.x - gapX / 2, y: rect.y + rowGap },
      { x: rect.x + gapX / 2, y: rect.y + rowGap },
    ]
    this.merchant = this.makeMerchant(
      rect.x,
      Math.max(rect.y - rect.height / 2 + 58, rect.y - rowGap - 92),
    )
    stock.items.slice(0, spots.length).forEach((item, index) => {
      const spot = spots[index]!
      const container = this.scene.add.container(spot.x, spot.y).setDepth(Math.round(spot.y) + 20)
      const table = this.scene.add
        .rectangle(0, 18, 150, 54, 0x3b2c24, 0.94)
        .setStrokeStyle(2, 0xd8b778, 0.9)
      const icon = this.makeIcon(item)
      const info = this.makeInfo(item)
      info.setPosition(0, 54)
      container.add([table, icon, info])
      const sold = stock.soldIds.has(item.id)
      if (sold) this.markSold({ item, container, icon, info })
      this.offers.push({ item, container, icon, info })
    })
  }

  /**
   * 商人是地图内白箱占位，不参与购买判定；真美术到位后替换这个容器即可。
   * 摆在上排 3 张商品桌正后方的中央，深度落后于商品桌。
   */
  private makeMerchant(x: number, y: number): Phaser.GameObjects.Container {
    const shadow = this.scene.add.ellipse(0, 42, 58, 16, 0x000000, 0.32)
    const body = this.scene.add
      .rectangle(0, 9, 44, 58, 0xd9c6a3)
      .setStrokeStyle(2, 0x2a2233, 1)
    const apron = this.scene.add
      .rectangle(0, 24, 30, 30, 0x7a9a72)
      .setStrokeStyle(1, 0x2a2233, 0.9)
    const head = this.scene.add
      .circle(0, -31, 13, 0xf0d0ab)
      .setStrokeStyle(2, 0x2a2233, 1)
    const cap = this.scene.add
      .rectangle(0, -42, 30, 9, 0x6d4a35)
      .setStrokeStyle(2, 0x2a2233, 1)
    const label = this.scene.add
      .text(0, -63, '商人 · 占位', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '12px',
        color: '#f7e3aa',
        backgroundColor: '#101923d9',
        padding: { x: 7, y: 3 },
      })
      .setOrigin(0.5)
    return this.scene.add
      .container(x, y, [shadow, body, apron, head, cap, label])
      .setDepth(Math.round(y) + 12)
  }

  private makeIcon(
    item: ShopItem,
  ): Phaser.GameObjects.Rectangle | Phaser.GameObjects.Star | Phaser.GameObjects.Image {
    if (item.kind === 'weapon') {
      const weapon = this.session.cfg.weapons.find((entry) => entry.id === item.weaponId)
      if (weapon) {
        return this.scene.add
          .image(0, 3, textureKeyFor(this.scene, weapon.artKey))
          .setDisplaySize(54, 30)
      }
    }
    if (item.kind === 'upgrade') return this.scene.add.star(0, 3, 5, 11, 6, 0xf2ca62)
    const art =
      item.kind === 'health'
        ? SHOP_ITEM_ART.healthPotion
        : SHOP_ITEM_ART.energyPotion
    const icon = this.scene.add
      .image(0, 3, textureKeyFor(this.scene, art))
      .setDisplaySize(32, 32)
    icon.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    return icon
  }

  private makeInfo(item: ShopItem): Phaser.GameObjects.Text {
    return this.scene.add
      .text(0, 0, this.infoText(item), {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '12px',
        color: '#f4ead1',
        backgroundColor: '#0b1520e8',
        padding: { x: 8, y: 5 },
        align: 'center',
        wordWrap: { width: 230 },
      })
      .setOrigin(0.5, 0)
      .setDepth(1)
      .setVisible(false)
  }

  private infoText(item: ShopItem): string {
    if (item.kind === 'health') {
      return `血药\n恢复 ${this.session.cfg.drops.healthAmount} 生命\n${item.price} 局内货币 · F 购买`
    }
    if (item.kind === 'energy') {
      return `蓝药\n恢复 ${this.session.cfg.drops.staminaAmount} 能量\n${item.price} 局内货币 · F 购买`
    }
    if (item.kind === 'upgrade') {
      const description = item.rewardId
        ? this.session.shopRewardDescription(item.rewardId)
        : null
      return `${this.itemName(item)}\n${description ?? '暂无可用强化'}\n${item.price} 局内货币 · F 购买`
    }
    const weapon = this.session.cfg.weapons.find((entry) => entry.id === item.weaponId)
    return `${weapon?.name ?? '武器'}\n${weapon?.description ?? ''}\n${item.price} 局内货币 · F 购买`
  }

  private itemName(item: ShopItem): string {
    if (item.kind === 'health') return '血药'
    if (item.kind === 'energy') return '蓝药'
    if (item.kind === 'upgrade') {
      return this.session.rewardDefs.find((reward) => reward.id === item.rewardId)?.name ?? '局内强化'
    }
    return this.session.cfg.weapons.find((weapon) => weapon.id === item.weaponId)?.name ?? '武器'
  }

  private unavailableReason(item: ShopItem): string | null {
    if (item.kind === 'health') {
      return this.session.player.model.hp >= this.session.player.model.maxHp ? '生命已满' : null
    }
    if (item.kind === 'energy') {
      return this.session.player.stamina >= this.session.player.maxStamina ? '能量已满' : null
    }
    if (item.kind === 'upgrade') {
      return item.rewardId && this.session.canApplyShopReward(item.rewardId)
        ? null
        : '这个强化当前不可用'
    }
    const weaponId = this.weaponId(item)
    return weaponId && this.session.canAcquireShopWeapon(weaponId)
      ? null
      : '已经拥有这把武器'
  }

  private apply(item: ShopItem): boolean {
    if (item.kind === 'health') {
      return this.session.player.model.restoreFromPickup(
        'health',
        this.session.cfg.drops.healthAmount,
      ) > 0
    }
    if (item.kind === 'energy') {
      return this.session.player.restoreStamina(this.session.cfg.drops.staminaAmount) > 0
    }
    if (item.kind === 'upgrade') {
      return item.rewardId !== undefined && this.session.applyShopReward(item.rewardId)
    }
    const weaponId = this.weaponId(item)
    return weaponId !== null && this.session.acquireShopWeapon(weaponId)
  }

  private weaponId(item: ShopItem): ReturnType<CombatSession['shopWeaponCandidates']>[number] | null {
    return this.session.cfg.weapons.find((weapon) => weapon.id === item.weaponId)?.id ?? null
  }

  private markSold(offer: OfferRuntime): void {
    offer.icon.setVisible(false)
    offer.info
      .setText(`${this.itemName(offer.item)} · 已售罄`)
      .setVisible(
        Phaser.Math.Distance.Between(
          this.session.player.x,
          this.session.player.y,
          offer.container.x,
          offer.container.y,
        ) <= INTERACT_RADIUS,
      )
  }

  private reasonText(reason: string): string {
    if (reason === 'sold') return '这件商品已经售罄'
    if (reason === 'insufficient') return '局内货币不足'
    if (reason === 'unavailable') return '当前不能购买这件商品'
    if (reason === 'apply-failed') return '商品效果未能应用'
    return '这件商品不存在'
  }
}
