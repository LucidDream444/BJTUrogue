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
 * ⚠️ 遗留（**归 D4**）：玩家点过「全屏」之后按 Esc / F11 退出全屏，
 * 档里仍是 `'fullscreen'`，下一次进设置还是会显示「全屏」选中 —— 这时对不上就是
 * **真的**对不上了，不是默认值的问题。修它需要在 `scale` 上挂 `fullscreenchange`
 * 把档改回去（事件是异步的，改完再 `refresh()`，**不能**在点击处理函数里紧接着读
 * `scale.isFullscreen`，那时事件还没到，按钮会看起来没反应）。本次没做。
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
import { STARTER_SKILL_ID } from '../catalog'

/**
 * ⚠️ **占位值。** 角色目录（4 个角色的定位与差异化）是 D4 的设计输出，
 * 目前还没做。这里只放一个「初始角色」id，等角色目录定稿后由**它**生成 ——
 * 而不是让主菜单、升级页、结算三处各自写一遍 `'student'`。
 *
 * 需求 §4.1 的草图里写着「已解锁 3 / 4」，那是**草图的示例值，不是规格**：
 * 真实的初始解锁数量要等角色目录和资源经济定下来。
 */
export const STARTER_CHARACTER_ID = 'student'

/** 开局难度。需求 §4.1 的控件表：默认选中「普通」。 */
export const DEFAULT_DIFFICULTY = 'normal'

export function createDefaultProfile(): ProfileData {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    settings: {
      bgmVolume: 0.6,
      sfxVolume: 0.8,
      // 「窗口」而不是草图上的「全屏」—— 理由见文件头那条 ⚠️
      displayMode: 'windowed',
    },
    unlocks: {
      characters: [STARTER_CHARACTER_ID],
      // MVP：唯一的技能默认解锁。设计上「一个角色可以选择多个技能」——
      // 那需要一个装备界面，记在改动日志的缺口清单里。
      skills: [STARTER_SKILL_ID],
    },
    currency: { coins: 0 },
    upgrades: {},
    stats: { runs: 0, wins: 0, deaths: 0, bestDepth: 0 },
    selected: { characterId: STARTER_CHARACTER_ID, difficulty: DEFAULT_DIFFICULTY },
  }
}
