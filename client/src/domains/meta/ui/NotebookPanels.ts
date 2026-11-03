import type Phaser from 'phaser'
import { ARCHIVE_ART, CAMPUS_MENU_ART } from '@/core/assetManifest'
import type { Difficulty } from '@/core/config'
import { CHARACTERS, DIFFICULTY_LABELS, DIFFICULTY_ORDER, characterById } from '../catalog'
import type { MetaConfig } from '../metaConfig'
import { unlockedCount } from '../menu/menuModel'
import type { ProfileStore } from '../profile/ProfileStore'
import type { DisplayMode, ProfileData } from '../profile/types'
import { isUnlocked, totalLevelsFor } from '../progress/progress'
import type { RunSnapshot } from '../pause/runSnapshot'
import { ArchiveUI } from './ArchiveUI'
import { HELP_SECTIONS } from './helpContent'
import { ARCHIVE_THEME as A } from './theme'

function chapter(
  ui: ArchiveUI,
  number: string,
  title: string,
  description: string,
  art: string,
): void {
  ui.label(116, 222, `CAMPUS ARCHIVE  /  ${number}`, A.size.micro, ui.muted)
  ui.image(art, 292, 404, 136, 148)
  ui.label(292, 535, title, A.size.heading, ui.textColor, undefined, true).setOrigin(0.5)
  ui.label(130, 592, description, A.size.small, ui.muted, 320)
}

/**
 * 新档的首次操作引导。内容刻意只覆盖「移动 / 攻击 / 交互 / 暂停 / 死亡规则」，
 * 完整键位仍由冒险手册承载。右上角关闭与主按钮都会结束引导并写档。
 */
export function buildNotebookFirstRun(ui: ArchiveUI, onStart: () => void): void {
  ui.label(116, 222, 'FIRST DEPARTURE  /  00', A.size.micro, ui.muted)
  ui.image(ARCHIVE_ART.book, 292, 404, 136, 148)
  ui.label(292, 535, '第一次出发', A.size.heading, ui.textColor, undefined, true).setOrigin(0.5)
  ui.label(
    130,
    592,
    '记住最基本的操作。\n剩下的，交给校园另一面的冒险。',
    A.size.small,
    ui.muted,
    320,
  )

  ui.label(592, 190, '在校园醒来之前', A.size.heading, ui.textColor, undefined, true)
  ui.label(592, 236, '首次冒险速查  /  你可以随时跳过', A.size.micro, ui.muted)
  const rows = [
    ['WASD', '移动角色'],
    ['鼠标', '瞄准；按住左键连续攻击'],
    ['Space', '释放当前角色技能'],
    ['E / F', 'E 开宝箱或拾取；F 在楼梯口上下楼'],
    ['Esc', '暂停游戏；暂停菜单可查看完整说明'],
    ['死亡', '本局结束；金币、角色解锁与技能升级保留'],
  ] as const
  rows.forEach(([key, description], index) => {
    const y = 292 + index * 61
    ui.panel(592, y - 9, 140, 43, 0.7)
    ui.label(662, y + 12, key, A.size.small, ui.textColor, undefined, true).setOrigin(0.5)
    ui.label(760, y, description, A.size.small, ui.muted, 690)
    ui.rule(760, y + 45, 690)
  })

  ui.panel(592, 678, 858, 98, 0.62)
  ui.label(620, 696, '小提示', A.size.small, A.energy, undefined, true)
  ui.label(
    620,
    728,
    '之后可从校园地图的「说明」再次查看完整键位；首次引导不会重复出现。',
    A.size.micro,
    ui.muted,
    790,
  )
  ui.button(1275, 824, 354, 76, '开始冒险  →', onStart, true)
}

