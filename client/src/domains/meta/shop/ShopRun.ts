import type { RngLike } from '@/core/rng'
import {
  priceForShopItem,
  type ShopItemKind,
  type ShopPricesConfig,
} from './shopConfig'

export interface ShopItem {
  /** 商品桌在当前商店里的稳定槽位 ID。 */
  readonly id: string
  readonly kind: ShopItemKind
  readonly price: number
  readonly rewardId?: string
  readonly weaponId?: string
}

export interface ShopStock {
  readonly shopId: string
  readonly items: readonly ShopItem[]
  readonly soldIds: ReadonlySet<string>
}

export interface ShopStockCandidates {
  readonly upgradeIds: readonly string[]
  readonly weaponIds: readonly string[]
}

export interface ShopWallet {
  remaining(): number
  spend(amount: number): boolean
  refund(amount: number): void
}

export type ShopPurchaseReason =
  | 'ok'
  | 'missing'
  | 'sold'
  | 'insufficient'
  | 'unavailable'
  | 'apply-failed'

export interface ShopPurchaseResult {
  readonly ok: boolean
  readonly reason: ShopPurchaseReason
  readonly item?: ShopItem
  readonly remainingCoins: number
  readonly detail?: string
}

export interface ShopPurchaseInput {
  readonly shopId: string
  readonly itemId: string
  readonly wallet: ShopWallet
  /** 返回 null = 可应用；返回文字 = 当前状态不能购买（满生命、满能量等）。 */
  readonly unavailableReason?: () => string | null
  /** 必须同步完成效果应用；返回 false 时本次扣款会回滚。 */
  readonly apply: () => boolean
}

interface MutableStock {
  readonly items: ShopItem[]
  readonly sold: Set<string>
}

/**
 * 一局内的商店账本。
 *
 * 库存按 `shopId` 懒生成一次，离开再进入、换层再回来都读同一份；
 * 新开一局由宿主新建一个 `ShopRun`，因此会重新随机。
 */
export class ShopRun {
  private readonly stocks = new Map<string, MutableStock>()

  constructor(
    private readonly prices: ShopPricesConfig,
    private readonly rng: RngLike,
  ) {}

  ensureStock(shopId: string, candidates: ShopStockCandidates): ShopStock {
    const key = shopId.trim()
    if (!key) throw new Error('商店缺少 shopId')
    let stock = this.stocks.get(key)
    if (!stock) {
      const upgrades = unique(candidates.upgradeIds)
      const weapons = unique(candidates.weaponIds)
      const items: ShopItem[] = [
        this.fixed('health_potion', 'health'),
        this.fixed('energy_potion', 'energy'),
      ]
      if (upgrades.length) {
        const rewardId = upgrades[this.rng.between(0, upgrades.length - 1)]!
        items.push(this.item('run_upgrade', 'upgrade', rewardId, { rewardId }))
      }
      const weaponPicks = sample(weapons, Math.min(2, weapons.length), this.rng)
      const slots = ['weapon_a', 'weapon_b'] as const
      weaponPicks.forEach((weaponId, index) => {
        items.push(this.item(slots[index]!, 'weapon', weaponId, { weaponId }))
      })
      stock = { items, sold: new Set() }
      this.stocks.set(key, stock)
    }
    return {
      shopId: key,
      items: stock.items,
      soldIds: new Set(stock.sold),
    }
  }

  stock(shopId: string): ShopStock | null {
    const stock = this.stocks.get(shopId)
    if (!stock) return null
    return { shopId, items: stock.items, soldIds: new Set(stock.sold) }
  }

  purchase(input: ShopPurchaseInput): ShopPurchaseResult {
    const stock = this.stocks.get(input.shopId)
    const item = stock?.items.find((entry) => entry.id === input.itemId)
    if (!stock || !item) return result('missing', input.wallet, '这件商品不存在')
    if (stock.sold.has(item.id)) return result('sold', input.wallet, '这件商品已经售罄')
    if (input.wallet.remaining() < item.price) {
      return result('insufficient', input.wallet, '局内货币不足')
    }
    const unavailable = input.unavailableReason?.() ?? null
    if (unavailable !== null) return result('unavailable', input.wallet, unavailable)
    if (!input.wallet.spend(item.price)) {
      return result('insufficient', input.wallet, '局内货币不足')
    }
    let applied = false
    try {
      applied = input.apply()
    } catch {
      applied = false
    }
    if (!applied) {
      input.wallet.refund(item.price)
      return result('apply-failed', input.wallet, '商品效果未能应用')
    }
    stock.sold.add(item.id)
    return result('ok', input.wallet, undefined, item)
  }

  private fixed(id: string, kind: 'health' | 'energy'): ShopItem {
    return this.item(id, kind)
  }

  private item(
    id: string,
    kind: ShopItemKind,
    subjectId?: string,
    extra: Pick<ShopItem, 'rewardId' | 'weaponId'> = {},
  ): ShopItem {
    return {
      id,
      kind,
      price: priceForShopItem(this.prices, kind, id, subjectId),
      ...extra,
    }
  }
}

function result(
  reason: Exclude<ShopPurchaseReason, 'ok'>,
  wallet: ShopWallet,
  detail?: string,
): ShopPurchaseResult
function result(
  reason: 'ok',
  wallet: ShopWallet,
  detail: string | undefined,
  item: ShopItem,
): ShopPurchaseResult
function result(
  reason: ShopPurchaseReason,
  wallet: ShopWallet,
  detail?: string,
  item?: ShopItem,
): ShopPurchaseResult {
  return {
    ok: reason === 'ok',
    reason,
    remainingCoins: wallet.remaining(),
    ...(detail === undefined ? {} : { detail }),
    ...(item === undefined ? {} : { item }),
  }
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))]
}

function sample(ids: readonly string[], count: number, rng: RngLike): string[] {
  const pool = [...ids]
  const picked: string[] = []
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(rng.between(0, pool.length - 1), 1)[0]!)
  }
  return picked
}
