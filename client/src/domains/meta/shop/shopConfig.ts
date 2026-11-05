/** `public/config/shop-prices.json` 的解析与价格查询。零 Phaser 依赖。 */

export const SHOP_PRICES_CONFIG_NAME = 'shop-prices.json'
export const SHOP_PRICES_CONFIG_URL = 'config/shop-prices.json'

export const SHOP_ITEM_KINDS = ['health', 'energy', 'upgrade', 'weapon'] as const
export type ShopItemKind = (typeof SHOP_ITEM_KINDS)[number]

export interface ShopPricesConfig {
  readonly schemaVersion: 1
  readonly basePrices: Readonly<Record<ShopItemKind, number>>
  /** `health` / `energy` / `upgrade:<rewardId>` / `weapon:<weaponId>` 的单项覆盖价。 */
  readonly itemOverrides: Readonly<Record<string, number>>
}

export class ShopConfigError extends Error {}

export function parseShopPrices(raw: unknown): ShopPricesConfig {
  const root = record(raw, 'shop-prices')
  if (root.schemaVersion !== 1) {
    throw new ShopConfigError(`shop-prices.schemaVersion 只认 1，拿到 ${String(root.schemaVersion)}`)
  }
  const base = record(root.basePrices, 'shop-prices.basePrices')
  const basePrices = Object.fromEntries(
    SHOP_ITEM_KINDS.map((kind) => [
      kind,
      coin(base[kind], `shop-prices.basePrices.${kind}`),
    ]),
  ) as Record<ShopItemKind, number>
  const overrideRaw = root.itemOverrides ?? {}
  const overrides = record(overrideRaw, 'shop-prices.itemOverrides')
  const itemOverrides = Object.fromEntries(
    Object.entries(overrides).map(([id, value]) => [
      id,
      coin(value, `shop-prices.itemOverrides.${id}`),
    ]),
  )
  return { schemaVersion: 1, basePrices, itemOverrides }
}

/**
 * 先查具体商品覆盖价，再查槽位价，最后落到商品类型基础价。
 *
 * 当前 JSON 里所有基础价都是 1；以后要单独改一把武器或一个强化时，只加
 * `itemOverrides["weapon:rail"]` / `itemOverrides["upgrade:sharp"]`，不用改代码。
 */
export function priceForShopItem(
  config: ShopPricesConfig,
  kind: ShopItemKind,
  slotId: string,
  subjectId?: string,
): number {
  const subjectKey = subjectId === undefined ? null : `${kind}:${subjectId}`
  if (subjectKey !== null && Object.hasOwn(config.itemOverrides, subjectKey)) {
    return config.itemOverrides[subjectKey]!
  }
  if (Object.hasOwn(config.itemOverrides, slotId)) return config.itemOverrides[slotId]!
  return config.basePrices[kind]
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ShopConfigError(`${where} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function coin(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ShopConfigError(`${where} 必须是非负安全整数`)
  }
  return value
}