export function buildNotebookAchievements(ui: ArchiveUI, profile: ProfileData): void {
  chapter(
    ui,
    '01',
    '每一步，都有记录',
    '从踏入校园，到直面梦境。\n这里记录你的每一步成长。',
    ARCHIVE_ART.seal,
  )
  const count = unlockedCount(profile)
  ui.label(595, 182, '校史馆 · 冒险记录', A.size.heading, ui.textColor, undefined, true)
  ui.label(595, 229, '每一次归来，都会留下新的篇章。', A.size.small, ui.muted)
  const records = [
    ['累计冒险', `${profile.stats.runs}`, '次出发', ARCHIVE_ART.book],
    ['通关记录', `${profile.stats.wins}`, '次梦醒', ARCHIVE_ART.crystal],
    ['失败记录', `${profile.stats.deaths}`, '次重新启程', ARCHIVE_ART.paper],
    ['最深抵达', `${profile.stats.bestDepth}`, '层', ARCHIVE_ART.orb],
    ['角色档案', `${count.unlocked} / ${count.total}`, '位冒险伙伴', ARCHIVE_ART.sakura],
    ['校园资产', `${profile.currency.coins}`, '枚金币', ARCHIVE_ART.stone],
  ] as const
  records.forEach(([title, value, suffix, art], i) => {
    const x = 595 + (i % 2) * 440,
      y = 290 + Math.floor(i / 2) * 168
    ui.panel(x, y, 410, 144, 0.66)
    ui.image(art, x + 60, y + 66, 62, 68)
    ui.label(x + 114, y + 18, title, A.size.small, ui.muted)
    const number = ui.label(x + 114, y + 51, value, 38, ui.textColor, undefined, true)
    if (number.width > 270) number.setScale(270 / number.width)
    ui.label(x + 114, y + 106, suffix, A.size.micro, ui.muted)
  })
  ui.label(595, 827, '记录来自当前存档 · 永久成长与金币保留', A.size.micro, ui.muted)
}

export function buildNotebookHelp(ui: ArchiveUI): void {
  ui.label(116, 211, 'ADVENTURER’S HANDBOOK', A.size.micro, ui.muted)
  ui.image(ARCHIVE_ART.book, 290, 341, 100, 108)
  ui.label(290, 430, '冒险者手册', A.size.heading, ui.textColor, undefined, true).setOrigin(0.5)
  ui.label(132, 668, '熟悉操作，观察预警。\n按自己的节奏探索校园。', A.size.small, ui.muted, 320)
  let tab = 0
  const start = ui.root.list.length
  const render = (): void => {
    ui.root.list.slice(start).forEach((o) => o.destroy())
    HELP_SECTIONS.forEach((section, index) => {
      const hit = ui.button(
        290,
        514 + index * 78,
        320,
        56,
        `${index + 1 === 1 ? '01' : '02'}  ${section.title}`,
        () => {
          tab = index
          render()
        },
      )
      if (index === tab) {
        hit.setStrokeStyle(2, A.cyan)
        hit.on('pointerout', () => hit.setStrokeStyle(2, A.cyan))
      }
    })
    const section = HELP_SECTIONS[tab]!
    ui.label(592, 190, section.title, A.size.heading, ui.textColor, undefined, true)
    ui.label(
      592,
      236,
      tab === 0 ? '键位速查  /  鼠标与键盘' : '战斗指南  /  成长与结算',
      A.size.micro,
      ui.muted,
    )
    section.rows.forEach(([key, description], i) => {
      const y = 298 + i * 61
      ui.panel(592, y - 9, 140, 43, 0.7)
      ui.label(662, y + 12, key, A.size.small, ui.textColor, undefined, true).setOrigin(0.5)
      ui.label(760, y, description, A.size.small, ui.muted, 690)
      ui.rule(760, y + 45, 690)
    })
    ui.label(592, 824, 'Esc 返回上一页', A.size.micro, ui.muted)
  }
  render()
}

export interface NotebookSettingsParts {
  refresh(): void
}

