/**
 * 新档的默认值。**只有这一处** —— 首次启动、损坏恢复、迁移终点都走它，
 * 所以「一个新玩家开局有什么」永远只有一个答案。
 *
 * 数值出处：《需求分析》§4.5 设置菜单 —— BGM 音量 60%、音效音量 80%、
 * 显示模式默认**「窗口」**（草图那条写的是「全屏」，**被推翻了**，见下）。
 * 这几条是界面草图上写死的默认值，不是平衡数值，
 * 所以它们属于"档的初值"；一旦变成会被策划调的量，就该搬到 `public/config/`
 * （红线 2）并在这里读配置。
 *
 * ---
 *
 * ## ⚠️ 已推翻（2026-10-16）：`displayMode` 的默认值是「窗口」，不是草图上的「全屏」
 *
 * 《需求分析》§4.5 的草图画的是「显示模式 = ● 全屏（选中）」。**做不到，所以没照做。**
 *
 * 浏览器里 `requestFullscreen()` 必须由**用户手势**触发（`AGENTS.md` §九 第 3 条），
 * 启动时不管档里写什么都只能停在窗口模式。于是「档里写全屏」的直接后果是：
 * 玩家一进设置，「全屏」是**选中**的，而眼前其实是窗口模式 —— 设置界面从第一帧
 * 就在说假话；而且他要先点一次「全屏」才会真的全屏，看起来像是那个按钮坏了。
 *
 * **默认值和真实状态一致，比和草图一致重要。** 草图那一条要改的话，
 * 改的是需求文档里那个圆点（`docs/需求分析与产品设计.md` §4.5），不是这里的实现。
 *
 * ## ✅ 全屏状态同步（2026-10-22）
 *
 * 设置项跟随浏览器**实际**全屏状态：请求发出时不抢先改档，收到
 * `ENTER_FULLSCREEN` / `LEAVE_FULLSCREEN` 后才把 `displayMode` 写回去。
 * 因此点击按钮、浏览器拒绝请求、以及玩家按 Esc 退出全屏，都不会留下
 * “界面显示全屏、实际是窗口”的状态。
 *
 * 浏览器自己的 F11 全屏不属于页面 Fullscreen API，无法与普通窗口变化可靠区分；
 * 本设置只表示游戏主动管理的全屏模式。
 *
 * ---
 *
 * ## ✅ 已决定（2026-10-14）：**保留 `Scale.RESIZE`，档里不含分辨率字段**
 *
 * 需求 §4.5 的设置草图里有「分辨率 = 1920×1080」的下拉框，但 `main.ts` 用的是
 * `Scale.RESIZE`（画布跟随窗口）—— 这种情况下**没有"当前分辨率"这个东西可以切**：
 * 实测窗口 1280×720 时画布是 1256×581，跟 1920×1080 无关。
 *
 * 所以档里不放分辨率字段、设置菜单也不放这一项：**放一个不生效的下拉框比不放更糟**，
 * 玩家会以为它生效了。`displayMode`（全屏 / 窗口）保留，它是实的。
 *
 * 真要给玩家调画面，`RESIZE` 下有意义的是 **UI / 画面缩放**（窗口小时 HUD 不挤），
 * 不是分辨率 —— 等有人提了再做，见 `持续更新10.14.md`。
 */

import { PROFILE_SCHEMA_VERSION, type ProfileData } from './types'

/**
 * 角色目录（当前 3 个角色，各有独立战斗身份）由 `catalog.ts` 维护；
 * 这里只放初始角色 id，避免主菜单、升级页、结算三处各自写一遍 `'student'`。
 *
 * 需求 §4.1 草图里的角色数量是示例；当前目录为 3 个角色，初始只解锁新生。
 */
export const STARTER_CHARACTER_ID = 'student'

/** 开局难度。需求 §4.1 的控件表：默认选中「普通」。 */
export const DEFAULT_DIFFICULTY = 'normal'

export function createDefaultProfile(): ProfileData {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    revision: 0,
    settings: {
      bgmVolume: 0.6,
      sfxVolume: 0.8,
      // 「窗口」而不是草图上的「全屏」—— 理由见文件头那条 ⚠️
      displayMode: 'windowed',
    },
    unlocks: {
      characters: [STARTER_CHARACTER_ID],
      // 新技能模型按角色固定，不再有全局技能解锁列表。
      skills: [],
    },
    currency: { coins: 0 },
    upgrades: {},
    stats: { runs: 0, wins: 0, deaths: 0, bestDepth: 0 },
    selected: { characterId: STARTER_CHARACTER_ID, difficulty: DEFAULT_DIFFICULTY },
  }
}
