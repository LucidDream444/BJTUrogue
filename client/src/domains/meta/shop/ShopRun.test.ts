import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RngLike } from '@/core/rng'
import { parseShopPrices, priceForShopItem, ShopConfigError } from './shopConfig'
import { ShopRun, type ShopWallet } from './ShopRun'

const prices = parseShopPrices(
  JSON.parse(readFileSync(new URL('../../../../public/config/shop-prices.json', import.meta.url), 'utf8')),
)

function rng(sequence: readonly number[] = [0]): RngLike {
  let index = 0
  return {
    seed: 1,
    next: () => 0.5,
    between: (min, max) => {
      const value = sequence[index++ % sequence.length] ?? min
      return Math.min(max, Math.max(min, value))
    },
    floatBetween: (min) => min,
    pick: (items) => items[0]!,
  }
}

function wallet(value: number): ShopWallet & { value: number } {
  return {
    value,
    remaining() {
      return this.value
    },
    spend(amount) {
      if (this.value < amount) return false
      this.value -= amount
      return true
    },
    refund(amount) {
      this.value += amount
    },
  }
}

describe('shop-prices.json', () => {
  it('当前四类商品都是 1，具体商品覆盖价优先', () => {
    expect(priceForShopItem(prices, 'health', 'health_potion')).toBe(1)
    expect(priceForShopItem(prices, 'weapon', 'weapon_a', 'rail')).toBe(1)
    expect(
      priceForShopItem(
        { ...prices, itemOverrides: { 'weapon:rail': 3, weapon_a: 2 } },
        'weapon',
        'weapon_a',
        'rail',
      ),
    ).toBe(3)
  })

  it('拒绝负数、小数和缺失类型价格', () => {
    expect(() =>
      parseShopPrices({ schemaVersion: 1, basePrices: { health: -1 } }),
    ).toThrow(ShopConfigError)
    expect(() =>
      parseShopPrices({
        schemaVersion: 1,
        basePrices: { health: 1, energy: 1, upgrade: 1, weapon: 0.5 },
      }),
    ).toThrow(ShopConfigError)
  })
})

describe('ShopRun', () => {
  const candidates = {
    upgradeIds: ['sharp', 'tempo'],
    weaponIds: ['pulse', 'rail', 'smg'],
  }

  it('首次生成五件商品，同一商店重进不重抽，新局重新生成', () => {
    const run = new ShopRun(prices, rng([0, 0, 1]))
    const first = run.ensureStock('2:SHOP', candidates)
    expect(first.items.map((item) => item.kind)).toEqual([
      'health',
      'energy',
      'upgrade',
      'weapon',
      'weapon',
    ])
    expect(run.ensureStock('2:SHOP', { upgradeIds: ['grace'], weaponIds: ['flare'] })).toEqual(first)

    const nextRun = new ShopRun(prices, rng([1, 2, 1]))
    const next = nextRun.ensureStock('2:SHOP', candidates)
    expect(next.items[2]!.rewardId).not.toBe(first.items[2]!.rewardId)
  })

  it('商品成功购买后售罄，重复购买不再扣币', () => {
    const shop = new ShopRun(prices, rng())
    shop.ensureStock('shop', candidates)
    const coins = wallet(5)
    const bought = shop.purchase({
      shopId: 'shop',
      itemId: 'health_potion',
      wallet: coins,
      apply: () => true,
    })
    expect(bought).toMatchObject({ ok: true, reason: 'ok', remainingCoins: 4 })
    expect(shop.stock('shop')?.soldIds.has('health_potion')).toBe(true)
    expect(
      shop.purchase({
        shopId: 'shop',
        itemId: 'health_potion',
        wallet: coins,
        apply: () => true,
      }),
    ).toMatchObject({ ok: false, reason: 'sold', remainingCoins: 4 })
  })

  it('余额不足或当前不可用时不扣币、不售罄', () => {
    const shop = new ShopRun(prices, rng())
    shop.ensureStock('shop', candidates)
    const empty = wallet(0)
    expect(
      shop.purchase({ shopId: 'shop', itemId: 'health_potion', wallet: empty, apply: () => true }),
    ).toMatchObject({ ok: false, reason: 'insufficient' })

    const coins = wallet(5)
    expect(
      shop.purchase({
        shopId: 'shop',
        itemId: 'health_potion',
        wallet: coins,
        unavailableReason: () => '生命已满',
        apply: () => true,
      }),
    ).toMatchObject({ ok: false, reason: 'unavailable', detail: '生命已满' })
    expect(coins.value).toBe(5)
    expect(shop.stock('shop')?.soldIds.size).toBe(0)
  })

  it('应用失败会回滚扣款，商品仍保留', () => {
    const shop = new ShopRun(prices, rng())
    shop.ensureStock('shop', candidates)
    const coins = wallet(5)
    expect(
      shop.purchase({
        shopId: 'shop',
        itemId: 'health_potion',
        wallet: coins,
        apply: () => {
          throw new Error('unexpected')
        },
      }),
    ).toMatchObject({ ok: false, reason: 'apply-failed', remainingCoins: 5 })
    expect(coins.value).toBe(5)
    expect(shop.stock('shop')?.soldIds.size).toBe(0)
  })
})
