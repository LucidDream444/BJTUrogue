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

/** UC01 要求的操作说明内容。**键位还没定稿，所以如实标出来。** */
export function buildHelpPanel(scene: Phaser.Scene, sink: PanelSink, frame: OverlayFrame): void {
  const lines = [
    '移动、攻击、交互的具体键位尚未定稿（归 D1）——',
    '定稿后这张表要跟着改，改动点在 domains/meta/ui/panels.ts。',
    '',
    '死亡规则（已定）：',
    '· 血量归零 = 本局结束，本局内的临时进度不保存',
    '· 永久解锁与升级次数不因死亡清除',
    '',
    '暂停 / 继续：见游戏内右上角的暂停按钮',
  ]
  sink.track(
    scene.add.text(frame.contentLeft, frame.contentTop, lines.join('\n'), {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.body),
      color: THEME.text.dim,
      lineSpacing: 6,
      wordWrap: { width: frame.panelWidth - THEME.space.lg * 2 },
    }),
  )
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
    { width: 88, height: 34, fontSize: THEME.font.small },
  )
  const windowed = new Button(
    scene,
    x + 226,
    frame.contentTop + 134,
    '窗口',
    () => onDisplayMode('windowed'),
    { width: 88, height: 34, fontSize: THEME.font.small },
  )
  sink.button(fullscreen)
  sink.button(windowed)

  // ⚠️ 如实说清楚：音频文件一个都还没有（`public/assets/audio/` 是空的），
  // 所以这两个滑杆现在**存得下、听得见才怪**。不说的话，测试的人会去报
  // "音量滑杆没反应"，而那是个假 bug。
  sink.track(
    scene.add.text(
      x,
      frame.contentTop + 164,
      '（占位期没有音频文件：这两个值会被存下来，但暂时没有声音可调）',
      {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      },
    ),
  )

  applyDisplayModeSelection({ fullscreen, windowed }, s.displayMode)
  return { fullscreen, windowed }
}

export function applyDisplayModeSelection(parts: SettingsPanelParts, mode: DisplayMode): void {
  parts.fullscreen.setSelected(mode === 'fullscreen')
  parts.windowed.setSelected(mode === 'windowed')
}
