import { ARCHIVE_ART, CAMPUS_MENU_ART } from '@/core/assetManifest'
import { CHARACTERS, characterById } from '../catalog'
import type { MetaConfig, CharacterSkillLevelDef, CharacterSkillKind } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import {
  buySkillUpgrade,
  isUnlocked,
  skillLevelOf,
  skillUpgradeCost,
  unlock,
} from '../progress/progress'
import { ArchiveUI } from '../ui/ArchiveUI'
import { ARCHIVE_THEME as A } from '../ui/theme'

/** The supplied navy notebook style applied to the existing four-rank progression. */
export function buildUpgradePanel(
  ui: ArchiveUI,
  store: ProfileStore,
  meta: MetaConfig | null,
  selectedCharacterId: string,
  onSelectCharacter: (id: string) => void,
  onChanged: (notice: string) => void,
): void {
  if (!meta || !meta.characters[selectedCharacterId]) {
    ui.label(120, 240, '成长配置暂不可用，请返回校园重试。', A.size.body, A.warning)
    return
  }
  const character = meta.characters[selectedCharacterId]!,
    profile = store.profile
  const unlocked = isUnlocked(profile, selectedCharacterId)
  const level = skillLevelOf(profile, meta, selectedCharacterId)
  const cost = skillUpgradeCost(profile, meta, selectedCharacterId),
    skill = character.skill
  let preview = Math.min(level, skill.levels.length - 1)
  const start = ui.root.list.length
  const render = (): void => {
    ui.root.list.slice(start).forEach((obj) => obj.destroy())
    ui.label(115, 182, '成长档案', A.size.small, A.muted)
    // Slate-blue index tabs with real character portraits.
    CHARACTERS.forEach((c, i) => {
      if (!meta.characters[c.id]) return
      const y = 285 + i * 154,
        selected = c.id === selectedCharacterId,
        available = isUnlocked(profile, c.id)
      ui.panel(100, y - 55, 242, 126, selected ? 0.95 : 0.64)
      if (selected) {
        const g = ui.add(ui.scene.add.graphics())
        g.lineStyle(10, A.cyan, 0.08).strokeRoundedRect(100, y - 55, 242, 126, 7)
        g.lineStyle(2, A.cyan).strokeRoundedRect(100, y - 55, 242, 126, 7)
        g.fillStyle(A.cyan).fillRect(100, y - 42, 4, 96)
      }
      const key =
        CAMPUS_MENU_ART.characterCards[c.id as keyof typeof CAMPUS_MENU_ART.characterCards]
      if (key) ui.portrait(key, 150, y - 4, 73).setAlpha(available ? 1 : 0.5)
      ui.label(200, y - 25, c.name, A.size.body, selected ? A.paper : A.muted, undefined, true)
      ui.label(
        200,
        y + 16,
        available ? '已解锁' : `${meta.characters[c.id]!.unlockCost} 币解锁`,
        A.size.micro,
        A.muted,
      )
      ui.add(
        ui.scene.add
          .rectangle(221, y + 8, 242, 126, A.ink, 0.001)
          .setInteractive({ useHandCursor: true }),
      ).on('pointerup', () => {
        if (!selected) {
          onSelectCharacter(c.id)
          onChanged('')
        }
      })
    })
    ui.label(
      690,
      810,
      `${character.passive.name} · ${character.passive.description}`,
      A.size.micro,
      A.muted,
    ).setOrigin(0.5)

    ui.label(690, 180, skill.name, 38, A.paper, undefined, true).setOrigin(0.5)
    ui.label(690, 218, skill.description, A.size.small, A.muted, 570).setOrigin(0.5, 0)
    ui.orbit(690, 492, 238)
    ui.orbit(690, 490, 185, A.violet)
    ui.image(ARCHIVE_ART.grimoire, 690, 381, 265, 300)
    ui.label(690, 546, '成 长 之 书  /  永 久 技 能', A.size.micro, A.muted).setOrigin(0.5)
    const icons = [ARCHIVE_ART.crystal, ARCHIVE_ART.book, ARCHIVE_ART.orb, ARCHIVE_ART.paper]
    const connector = ui.add(ui.scene.add.graphics())
    connector.lineStyle(2, A.brass, 0.8).lineBetween(472, 610, 916, 610)
    skill.levels.forEach((rank, i) => {
      const x = 472 + i * 148,
        chosen = i === preview,
        active = i < level
      const g = ui.add(ui.scene.add.graphics())
      g.fillStyle(A.ink, 0.95).fillRoundedRect(x - 58, 577, 116, 112, 6)
      if (chosen) g.lineStyle(10, A.cyan, 0.07).strokeRoundedRect(x - 58, 577, 116, 112, 6)
      g.lineStyle(chosen ? 2 : 1, chosen ? A.cyan : A.brass, 1).strokeRoundedRect(
        x - 58,
        577,
        116,
        112,
        6,
      )
      ui.image(icons[i]!, x, 610, 52, 54).setAlpha(active || chosen ? 1 : 0.35)
      ui.label(
        x,
        656,
        `${i + 1}阶 · ${rank.name}`,
        A.size.micro,
        chosen ? A.energy : A.muted,
      ).setOrigin(0.5)
      ui.label(
        x,
        710,
        active ? '已掌握' : i === level ? '下一阶' : '待解锁',
        A.size.micro,
        active ? A.paper : A.muted,
      ).setOrigin(0.5)
      ui.add(
        ui.scene.add
          .rectangle(x, 633, 116, 112, A.ink, 0.001)
          .setInteractive({ useHandCursor: true }),
      ).on('pointerup', () => {
        preview = i
        render()
      })
    })
    ui.label(
      690,
      774,
      `当前等级  ${level} / 4   ·   点击阶位查看升级效果`,
      A.size.small,
      A.muted,
    ).setOrigin(0.5)

    ui.panel(1030, 185, 450, 610, 0.86)
    const inspected = skill.levels[preview]!
    ui.label(1070, 215, '升级预览', A.size.micro, A.muted)
    ui.label(
      1070,
      250,
      `${String(preview + 1).padStart(2, '0')}  ${inspected.name}`,
      A.size.heading,
      A.paper,
      undefined,
      true,
    )
    ui.image(icons[preview]!, 1412, 250, 57, 64)
    ui.rule(1070, 306, 370)
    ui.label(1070, 327, inspected.description, A.size.small, A.paper, 370)
    ui.label(1070, 424, '当前', A.size.small, A.muted)
    ui.label(1328, 424, '预览', A.size.small, A.energy)
    const current = level ? skill.levels[level - 1] : undefined
    comparisonRows(skill.kind, current, inspected).forEach((row, i) => {
      const y = 468 + i * 54
      ui.label(1070, y, row.label, A.size.micro, A.muted)
      ui.label(1215, y, row.current, A.size.small, A.paper).setOrigin(0.5, 0)
      ui.label(1283, y, '→', A.size.small, A.muted)
      ui.label(1380, y, row.preview, A.size.small, A.energy).setOrigin(0.5, 0)
      ui.rule(1070, y + 36, 370)
    })
    const spend = unlocked ? cost : character.unlockCost
    const affordable = spend !== null && profile.currency.coins >= spend
    ui.label(
      1255,
      651,
      spend === null ? '全部阶位已掌握' : `需要 ${spend} 金币  ·  持有 ${profile.currency.coins}`,
      A.size.small,
      A.muted,
    ).setOrigin(0.5)
    const title = unlocked
      ? cost === null
        ? '已满级'
        : affordable
          ? '确认升级'
          : '金币不足'
      : affordable
        ? '解锁角色'
        : '金币不足'
    ui.button(
      1255,
      724,
      368,
      88,
      title,
      () => {
        if (unlocked) {
          let result = { ok: false, notice: '' }
          const saved = store.update((draft) => {
            result = buySkillUpgrade(draft, meta, selectedCharacterId)
          })
          onChanged(result.ok && !saved ? `${result.notice}（但未保存到本机）` : result.notice)
        } else {
          let ok = false
          const saved = store.update((draft) => {
            ok = unlock(draft, meta, selectedCharacterId).ok
          })
          onChanged(
            ok
              ? `已解锁：${characterById(selectedCharacterId)?.name}${saved ? '' : '（但未保存到本机）'}`
              : '金币不足，无法解锁',
          )
        }
      },
      true,
      !affordable,
    )
    ui.label(410, 835, `金币  ${profile.currency.coins}   /   升级永久保留`, A.size.small, A.paper)
    ui.label(1470, 837, '升级对象不改变出战角色 · Esc 返回', A.size.micro, A.muted).setOrigin(1, 0)
  }
  render()
}

function comparisonRows(
  kind: CharacterSkillKind,
  current: CharacterSkillLevelDef | undefined,
  next: CharacterSkillLevelDef,
): { label: string; current: string; preview: string }[] {
  const fields: [string, keyof CharacterSkillLevelDef, string][] =
    kind === 'haste'
      ? [
          ['攻速', 'attackSpeedPct', '%'],
          ['持续', 'durationMs', '秒'],
          ['冷却', 'cooldownMs', '秒'],
        ]
      : kind === 'dash'
        ? [
            ['伤害', 'dashDamage', ''],
            ['无敌', 'iframeMs', '秒'],
            ['冷却', 'cooldownMs', '秒'],
          ]
        : [
            ['书页伤害', 'pageDamage', ''],
            ['充能', 'maxCharges', '层'],
            ['冷却', 'cooldownMs', '秒'],
          ]
  const format = (v: number | string, suffix: string): string =>
    `${suffix === '秒' ? Number(v) / 1000 : v}${suffix}`
  return fields.map(([label, key, suffix]) => ({
    label,
    current: current ? format(current[key], suffix) : '未解锁',
    preview: format(next[key], suffix),
  }))
}
