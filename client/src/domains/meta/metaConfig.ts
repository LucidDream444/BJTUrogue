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

export interface CharacterDef2 {
  unlockCost: number
  passive: {
    name: string
    description: string
  }
  combat: CharacterCombatModifiers
  skill: CharacterSkillDef
}

export interface CharacterCombatModifiers {
  maxHpPct: number
  moveSpeedPct: number
  energyRegenPct: number
}

export type CharacterSkillKind = 'haste' | 'dash' | 'summon'

export interface CharacterSkillLevelDef {
  name: string
  description: string
  cooldownMs: number
  durationMs: number
  attackSpeedPct: number
  distance: number
  dashMs: number
  dashDamage: number
  iframeMs: number
  attackSpeedPerEnemyPct: number
  maxMechanicEnemies: number
  pageDamage: number
  fireIntervalMs: number
  range: number
  maxCharges: number
}

export interface CharacterSkillDef {
  id: string
  name: string
  description: string
  kind: CharacterSkillKind
  /** 升到 2/3/4 级的三笔费用。 */
  upgradeCosts: readonly number[]
  levels: readonly CharacterSkillLevelDef[]
}

export interface MetaConfig {
  schemaVersion: number
  economy: {
    coinsPerKill: number
    coinsPerClearedRoom: number
    coinsPerDepth: number
  }
  characters: Readonly<Record<string, CharacterDef2>>
}

export class MetaConfigError extends Error {}

export function parseMetaConfig(raw: unknown): MetaConfig {
  const root = needRecord(raw, 'meta')
  const version = root.schemaVersion
  if (version !== 2) {
    throw new MetaConfigError(`meta.schemaVersion 只认 2，拿到 ${JSON.stringify(version)}`)
  }
  const economy = needRecord(root.economy, 'meta.economy')
  const characters: Record<string, CharacterDef2> = {}
  for (const [id, value] of Object.entries(needRecord(root.characters, 'meta.characters'))) {
    const def = needRecord(value, `meta.characters.${id}`)
    const passive = needRecord(def.passive, `meta.characters.${id}.passive`)
    const combat = needRecord(def.combat, `meta.characters.${id}.combat`)
    characters[id] = {
      unlockCost: needNumber(def.unlockCost, `meta.characters.${id}.unlockCost`, 0),
      passive: {
        name: needString(passive.name, `meta.characters.${id}.passive.name`),
        description: needString(
          passive.description,
          `meta.characters.${id}.passive.description`,
        ),
      },
      combat: {
        maxHpPct: needNumber(combat.maxHpPct, `meta.characters.${id}.combat.maxHpPct`, 0),
        moveSpeedPct: needNumber(
          combat.moveSpeedPct,
          `meta.characters.${id}.combat.moveSpeedPct`,
          0,
        ),
        energyRegenPct: needNumber(
          combat.energyRegenPct,
          `meta.characters.${id}.combat.energyRegenPct`,
          0,
        ),
      },
      skill: parseCharacterSkill(def.skill, `meta.characters.${id}.skill`),
    }
  }
  return {
    schemaVersion: 2,
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
  }
}

function parseCharacterSkill(raw: unknown, where: string): CharacterSkillDef {
  const skill = needRecord(raw, where)
  const kind = skill.kind
  if (kind !== 'haste' && kind !== 'dash' && kind !== 'summon') {
    throw new MetaConfigError(`${where}.kind 只认 haste / dash / summon，拿到 ${String(kind)}`)
  }
  if (!Array.isArray(skill.levels) || skill.levels.length !== 4) {
    throw new MetaConfigError(`${where}.levels 必须恰好有 4 级`)
  }
  if (!Array.isArray(skill.upgradeCosts) || skill.upgradeCosts.length !== 3) {
    throw new MetaConfigError(`${where}.upgradeCosts 必须恰好有 3 笔费用`)
  }
  const upgradeCosts = skill.upgradeCosts.map((cost, i) =>
    needNumber(cost, `${where}.upgradeCosts[${i}]`, 0),
  )
  const levels = skill.levels.map((rawLevel, i): CharacterSkillLevelDef => {
    const p = `${where}.levels[${i}]`
    const level = needRecord(rawLevel, p)
    const def: CharacterSkillLevelDef = {
      name: needString(level.name, `${p}.name`),
      description: needString(level.description, `${p}.description`),
      cooldownMs: needNumber(level.cooldownMs, `${p}.cooldownMs`, 1),
      durationMs: optionalNumber(level.durationMs, `${p}.durationMs`),
      attackSpeedPct: optionalNumber(level.attackSpeedPct, `${p}.attackSpeedPct`),
      distance: optionalNumber(level.distance, `${p}.distance`),
      dashMs: optionalNumber(level.dashMs, `${p}.dashMs`),
      dashDamage: optionalNumber(level.dashDamage, `${p}.dashDamage`),
      iframeMs: optionalNumber(level.iframeMs, `${p}.iframeMs`),
      attackSpeedPerEnemyPct: optionalNumber(
        level.attackSpeedPerEnemyPct,
        `${p}.attackSpeedPerEnemyPct`,
      ),
      maxMechanicEnemies: optionalNumber(
        level.maxMechanicEnemies,
        `${p}.maxMechanicEnemies`,
      ),
      pageDamage: optionalNumber(level.pageDamage, `${p}.pageDamage`),
      fireIntervalMs: optionalNumber(level.fireIntervalMs, `${p}.fireIntervalMs`),
      range: optionalNumber(level.range, `${p}.range`),
      maxCharges: optionalNumber(level.maxCharges, `${p}.maxCharges`),
    }
    if (kind === 'haste' && (def.durationMs <= 0 || def.attackSpeedPct <= 0)) {
      throw new MetaConfigError(`${p} 是攻速技能，必须有 durationMs 与 attackSpeedPct`)
    }
    if (
      kind === 'dash' &&
      (def.distance <= 0 || def.dashMs <= 0 || def.dashDamage <= 0 || def.iframeMs < 0)
    ) {
      throw new MetaConfigError(`${p} 是突进技能，必须有 distance / dashMs / dashDamage / iframeMs`)
    }
    if (
      kind === 'summon' &&
      (def.durationMs <= 0 ||
        def.pageDamage <= 0 ||
        def.fireIntervalMs <= 0 ||
        def.range <= 0 ||
        def.maxCharges < 1)
    ) {
      throw new MetaConfigError(`${p} 是召唤技能，参考书数值不完整`)
    }
    if (
      i === 3 &&
      kind === 'dash' &&
      (def.attackSpeedPerEnemyPct <= 0 ||
        def.maxMechanicEnemies <= 0)
    ) {
      throw new MetaConfigError(`${p} 的第三阶突进机制数值不完整`)
    }
    if (i === 3 && kind === 'summon' && def.maxCharges !== 2) {
      throw new MetaConfigError(`${p} 的第三阶必须开放两层充能`)
    }
    return def
  })
  return {
    id: needString(skill.id, `${where}.id`),
    name: needString(skill.name, `${where}.name`),
    description: needString(skill.description, `${where}.description`),
    kind,
    upgradeCosts,
    levels,
  }
}

function optionalNumber(value: unknown, where: string): number {
  if (value === undefined) return 0
  return needNumber(value, where, 0)
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