/** Updates existing objects while dragging; never rebuilds the page in a slider callback. */
export function buildNotebookSettings(
  ui: ArchiveUI,
  store: ProfileStore,
  onDisplayMode: (mode: DisplayMode) => void,
): NotebookSettingsParts {
  chapter(ui, '03', '调整你的节奏', '音量会即时保存。\n调好声音与画面，再出发。', ARCHIVE_ART.orb)
  ui.label(595, 220, '声音与显示', A.size.heading, A.paper, undefined, true)
  const bgm = volumeControl(
    ui,
    650,
    350,
    '背景音乐',
    () => store.profile.settings.bgmVolume,
    (v) => store.setSettings({ bgmVolume: v }),
  )
  const sfx = volumeControl(
    ui,
    650,
    495,
    '游戏音效',
    () => store.profile.settings.sfxVolume,
    (v) => store.setSettings({ sfxVolume: v }),
  )
  ui.rule(595, 574, 850)
  ui.label(650, 609, '显示模式', A.size.body, A.paper)
  const windowed = ui.button(1110, 626, 186, 58, '窗口模式', () => onDisplayMode('windowed'))
  const fullscreen = ui.button(1320, 626, 186, 58, '全屏模式', () => onDisplayMode('fullscreen'))
  const mode = ui.label(650, 681, '', A.size.micro, A.muted)
  ui.label(650, 767, '拖动滑杆或点击轨道调节 · − / + 微调音量', A.size.small, A.muted)
  const refresh = (): void => {
    bgm()
    sfx()
    const full = store.profile.settings.displayMode === 'fullscreen'
    windowed.setStrokeStyle(full ? 1 : 2, full ? A.brass : A.cyan)
    fullscreen.setStrokeStyle(full ? 2 : 1, full ? A.cyan : A.brass)
    mode.setText(`当前：${full ? '全屏' : '窗口'}模式  ·  设置自动保存`)
  }
  windowed.on('pointerout', refresh)
  fullscreen.on('pointerout', refresh)
  refresh()
  return { refresh }
}

function volumeControl(
  ui: ArchiveUI,
  x: number,
  y: number,
  title: string,
  value: () => number,
  change: (v: number) => void,
): () => void {
  const width = 600
  ui.label(x, y - 58, title, A.size.body, A.paper)
  const percent = ui.label(x + width, y - 58, '', A.size.body, A.energy).setOrigin(1, 0)
  const track = ui.add(ui.scene.add.graphics())
  const thumb = ui.add(ui.scene.add.circle(x, y, 13, A.light).setStrokeStyle(3, A.cyan))
  const hit = ui.add(
    ui.scene.add
      .rectangle(x + width / 2, y, width, 48, A.ink, 0.001)
      .setInteractive({ useHandCursor: true }),
  )
  const refresh = (): void => {
    const v = Math.max(0, Math.min(1, value()))
    track
      .clear()
      .fillStyle(A.ink)
      .fillRoundedRect(x, y - 5, width, 10, 5)
    if (v > 0)
      track.fillGradientStyle(A.brass, A.cyan, A.brass, A.cyan, 1).fillRect(x, y - 5, width * v, 10)
    track.lineStyle(1, A.brass).strokeRoundedRect(x, y - 5, width, 10, 5)
    thumb.setX(x + width * v)
    percent.setText(`${Math.round(v * 100)}%`)
  }
  const update = (pointer: Phaser.Input.Pointer): void => {
    const matrix = hit.getWorldTransformMatrix()
    const local = matrix.applyInverse(pointer.worldX, pointer.worldY)
    change(Math.max(0, Math.min(1, (local.x + width / 2) / width)))
    refresh()
  }
  hit.on('pointerdown', update)
  hit.on('drag', update)
  ui.scene.input.setDraggable(hit)
  ui.button(1324, y, 54, 44, '−', () => {
    change(Math.max(0, value() - 0.05))
    refresh()
  })
  ui.button(1394, y, 54, 44, '+', () => {
    change(Math.min(1, value() + 0.05))
    refresh()
  })
  refresh()
  return refresh
}

