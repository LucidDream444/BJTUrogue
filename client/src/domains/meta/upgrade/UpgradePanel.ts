/**
 * 角色升级页：每个角色只有一个固定被动和一个四阶技能。
 *
 * 三个角色的流程完全共用：
 * - 解锁角色时技能自动 1 级；
 * - 花币依次升到 2 / 3 / 4 级；
 * - 页面永远只出现一个技能卡和一个“升级”按钮。
 *
 * ## 升级对象和出战角色是两件事
 *
 * 页面顶部的角色选择器只改「这次升级谁」，**不写 `profile.selected.characterId`**；
 * 后者是下一局的出战角色，不能因为在升级页翻看别的角色就被改掉。
 */

import type Phaser from 'phaser'
import { CHARACTERS, characterById } from '../catalog'
import type { MetaConfig } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import {
  SKILL_MAX_LEVEL,
  buySkillUpgrade,
  isUnlocked,
  skillLevelOf,
  skillUpgradeCost,
  unlock,
} from '../progress/progress'
import { Button } from '../ui/Button'
import type { OverlayFrame, OverlaySink } from '../ui/overlayFrame'
import { THEME, fontPx } from '../ui/theme'

export function buildUpgradePanel(
  scene: Phaser.Scene,
  sink: OverlaySink,
  frame: OverlayFrame,
  store: ProfileStore,
  meta: MetaConfig | null,
  /** 升级页当前操作的角色；由宿主保存，重建页面后仍指向同一个角色 */
  selectedCharacterId: string,
  /** 只更新宿主的“升级对象”，不改变出战角色，也不负责重绘 */
  onSelectCharacter: (id: string) => void,
  onChanged: (notice: string) => void,
): void {
  if (!meta) {
    text(scene, sink, frame.contentLeft, frame.contentTop, '配置表 meta.json 没加载上，升级不可用', {
      size: THEME.font.body,
      color: THEME.text.danger,
    })
    return
  }

  const profile = store.profile
  const characterId = selectedCharacterId
  const character = meta.characters[characterId]
  const display = characterById(characterId)
  const contentWidth = frame.panelWidth - THEME.space.lg * 2

  text(scene, sink, frame.contentLeft, frame.contentTop, `金币  ${profile.currency.coins}`, {
    size: THEME.font.heading,
    color: THEME.text.accent,
  })

  // 角色选择器：只列配置里存在的角色。未解锁的按钮显示原因并禁用，
  // 让玩家知道“不是坏了，是还没解锁”，而不是点了没反应。
  const options = CHARACTERS.filter((candidate) => meta.characters[candidate.id])
  const selectorGap = THEME.space.sm
  const selectorWidth =
    (contentWidth - selectorGap * Math.max(0, options.length - 1)) / Math.max(1, options.length)
  const selectorY = frame.contentTop + 50
  options.forEach((candidate, index) => {
    const unlocked = isUnlocked(profile, candidate.id)
    const selected = candidate.id === characterId
    const button = new Button(
      scene,
      frame.contentLeft + selectorWidth / 2 + index * (selectorWidth + selectorGap),
      selectorY,
      unlocked ? candidate.name : `${candidate.name} · 未解锁`,
      () => {
        if (!unlocked || selected) return
        onSelectCharacter(candidate.id)
        // 技能卡、等级和按钮都要换成新角色的，所以走宿主的整屏重建；
        // 空提示顺便清掉上一个角色留下的“升到 X 级”。
        onChanged('')
      },
      { width: selectorWidth, height: 32, fontSize: THEME.font.small },
    )
    button.setSelected(selected)
    button.setDisabled(!unlocked)
    sink.button(button)
  })

  text(
    scene,
    sink,
    frame.contentLeft,
    frame.contentTop + 72,
    `升级对象：${display?.name ?? characterId} · ${character?.passive.name ?? '被动未配置'}（不改变出战）`,
    { size: THEME.font.body, color: THEME.text.body },
  )
  text(
    scene,
    sink,
    frame.contentLeft,
    frame.contentTop + 95,
    character?.passive.description ?? '',
    { size: THEME.font.small, color: THEME.text.dim },
  )

  if (!character) {
    text(scene, sink, frame.contentLeft, frame.contentTop + 92, '这个角色没有成长配置', {
      size: THEME.font.body,
      color: THEME.text.danger,
    })
    return
  }

  const level = skillLevelOf(profile, meta, characterId)
  const current = character.skill.levels[level - 1]
  const nextCost = skillUpgradeCost(profile, meta, characterId)
  const cardTop = frame.contentTop + 122
  const cardLeft = frame.contentLeft
  const cardWidth = contentWidth
  const cardHeight = 276
  const card = scene.add
    .rectangle(cardLeft, cardTop, cardWidth, cardHeight, THEME.color.panel)
    .setOrigin(0)
    .setStrokeStyle(1, THEME.color.border)
  sink.track(card)

  text(scene, sink, cardLeft + THEME.space.md, cardTop + THEME.space.md, `技能：${character.skill.name}`, {
    size: THEME.font.heading,
    color: THEME.text.accent,
  })
  text(
    scene,
    sink,
    cardLeft + THEME.space.md,
    cardTop + 42,
    `${character.skill.description}    ${level} / ${SKILL_MAX_LEVEL} 级 · ${current?.name ?? ''}`,
    { size: THEME.font.small, color: THEME.text.dim },
  )

  character.skill.levels.forEach((skillLevel, index) => {
    const y = cardTop + 76 + index * 42
    const active = index + 1 <= level
    const row = scene.add
      .rectangle(cardLeft + THEME.space.md, y, cardWidth - THEME.space.xl, 34, active ? THEME.color.accentFill : THEME.color.disabled)
      .setOrigin(0)
      .setStrokeStyle(1, active ? THEME.color.accent : THEME.color.border, active ? 0.75 : 0.35)
    sink.track(row)
    text(scene, sink, cardLeft + THEME.space.lg, y + 8, `${index + 1}阶 ${skillLevel.name}`, {
      size: THEME.font.small,
      color: active ? THEME.text.accent : THEME.text.disabled,
    })
    text(
      scene,
      sink,
      cardLeft + THEME.space.lg + 104,
      y + 8,
      skillLevel.description,
      { size: THEME.font.small, color: active ? THEME.text.body : THEME.text.disabled },
    )
  })

  const buttonY = cardTop + cardHeight - THEME.space.lg
  const upgradeButton = new Button(
    scene,
    frame.cx + frame.panelWidth / 2 - THEME.space.lg - 70,
    buttonY,
    nextCost === null ? '已满级' : `升级  ${nextCost} 币`,
    () => {
      let result = { ok: false, notice: '' }
      const saved = store.update((draft) => {
        const bought = buySkillUpgrade(draft, meta, characterId)
        result = { ok: bought.ok, notice: bought.notice }
      })
      onChanged(result.ok && !saved ? `${result.notice}（但未保存到本机）` : result.notice)
    },
    { width: 130, height: 36, fontSize: THEME.font.small },
  )
  upgradeButton.setDisabled(nextCost === null || profile.currency.coins < nextCost)
  sink.button(upgradeButton)

  if (nextCost !== null) {
    text(
      scene,
      sink,
      cardLeft + THEME.space.md,
      buttonY - 7,
      level === 1
        ? '第 1 阶随角色解锁获得'
        : '每次升级后按钮会刷新；技能机制只随配置生效。',
      { size: THEME.font.small, color: THEME.text.dim },
    )
  }

  const locked = CHARACTERS.filter(
    (candidate) => meta.characters[candidate.id] && !isUnlocked(profile, candidate.id),
  )
  let unlockY = cardTop + cardHeight + THEME.space.md
  if (locked.length > 0) {
    text(scene, sink, frame.contentLeft, unlockY, '可解锁角色', {
      size: THEME.font.body,
      color: THEME.text.body,
    })
    unlockY += 26
    for (const candidate of locked) {
      const cost = meta.characters[candidate.id]!.unlockCost
      text(scene, sink, frame.contentLeft, unlockY + 7, `${candidate.name}    ${cost} 币`, {
        size: THEME.font.small,
        color: THEME.text.dim,
      })
      const unlockButton = new Button(
        scene,
        frame.cx + frame.panelWidth / 2 - THEME.space.lg - 45,
        unlockY + 14,
        '解锁',
        () => {
          let ok = false
          const saved = store.update((draft) => {
            ok = unlock(draft, meta, candidate.id).ok
          })
          // 刚解锁就把升级对象切过去：玩家花了币，下一步通常就是升它。
          if (ok) onSelectCharacter(candidate.id)
          onChanged(
            ok
              ? saved
                ? `已解锁：${candidate.name}`
                : `已解锁：${candidate.name}（但未保存到本机）`
              : `没解锁成：需要 ${cost} 币`,
          )
        },
        { width: 90, height: 30, fontSize: THEME.font.small },
      )
      unlockButton.setDisabled(profile.currency.coins < cost)
      sink.button(unlockButton)
      unlockY += 34
    }
  }

  text(
    scene,
    sink,
    frame.contentLeft,
    frame.cy + frame.panelHeight / 2 - 66,
    '币只在对局中获得；死亡不丢币。角色被动固定，不单独升级。',
    { size: THEME.font.small, color: THEME.text.dim },
  )
}

function text(
  scene: Phaser.Scene,
  sink: OverlaySink,
  x: number,
  y: number,
  value: string,
  options: { size: number; color: string },
): Phaser.GameObjects.Text {
  const obj = scene.add.text(x, y, value, {
    fontFamily: THEME.font.family,
    fontSize: fontPx(options.size),
    color: options.color,
  })
  sink.track(obj)
  return obj
}
