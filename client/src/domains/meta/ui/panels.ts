/**
 * 操作说明与设置这两块**内容**。**主菜单和暂停菜单共用同一份**
 * —— 需求 §4.3 的备注写得很明确：「与主菜单的说明界面是同一个」。
 *
 * 一份代码、两处入口，就不会出现"暂停菜单里的说明少了一条"这种事，
 * 也不需要靠人去比对两个界面的文案是否一致。
 */

import type Phaser from 'phaser'
import type { ProfileStore } from '../profile/ProfileStore'
import type { DisplayMode } from '../profile/types'
import { Button } from './Button'
import type { OverlayFrame, OverlaySink } from './overlayFrame'
import { Slider } from './Slider'
import { THEME, fontPx } from './theme'

export interface PanelSink extends OverlaySink {
  slider(slider: Slider): void
}

/** UC01 的操作说明。主菜单与暂停菜单共用，内容以当前产品键位为准。 */
export function buildHelpPanel(scene: Phaser.Scene, sink: PanelSink, frame: OverlayFrame): void {
  const columns = [
    {
      title: '基础操作',
      x: frame.contentLeft,
      width: frame.panelWidth / 2 - THEME.space.xl,
      rows: [
        ['WASD', '移动角色'],
        ['鼠标', '瞄准；按住左键连续攻击'],
        ['Space', '释放当前角色技能'],
        ['X', '循环切换已有武器'],
        ['1 / 2', '直接装备对应武器槽'],
        ['E', '开启宝箱 / 拾取地上武器'],
        ['F', '站在楼梯入口时上下楼'],
        ['Esc', '暂停游戏'],
      ],
    },
    {
      title: '战斗与结算',
      x: frame.cx + THEME.space.sm,
      width: frame.panelWidth / 2 - THEME.space.xl,
      rows: [
        ['护盾', '先扣护盾，护盾清空后扣生命'],
        ['清房', '清空敌人后可开宝箱并选择强化'],
        ['宝箱', '靠近后按 E 开启，武器掉落也按 E 拾取'],
        ['技能', '每个角色只有一个技能，冷却/充能显示在底部'],
        ['死亡', '本局临时进度结束；金币和永久成长保留'],
        ['暂停', 'Esc 或右上角暂停按钮；再次按 Esc 返回游戏'],
        ['设置', '设置面板可调 BGM、音效音量与显示模式'],
        ['提示', '敌方攻击前摇要提前走位，不要贴脸硬吃'],
      ],
    },
  ]

  for (const column of columns) {
    sink.track(
      scene.add.text(column.x, frame.contentTop, column.title, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.body),
        color: THEME.text.accent,
      }),
    )
    const keyWidth = 94
    column.rows.forEach(([key, description], index) => {
      const rowY = frame.contentTop + 30 + index * 34
      sink.track(
        scene.add
          .rectangle(column.x, rowY, keyWidth, 23, THEME.color.panel)
          .setOrigin(0, 0)
          .setStrokeStyle(1, THEME.color.border),
      )
      sink.track(
        scene.add
          .text(column.x + keyWidth / 2, rowY + 11.5, key, {
            fontFamily: THEME.font.family,
            fontSize: fontPx(THEME.font.small),
            color: THEME.text.body,
          })
          .setOrigin(0.5),
      )
      sink.track(
        scene.add.text(column.x + keyWidth + THEME.space.sm, rowY + 3, description, {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.small),
          color: THEME.text.dim,
          wordWrap: { width: Math.max(90, column.width - keyWidth - THEME.space.sm) },
        }),
      )
    })
  }
}

export interface SettingsPanelParts {
  fullscreen: Button
  windowed: Button
}

/**
 * 设置面板：BGM 音量 / 音效音量 / 显示模式。
 *
 * **分辨率不做** —— 已决定保留 `Scale.RESIZE`，那个下拉框在 RESIZE 下没有对应物
 * （见 `profile/defaults.ts` 的说明）。
 *
 * `onDisplayMode` 由宿主给：应用全屏是场景级的事（`scale.startFullscreen()`），
 * 而且**必须发生在点击处理函数里**（`AGENTS.md` §九 第 3 条）。
 */
export function buildSettingsPanel(
  scene: Phaser.Scene,
  sink: PanelSink,
  frame: OverlayFrame,
  store: ProfileStore,
  onDisplayMode: (mode: DisplayMode) => void,
): SettingsPanelParts {
  const sliderWidth = Math.max(150, frame.panelWidth - THEME.space.xl * 2 - 140)
  const x = frame.contentLeft
  const s = store.profile.settings

  sink.slider(
    new Slider(scene, x + 70, frame.contentTop + 30, 'BGM 音量', s.bgmVolume, {
      width: sliderWidth,
      onChange: (v) => store.setSettings({ bgmVolume: v }),
    }),
  )
  sink.slider(
    new Slider(scene, x + 70, frame.contentTop + 90, '音效音量', s.sfxVolume, {
      width: sliderWidth,
      onChange: (v) => store.setSettings({ sfxVolume: v }),
    }),
  )

  sink.track(
    scene.add.text(x, frame.contentTop + 134, '显示模式', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.body),
      color: THEME.text.body,
    }),
  )

  const fullscreen = new Button(
    scene,
    x + 130,
    frame.contentTop + 134,
    '全屏',
    () => onDisplayMode('fullscreen'),
    { width: 88, height: 34, fontSize: THEME.font.small, activateOn: 'up' },
  )
  const windowed = new Button(
    scene,
    x + 226,
    frame.contentTop + 134,
    '窗口',
    () => onDisplayMode('windowed'),
    { width: 88, height: 34, fontSize: THEME.font.small, activateOn: 'up' },
  )
  sink.button(fullscreen)
  sink.button(windowed)

  // 这一行原来写着「（占位期没有音频文件：这两个值会被存下来，但暂时没有声音可调）」，
  // 2026-10-16 删掉：音频到位了，两个值**都真的接到了声音上**。
  // 它们不是绝对音量，是**乘在配置表上的系数**（红线 2：数值在 `public/config/`）：
  //   BGM  → `cfg.bgmVolume  × 档里 bgmVolume`  （`CombatAudio.setVolumes`）
  //   音效 → `cfg.shotVolume × 档里 sfxVolume`  （`CombatAudio.fire`）
  // 由 `BattleScene.syncAudio()` 推下去，而且它订了档的变化 —— 战斗里改实时生效。
  //
  // ⚠️ 只覆盖**已接线**的声音。清单里那 9 条 `sfx_enemy_*` / `sfx_kill_flourish`
  // 还是 `placeholder: true`（文件没到），而且它们的 `SfxPool.play(key, pitch, volume)`
  // 音量是**调用方传的**，没人乘档里的值 —— 那批音效接进来的时候要一起接上
  // `sfxVolume`，否则这一项只作用在玩家的枪声上。

  applyDisplayModeSelection({ fullscreen, windowed }, s.displayMode)
  return { fullscreen, windowed }
}

export function applyDisplayModeSelection(parts: SettingsPanelParts, mode: DisplayMode): void {
  parts.fullscreen.setSelected(mode === 'fullscreen')
  parts.windowed.setSelected(mode === 'windowed')
}