export function buildNotebookRunSetup(
  ui: ArchiveUI,
  profile: ProfileData,
  meta: MetaConfig | null,
  onCharacter: (id: string) => void,
  onDifficulty: (d: Difficulty) => void,
  onStart: () => void,
  onUpgrade: () => void,
): void {
  ui.label(115, 215, '选择今天的冒险伙伴', A.size.heading, A.paper, undefined, true)
  ui.label(115, 260, '带上勇气，走进熟悉校园的另一面。', A.size.small, A.muted)
  CHARACTERS.forEach((character, i) => {
    const x = 115 + i * 309,
      unlocked = isUnlocked(profile, character.id),
      selected = profile.selected.characterId === character.id
    const def = meta?.characters[character.id]
    ui.panel(x, 315, 282, 388, 0.74)
    const key =
      CAMPUS_MENU_ART.characterCards[character.id as keyof typeof CAMPUS_MENU_ART.characterCards]
    ui.orbit(x + 141, 491, 77, selected ? A.cyan : A.brass)
    if (key) ui.portrait(key, x + 141, 430, 148).setAlpha(unlocked ? 1 : 0.35)
    ui.label(
      x + 141,
      343,
      character.name,
      A.size.heading,
      unlocked ? A.paper : A.muted,
      undefined,
      true,
    ).setOrigin(0.5)
    ui.label(x + 141, 528, character.blurb, A.size.micro, A.muted).setOrigin(0.5)
    ui.label(
      x + 141,
      573,
      def?.skill.name ?? '成长档案待补',
      A.size.body,
      A.paper,
      undefined,
      true,
    ).setOrigin(0.5)
    ui.label(
      x + 25,
      611,
      unlocked ? (def?.skill.description ?? '') : `${def?.unlockCost ?? '—'} 金币解锁 · 前往升级页`,
      A.size.micro,
      A.muted,
      232,
    )
    ui.label(
      x + 141,
      672,
      selected ? '◆ 当前出战' : unlocked ? '点击选择' : '未解锁',
      A.size.small,
      selected ? A.energy : A.muted,
    ).setOrigin(0.5)
    const hit = ui.add(ui.scene.add.rectangle(x + 141, 509, 282, 388, A.ink, 0.001))
    if (selected) hit.setStrokeStyle(2, A.cyan)
    if (unlocked)
      hit.setInteractive({ useHandCursor: true }).on('pointerup', () => onCharacter(character.id))
  })
  ui.panel(1080, 215, 368, 488, 0.86)
  ui.label(1115, 247, '冒险难度', A.size.heading, A.paper, undefined, true)
  ui.label(1115, 299, '选择适合你的挑战', A.size.small, A.muted)
  DIFFICULTY_ORDER.forEach((difficulty, i) => {
    const hit = ui.button(1264, 377 + i * 91, 292, 64, DIFFICULTY_LABELS[difficulty], () =>
      onDifficulty(difficulty),
    )
    if (profile.selected.difficulty === difficulty) {
      hit.setStrokeStyle(2, A.cyan)
      hit.on('pointerout', () => hit.setStrokeStyle(2, A.cyan))
    }
  })
  ui.label(1115, 619, '角色与难度会记住，\n下次出发无需重复选择。', A.size.micro, A.muted, 290)
  ui.button(1264, 765, 366, 83, '开始闯关  →', onStart, true)
  ui.button(881, 765, 228, 52, '查看角色升级', onUpgrade)
  ui.label(
    365,
    753,
    `出战：${characterById(profile.selected.characterId)?.name ?? '—'}\n难度：${DIFFICULTY_LABELS[profile.selected.difficulty]}`,
    A.size.small,
    A.muted,
  )
}

