/**
 * 角色升级页（需求 §4.4 的 MVP 简化版）。**它是一块内容，不是场景** ——
 * 由主菜单的弹层壳子装起来（`buildOverlayFrame`），和说明 / 设置并列。
 *
 * ## 与原需求草图的差异（刻意简化，已记进缺口清单）
 *
 * 草图上是"独立页面 + 立绘 + 技能四选一 + 武器面板"。MVP 版做了三件事：
 * 拿掉了立绘与武器面板（没有美术、武器表归 D1 且未起草）、
 * 拿掉了技能选择（只有一个技能）、把"升级"从一个大按钮改成了**每条成长线
 * 一个按钮**（这样成本与效果能并排显示，不用点进去才知道要多少钱）。
 */

import type Phaser from 'phaser'
import { CHARACTERS, characterById } from '../catalog'
import type { MetaConfig, UpgradeTrackDef } from '../metaConfig'
import { costOfNextLevel } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import {
  buyUpgrade,
  formatPerLevel,
  formatTotal,
  isUnlocked,
  levelOf,
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
  /** 买完（或没买成）之后怎么办。**由主菜单重建整屏并显示一句提示** ——
   *  这里不能自己往 `frame.notice` 上写：重建会把那个对象销毁掉。 */
  onChanged: (notice: string) => void,
): void {
  if (!meta) {
    // 配置没加载上时**说出来**。不说的话界面上是空的，看起来像"还没有成长项"。
    sink.track(
      scene.add.text(frame.contentLeft, frame.contentTop, '配置表 meta.json 没加载上，升级不可用', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.body),
        color: THEME.text.danger,
      }),
    )
    return
  }

  const profile = store.profile
  const characterId = profile.selected.characterId
  const character = meta.characters[characterId]

  sink.track(
    scene.add.text(frame.contentLeft, frame.contentTop, `金币  ${profile.currency.coins}`, {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.heading),
      color: THEME.text.accent,
    }),
  )

  // ⚠️ 这里的每一段都**接着上一段的返回值往下排**，最后那句提示也接在 y 后面 ——
  // 曾经底部那句提示用的是写死的 `面板底 - 58`，而内容是从上往下顺的：
  // 可解锁项一多，两者就撞在一起（实测 3 个占位角色时正好压在第 2 行上）。
  // 写死的锚点和"顺下来的内容"必然会对不上，**这个面板里不许再有第二个真值来源**。
  let y = frame.contentTop + 36
  y = drawSection(
    scene,
    sink,
    frame,
    store,
    onChanged,
    y,
    `角色：${characterById(characterId)?.name ?? characterId}`,
    character?.tracks ?? [],
    characterId,
  )

  y += 8
  for (const [skillId, skill] of Object.entries(meta.skills)) {
    // MVP 里技能默认就是解锁的（见 progress.ts 的简化说明），所以这里只管升级。
    y = drawSection(
      scene,
      sink,
      frame,
      store,
      onChanged,
      y,
      `技能：${skill.name} · ${skill.description}`,
      skill.tracks,
      skillId,
    )
  }

  y = drawUnlockSection(scene, sink, frame, store, meta, onChanged, y + 8)

  sink.track(
    scene.add.text(frame.contentLeft, y + 6, '币只在对局中获得；死亡不丢币。', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.small),
      color: THEME.text.dim,
    }),
  )
}

/**
 * 「可解锁」一段：列出还没解锁的角色（价格来自 meta.json 的 `unlockCost`）。
 *
 * 只列**目录里认识、且 meta.json 里有定价**的项 —— 目录里有而表里没有的，
 * 说明那个角色还没做（只有占位名字），不该摆在界面上收钱。
 */
function drawUnlockSection(
  scene: Phaser.Scene,
  sink: OverlaySink,
  frame: OverlayFrame,
  store: ProfileStore,
  meta: MetaConfig,
  onChanged: (notice: string) => void,
  y: number,
): number {
  const locked = CHARACTERS.filter(
    (c) => meta.characters[c.id] !== undefined && !isUnlocked(store.profile, c.id),
  )
  if (locked.length === 0) return y

  sink.track(
    scene.add.text(frame.contentLeft, y, '可解锁', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.body),
      color: THEME.text.body,
    }),
  )
  let rowY = y + 22
  for (const c of locked) {
    const cost = meta.characters[c.id]?.unlockCost ?? 0
    const affordable = store.profile.currency.coins >= cost
    sink.track(
      scene.add.text(frame.contentLeft, rowY + 8, `${c.name}    ${cost} 币`, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      }),
    )
    const button = new Button(
      scene,
      frame.cx + frame.panelWidth / 2 - THEME.space.lg - 45,
      rowY + 14,
      '解锁',
      () => {
        let ok = false
        store.update((draft) => {
          ok = unlock(draft, meta, c.id).ok
        })
        onChanged(ok ? `已解锁：${characterById(c.id)?.name ?? c.id}` : `没解锁成：需要 ${cost} 币`)
      },
      { width: 90, height: 32, fontSize: THEME.font.small },
    )
    button.setDisabled(!affordable)
    sink.button(button)
    rowY += 34
  }
  return rowY
}

/** 画一组成长线（一个角色或一个技能），返回下一个可用 y */
function drawSection(
  scene: Phaser.Scene,
  sink: OverlaySink,
  frame: OverlayFrame,
  store: ProfileStore,
  onChanged: (notice: string) => void,
  y: number,
  title: string,
  tracks: readonly UpgradeTrackDef[],
  ownerId: string,
): number {
  sink.track(
    scene.add.text(frame.contentLeft, y, title, {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.body),
      color: THEME.text.body,
    }),
  )
  let rowY = y + 22

  for (const track of tracks) {
    const level = levelOf(store.profile, ownerId, track.id)
    const cost = costOfNextLevel(track, level)
    const maxed = cost === null
    const affordable = !maxed && store.profile.currency.coins >= cost

    const detail = [
      `${track.name}  ${formatPerLevel(track)}/级`,
      `当前 ${formatTotal(track, level)}（${level} / ${track.maxLevel} 级）`,
      maxed ? '已满级' : `下一级 ${cost} 币`,
    ].join('    ')
    sink.track(
      scene.add.text(frame.contentLeft, rowY + 8, detail, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      }),
    )

    const button = new Button(
      scene,
      frame.cx + frame.panelWidth / 2 - THEME.space.lg - 45,
      rowY + 14,
      maxed ? '满级' : '升级',
      () => {
        // `buyUpgrade` 返回结果而不是抛异常，所以这里接得住 ——
        // 失败时**必须给一句提示**，否则按钮看起来就是"点了没反应"。
        let bought = false
        store.update((draft) => {
          bought = buyUpgrade(draft, ownerId, track).ok
        })
        onChanged(
          bought ? `${track.name} 升到 ${level + 1} 级` : `没买成：${track.name} 需要 ${cost} 币`,
        )
      },
      { width: 90, height: 32, fontSize: THEME.font.small },
    )
    button.setDisabled(maxed || !affordable)
    sink.button(button)
    rowY += 34
  }
  return rowY
}
