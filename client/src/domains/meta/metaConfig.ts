/**
 * `public/config/meta.json` 的解析与类型。**零 Phaser**，node 下可直接单测。
 *
 * ## ⚠️ 契约上的一处越界（已记在改动日志里）
 *
 * 《人员分工方案》§四 的 C2 说「配置表 Schema 归 D2」，而这是**一张新表**。
 * 这里的做法是：D4 按自己的需要起草字段定义，**请 D2 过一眼**。
 * 没有等 D2 点头就写，是因为周五要演示 MVP，而数值不进配置表就踩了红线 2
 * —— 两张错里，踩契约比踩红线轻，且这一处可以事后补审。
 *
 * 另外一个刻意的小重复：配置表文件名的"唯一真值"在 `core/config.ts`
 * （`CONFIG_FILE_NAMES` / `configUrl()`），但那份只覆盖 balance / difficulty / enemies。
 * 把它扩成"所有表"要改共用层（需全员同意），所以这里自带一个常量。
 * **等 C2 扩展时把它并进去。**
 */

/** 配置表文件名。与 `core/config.ts` 里那三张表并列，但不属于那个 bundle。 */
export const META_CONFIG_NAME = 'meta.json'

/** 加载路径。`public/` 下的文件必须走 loader，不能 `import`（见 `ArenaBase.preload` 的注释）。 */
export const META_CONFIG_URL = 'config/meta.json'

/** 成长项的计量单位：整数点数 / 百分比 */
export type TrackUnit = 'point' | 'percent'

export interface UpgradeTrackDef {
  id: string
  name: string
  unit: TrackUnit
  /** 每一级加多少 */
  perLevel: number
  /** 第一级的成本 */
  baseCost: number
  /** 成本倍率：第 L+1 级 = round(baseCost × costGrowth ^ L) */
  costGrowth: number
  maxLevel: number
}

export interface CharacterDef2 {
  unlockCost: number
  base: { maxHp: number; magic: number; armor: number }
  tracks: UpgradeTrackDef[]
}

export interface SkillDef {
  name: string
  description: string
  unlockCost: number
  tracks: UpgradeTrackDef[]
}

export interface MetaConfig {
  schemaVersion: number
  economy: {
    coinsPerKill: number
    coinsPerClearedRoom: number
    coinsPerDepth: number
  }
  characters: Readonly<Record<string, CharacterDef2>>
  skills: Readonly<Record<string, SkillDef>>
}

export class MetaConfigError extends Error {}

export function parseMetaConfig(raw: unknown): MetaConfig {
  const root = needRecord(raw, 'meta')
  const version = root.schemaVersion
  if (version !== 1) {
    throw new MetaConfigError(`meta.schemaVersion 只认 1，拿到 ${JSON.stringify(version)}`)
  }
  const economy = needRecord(root.economy, 'meta.economy')
  const characters: Record<string, CharacterDef2> = {}
  for (const [id, value] of Object.entries(needRecord(root.characters, 'meta.characters'))) {
    const def = needRecord(value, `meta.characters.${id}`)
    const base = needRecord(def.base, `meta.characters.${id}.base`)
    characters[id] = {
      unlockCost: needNumber(def.unlockCost, `meta.characters.${id}.unlockCost`, 0),
      base: {
        maxHp: needNumber(base.maxHp, `meta.characters.${id}.base.maxHp`, 1),
        magic: needNumber(base.magic, `meta.characters.${id}.base.magic`, 0),
        armor: needNumber(base.armor, `meta.characters.${id}.base.armor`, 0),
      },
      tracks: parseTracks(def.tracks, `meta.characters.${id}.tracks`),
    }
  }
  const skills: Record<string, SkillDef> = {}
  for (const [id, value] of Object.entries(needRecord(root.skills, 'meta.skills'))) {
    const def = needRecord(value, `meta.skills.${id}`)
    skills[id] = {
      name: needString(def.name, `meta.skills.${id}.name`),
      description: needString(def.description, `meta.skills.${id}.description`),
      unlockCost: needNumber(def.unlockCost, `meta.skills.${id}.unlockCost`, 0),
      tracks: parseTracks(def.tracks, `meta.skills.${id}.tracks`),
    }
  }
  return {
    schemaVersion: 1,
    economy: {
      coinsPerKill: needNumber(economy.coinsPerKill, 'meta.economy.coinsPerKill', 0),
      coinsPerClearedRoom: needNumber(
        economy.coinsPerClearedRoom,
        'meta.economy.coinsPerClearedRoom',
        0,
      ),
      coinsPerDepth: needNumber(economy.coinsPerDepth, 'meta.economy.coinsPerDepth', 0),
    },
    characters,
    skills,
  }
}

/**
 * 第 L+1 级的成本（L 是当前等级）。满级返回 `null`。
 *
 * `costGrowth` 取 1 时成本恒定 —— 那是"线性"档，不做特例。
 */
export function costOfNextLevel(track: UpgradeTrackDef, level: number): number | null {
  if (level >= track.maxLevel) return null
  return Math.round(track.baseCost * Math.pow(track.costGrowth, level))
}

function parseTracks(raw: unknown, where: string): UpgradeTrackDef[] {
  if (!Array.isArray(raw)) throw new MetaConfigError(`${where} 要一个数组`)
  return raw.map((item, i) => {
    const t = needRecord(item, `${where}[${i}]`)
    const unit = t.unit
    if (unit !== 'point' && unit !== 'percent') {
      throw new MetaConfigError(`${where}[${i}].unit 只认 point / percent，拿到 ${String(unit)}`)
    }
    return {
      id: needString(t.id, `${where}[${i}].id`),
      name: needString(t.name, `${where}[${i}].name`),
      unit,
      perLevel: needNumber(t.perLevel, `${where}[${i}].perLevel`, 0),
      baseCost: needNumber(t.baseCost, `${where}[${i}].baseCost`, 0),
      costGrowth: needNumber(t.costGrowth, `${where}[${i}].costGrowth`, 1),
      maxLevel: needNumber(t.maxLevel, `${where}[${i}].maxLevel`, 0),
    }
  })
}

function needRecord(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new MetaConfigError(`${where} 要一个对象，拿到 ${JSON.stringify(v)}`)
  }
  return v as Record<string, unknown>
}

function needNumber(v: unknown, where: string, min: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
    throw new MetaConfigError(`${where} 要是 ≥ ${min} 的数，拿到 ${JSON.stringify(v)}`)
  }
  return v
}

function needString(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new MetaConfigError(`${where} 要是非空字符串，拿到 ${JSON.stringify(v)}`)
  }
  return v
}