export function buildNotebookQuit(
  ui: ArchiveUI,
  profile: ProfileData,
  onConfirm: () => void,
  onCancel: () => void,
  inBattle = false,
): void {
  ui.label(115, 220, 'END OF CHAPTER', A.size.micro, A.muted)
  ui.image(ARCHIVE_ART.grimoire, 420, 450, 215, 265)
  ui.orbit(420, 590, 158)
  ui.label(420, 662, '下一次冒险，再见。', A.size.heading, A.paper, undefined, true).setOrigin(0.5)
  ui.panel(760, 247, 690, 474, 0.86)
  ui.label(814, 298, inBattle ? '要返回校园吗？' : '今天就到这里吗？', 38, A.paper, undefined, true)
  ui.label(
    814,
    365,
    inBattle
      ? '本局临时进度将结束。\n永久解锁、升级与金币会保留。'
      : '已获得的金币与永久成长会保留。\n下次回来，可以继续从校园出发。',
    A.size.body,
    A.muted,
    565,
  )
  ui.rule(814, 474, 580)
  ui.label(
    814,
    503,
    `当前金币  ${profile.currency.coins}   ·   已解锁角色  ${unlockedCount(profile).unlocked} / ${CHARACTERS.length}`,
    A.size.small,
    A.paper,
  )
  ui.label(
    814,
    556,
    inBattle ? '确认后回到校园地图。' : '若浏览器无法关闭页面，请手动关闭标签页。',
    A.size.micro,
    A.muted,
    570,
  )
  ui.button(957, 648, 280, 68, inBattle ? '继续本局' : '留在校园', onCancel, true)
  ui.button(1271, 648, 230, 52, inBattle ? '确认返回校园' : '确认退出', onConfirm)
}

/** Pause keeps the same host callbacks and keyboard focus order as before. */
export function buildNotebookPause(
  ui: ArchiveUI,
  profile: ProfileData,
  snapshot: RunSnapshot | null,
  onAction: (index: number) => void,
): Phaser.GameObjects.Rectangle[] {
  const labels = ['继续游戏', '操作说明', '设置', '返回校园']
  const buttons = labels.map((title, index) =>
    ui.button(300, 314 + index * 104, 330, 68, title, () => onAction(index), index === 0),
  )
  ui.label(135, 226, '让冒险，稍作停留。', A.size.body, A.paper, undefined, true)
  ui.label(635, 800, '↑ ↓ 选择 · Enter 确认 · Esc 继续当前冒险', A.size.small, A.muted)
  ui.panel(592, 220, 854, 546, 0.86)
  ui.label(635, 252, '本局档案', A.size.heading, A.paper, undefined, true)
  if (snapshot) {
    const name = characterById(snapshot.characterId)?.name ?? snapshot.characterId
    const key =
      CAMPUS_MENU_ART.characterCards[
        snapshot.characterId as keyof typeof CAMPUS_MENU_ART.characterCards
      ]
    ui.orbit(777, 529, 108)
    if (key) ui.portrait(key, 777, 442, 200)
    ui.label(777, 582, name, A.size.heading, A.paper, undefined, true).setOrigin(0.5)
    ui.label(777, 633, '已暂停 · 等你归来', A.size.micro, A.muted).setOrigin(0.5)
    const rows = [
      ['生命', snapshot.hp + ' / ' + snapshot.maxHp],
      [
        '护盾',
        snapshot.shield === undefined ? '—' : snapshot.shield + ' / ' + (snapshot.maxShield ?? '—'),
      ],
      [
        '能量',
        snapshot.magic === undefined ? '—' : snapshot.magic + ' / ' + (snapshot.maxMagic ?? '—'),
      ],
      ['武器', snapshot.weaponName ?? '—'],
      ['技能', snapshot.skillName ?? '—'],
      ['永久升级', totalLevelsFor(profile, snapshot.characterId) + ' 次'],
    ]
    rows.forEach(([label, value], index) => {
      const y = 335 + index * 59
      ui.label(974, y, label!, A.size.small, A.muted)
      const text = ui.label(1395, y, value!, A.size.small, A.paper).setOrigin(1, 0)
      if (text.width > 284) text.setScale(284 / text.width)
      ui.rule(974, y + 37, 421)
    })
  } else ui.label(636, 355, '本局档案暂不可用', A.size.body, A.muted)
  return buttons
}
