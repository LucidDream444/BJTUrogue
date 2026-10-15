/**
 * 资源清单 —— **纯数据，零依赖**。
 *
 * 为什么和 `assets.ts` 拆成两个文件：清单的消费者里有一个是**纯逻辑**的
 * （`core/config.ts` 要校验配置表里的 `textureKey` 是否存在）。如果把清单和生成占位纹理的代码
 * 放在一起，纯逻辑就被拖进了 Phaser —— 而 `import('phaser')` 在 node 下会直接
 * `ReferenceError: window is not defined`，所有不需要浏览器的单测当场全崩。
 *
 * 所以：**清单（本文件）零依赖；加载与占位生成（`assets.ts`）才允许 import Phaser。**
 *
 * ---
 *
 * ## 占位纹理：为什么用独立 key 而不是「和真图同 key」
 *
 * `[源码]` `gameobjects/graphics/Graphics.js`：`generateTexture(key, w, h)` 在 key 已存在、
 * 且源是 canvas 纹理时，**是往同一张 canvas 上再画一次** —— 不替换、不报错。
 *
 * 「同 key」方案看起来更省事（占位期和正式期共用一个 key，什么都不用解析），但真美术到位后
 * 只要漏掉一道守卫，**真图会被白方块静默覆盖**，而且**只有到接入真美术那天才会发现**。
 *
 * 独立 key 的失败方式相反：谁硬编码了真 key，占位期立刻显示 `__MISSING` 纹理，
 * **开发时当场看得见**。用一次当场报错，换掉一次三个月后的静默失效。
 *
 * 代价是必须走 `resolveTextureKey()`，由 `architecture.test.ts` 的字面量扫描兜住。
 */

export type AssetKind = 'image' | 'spritesheet' | 'audio'

export interface AssetEntry {
  /** 逻辑 key。游戏代码只用它，从不写路径。 */
  key: string
  /** 相对 `public/assets/` 的路径；`kind: 'audio'` 时是**不含扩展名的基名** */
  path: string
  /** `true` = 运行时生成白色方块 / 播放时静默返回，不发起网络加载 */
  placeholder: boolean
  kind: AssetKind
  /** 占位方块的尺寸（也是真图应有的尺寸约定） */
  width?: number
  height?: number
  /** `kind: 'spritesheet'` 时必填 */
  frameWidth?: number
  frameHeight?: number
  /** `kind: 'audio'` 时列出所有格式，按优先级排列（Safari 不支持 ogg） */
  codecs?: readonly string[]
}

/**
 * 命名规范见 `client/public/assets/README.md`（**那份文件是唯一真值，owner 是 D4**）：
 * `<域>_<对象>_<变体>[_<帧号>]`，全小写下划线，按 `sprites/` `audio/sfx/` 分层。
 *
 * ⚠️ 改这里 = 改共用层（`core/`），《人员分工方案》要求全员同意。
 */
/** Split HUD layers derived from the supplied bars; only the fill is cropped at runtime. */
export const STATUS_HUD_ART = {
  health: {
    icon: 'ui_campus_heart',
    empty: 'ui_campus_bar_pink_empty',
    fill: 'ui_campus_bar_pink_fill',
  },
  stamina: {
    icon: 'ui_campus_energy',
    empty: 'ui_campus_bar_blue_empty',
    fill: 'ui_campus_bar_blue_fill',
  },
  shield: {
    icon: 'ui_campus_shield',
    empty: 'ui_campus_bar_blue_empty',
    fill: 'ui_campus_bar_blue_fill',
  },
} as const
export const STATUS_BAR_FILL_BOUNDS = { left: 31, rightInset: 32 } as const

export const TANK_ART = { walk: 'enemy_tank_walk', attack: 'enemy_tank_idle' } as const

export const WEAPON_ART = { chest: 'chest', pistol: 'weapon_pistol' } as const

export const GAME_CURSOR_ART = {
  arrow: { key: 'ui_cursor_arrow_game', hotspotX: 7, hotspotY: 6 },
  hand: { key: 'ui_cursor_hand_game', hotspotX: 13, hotspotY: 5 },
} as const
export const PROJECTILE_ART: Record<string, string> = {
  pencil: 'bullet_default',
  pulse: 'pulse_projectile',
  venom: 'venom_projectile',
  flare: 'flare_projectile',
  rail: 'rail_projectile',
  smg: 'smg_projectile',
}

export const GAME_AUDIO = {
  bgm: 'bgm_pixel_dungeon_rush',
  shot: 'sfx_player_shot',
} as const

export const STAGE2_BOSS_ART = {
  idle: 'enemy_stage2_idle',
  attack: 'enemy_stage2_attack',
} as const

export const FINAL_BOSS_ART = {
  walk: 'boss_final_walk',
  attack: 'boss_final_attack',
  idle: 'boss_final_idle',
  poison: 'boss_final_poison',
} as const

export const CAMPAIGN_ART = {
  title: 'game_title',
  level1: 'level_1_classroom',
  level2: 'level_2_laboratory',
  level3: 'level_3_classroom',
} as const

export const ASSETS: readonly AssetEntry[] = [
  {
    key: GAME_AUDIO.bgm,
    path: 'audio/bgm/bgm_pixel_dungeon_rush',
    kind: 'audio',
    placeholder: false,
    codecs: ['mp3'],
  },
  {
    key: GAME_AUDIO.shot,
    path: 'audio/sfx/player/sfx_player_shot',
    kind: 'audio',
    placeholder: false,
    codecs: ['mp3'],
  },
  {
    key: 'enemy_stage2_idle',
    path: 'sprites/enemies/stage2_boss/enemy_stage2_idle.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 128,
    height: 128,
    frameWidth: 128,
    frameHeight: 128,
  },
  {
    key: 'enemy_stage2_attack',
    path: 'sprites/enemies/stage2_boss/enemy_stage2_attack.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 128,
    height: 128,
    frameWidth: 128,
    frameHeight: 128,
  },

  {
    key: 'game_title',
    path: 'maps/game_title.png',
    placeholder: false,
    kind: 'image',
    width: 3840,
    height: 2160,
  },
  {
    key: 'level_1_classroom',
    path: 'maps/level_1_classroom.png',
    placeholder: false,
    kind: 'image',
    width: 3840,
    height: 2160,
  },
  {
    key: 'level_2_laboratory',
    path: 'maps/level_2_laboratory.png',
    placeholder: false,
    kind: 'image',
    width: 3840,
    height: 2160,
  },
  {
    key: 'level_3_classroom',
    path: 'maps/level_3_classroom.png',
    placeholder: false,
    kind: 'image',
    width: 3840,
    height: 2160,
  },

  {
    key: 'boss_final_poison',
    path: 'sprites/enemies/final_boss/boss_final_poison.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 128,
    height: 128,
    frameWidth: 128,
    frameHeight: 128,
  },

  {
    key: 'boss_final_walk',
    path: 'sprites/enemies/final_boss/boss_final_walk.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 128,
    height: 128,
    frameWidth: 128,
    frameHeight: 128,
  },
  {
    key: 'boss_final_attack',
    path: 'sprites/enemies/final_boss/boss_final_attack.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 128,
    height: 128,
    frameWidth: 128,
    frameHeight: 128,
  },
  {
    key: 'boss_final_idle',
    path: 'sprites/enemies/final_boss/boss_final_idle.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 128,
    height: 128,
    frameWidth: 128,
    frameHeight: 128,
  },

  {
    key: 'weapon_venom',
    path: 'sprites/weapons/weapon_venom_reference.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'venom_projectile',
    path: 'sprites/weapons/venom_projectile.png',
    placeholder: false,
    kind: 'image',
    width: 32,
    height: 18,
  },
  {
    key: 'player_venom_run_equipped',
    path: 'sprites/player/player_venom_run_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_venom_shoot_equipped',
    path: 'sprites/player/player_venom_shoot_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_venom_hurt_equipped',
    path: 'sprites/player/player_venom_hurt_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'weapon_flare',
    path: 'sprites/weapons/weapon_flare_reference.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'flare_projectile',
    path: 'sprites/weapons/flare_projectile.png',
    placeholder: false,
    kind: 'image',
    width: 32,
    height: 18,
  },
  {
    key: 'player_flare_run_equipped',
    path: 'sprites/player/player_flare_run_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_flare_shoot_equipped',
    path: 'sprites/player/player_flare_shoot_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_flare_hurt_equipped',
    path: 'sprites/player/player_flare_hurt_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'weapon_rail',
    path: 'sprites/weapons/weapon_rail_reference.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'rail_projectile',
    path: 'sprites/weapons/rail_projectile.png',
    placeholder: false,
    kind: 'image',
    width: 32,
    height: 18,
  },
  {
    key: 'player_rail_run_equipped',
    path: 'sprites/player/player_rail_run_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_rail_shoot_equipped',
    path: 'sprites/player/player_rail_shoot_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_rail_hurt_equipped',
    path: 'sprites/player/player_rail_hurt_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'weapon_smg',
    path: 'sprites/weapons/weapon_smg_reference.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'smg_projectile',
    path: 'sprites/weapons/smg_projectile.png',
    placeholder: false,
    kind: 'image',
    width: 32,
    height: 18,
  },
  {
    key: 'player_smg_run_equipped',
    path: 'sprites/player/player_smg_run_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_smg_shoot_equipped',
    path: 'sprites/player/player_smg_shoot_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_smg_hurt_equipped',
    path: 'sprites/player/player_smg_hurt_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_pulse_run_equipped',
    path: 'sprites/player/player_pulse_run_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_pulse_shoot_equipped',
    path: 'sprites/player/player_pulse_shoot_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'player_pulse_hurt_equipped',
    path: 'sprites/player/player_pulse_hurt_equipped.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 80,
    frameWidth: 96,
    frameHeight: 80,
  },
  {
    key: 'weapon_pulse',
    path: 'sprites/weapons/weapon_pulse_reference.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'pulse_projectile',
    path: 'sprites/weapons/pulse_projectile.png',
    placeholder: false,
    kind: 'image',
    width: 32,
    height: 18,
  },
  {
    key: 'ui_cursor_arrow_game',
    path: 'ui/campus/ui_campus_cursor_arrow_game.png',
    placeholder: false,
    kind: 'image',
    width: 34,
    height: 44,
  },
  {
    key: 'ui_cursor_hand_game',
    path: 'ui/campus/ui_campus_cursor_hand_game.png',
    placeholder: false,
    kind: 'image',
    width: 36,
    height: 44,
  },
  {
    key: 'chest',
    path: 'sprites/weapons/chest.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'weapon_pistol',
    path: 'sprites/weapons/weapon_pistol.png',
    placeholder: false,
    kind: 'image',
    width: 64,
    height: 64,
  },
  {
    key: 'enemy_tank_walk',
    path: 'sprites/enemies/enemy_tank_walk.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 96,
    frameWidth: 96,
    frameHeight: 96,
  },
  {
    key: 'player_student_hurt',
    path: 'sprites/player/player_student_hurt.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 71,
    height: 71,
    frameWidth: 71,
    frameHeight: 71,
  },
  {
    key: 'ui_campus_bar_pink_empty',
    path: 'ui/campus/ui_campus_bar_pink_empty.png',
    placeholder: false,
    kind: 'image',
    width: 1006,
    height: 85,
  },
  {
    key: 'ui_campus_bar_pink_fill',
    path: 'ui/campus/ui_campus_bar_pink_fill.png',
    placeholder: false,
    kind: 'image',
    width: 1006,
    height: 85,
  },
  {
    key: 'ui_campus_bar_blue_empty',
    path: 'ui/campus/ui_campus_bar_blue_empty.png',
    placeholder: false,
    kind: 'image',
    width: 1008,
    height: 90,
  },
  {
    key: 'ui_campus_bar_blue_fill',
    path: 'ui/campus/ui_campus_bar_blue_fill.png',
    placeholder: false,
    kind: 'image',
    width: 1008,
    height: 90,
  },
  ...([
    {
      key: 'ui_campus_school',
      path: 'ui/campus/ui_campus_school.png',
      placeholder: false,
      kind: 'image',
      width: 316,
      height: 308,
    },
    {
      key: 'ui_campus_backpack',
      path: 'ui/campus/ui_campus_backpack.png',
      placeholder: false,
      kind: 'image',
      width: 281,
      height: 294,
    },
    {
      key: 'ui_campus_book',
      path: 'ui/campus/ui_campus_book.png',
      placeholder: false,
      kind: 'image',
      width: 303,
      height: 294,
    },
    {
      key: 'ui_campus_scroll_map',
      path: 'ui/campus/ui_campus_scroll_map.png',
      placeholder: false,
      kind: 'image',
      width: 309,
      height: 292,
    },
    {
      key: 'ui_campus_characters',
      path: 'ui/campus/ui_campus_characters.png',
      placeholder: false,
      kind: 'image',
      width: 295,
      height: 294,
    },
    {
      key: 'ui_campus_gear',
      path: 'ui/campus/ui_campus_gear.png',
      placeholder: false,
      kind: 'image',
      width: 281,
      height: 279,
    },
    {
      key: 'ui_campus_energy',
      path: 'ui/campus/ui_campus_energy.png',
      placeholder: false,
      kind: 'image',
      width: 143,
      height: 174,
    },
    {
      key: 'ui_campus_gem',
      path: 'ui/campus/ui_campus_gem.png',
      placeholder: false,
      kind: 'image',
      width: 133,
      height: 171,
    },
    {
      key: 'ui_campus_star_badge',
      path: 'ui/campus/ui_campus_star_badge.png',
      placeholder: false,
      kind: 'image',
      width: 159,
      height: 171,
    },
    {
      key: 'ui_campus_shield',
      path: 'ui/campus/ui_campus_shield.png',
      placeholder: false,
      kind: 'image',
      width: 151,
      height: 170,
    },
    {
      key: 'ui_campus_gift',
      path: 'ui/campus/ui_campus_gift.png',
      placeholder: false,
      kind: 'image',
      width: 171,
      height: 173,
    },
    {
      key: 'ui_campus_calendar',
      path: 'ui/campus/ui_campus_calendar.png',
      placeholder: false,
      kind: 'image',
      width: 180,
      height: 168,
    },
    {
      key: 'ui_campus_coin',
      path: 'ui/campus/ui_campus_coin.png',
      placeholder: false,
      kind: 'image',
      width: 158,
      height: 162,
    },
    {
      key: 'ui_campus_trophy',
      path: 'ui/campus/ui_campus_trophy.png',
      placeholder: false,
      kind: 'image',
      width: 193,
      height: 165,
    },
    {
      key: 'ui_campus_heart',
      path: 'ui/campus/ui_campus_heart.png',
      placeholder: false,
      kind: 'image',
      width: 157,
      height: 153,
    },
    {
      key: 'ui_campus_star',
      path: 'ui/campus/ui_campus_star.png',
      placeholder: false,
      kind: 'image',
      width: 192,
      height: 141,
    },
    {
      key: 'ui_campus_button_blue',
      path: 'ui/campus/ui_campus_button_blue.png',
      placeholder: false,
      kind: 'image',
      width: 420,
      height: 148,
    },
    {
      key: 'ui_campus_button_purple',
      path: 'ui/campus/ui_campus_button_purple.png',
      placeholder: false,
      kind: 'image',
      width: 157,
      height: 160,
    },
    {
      key: 'ui_campus_button_purple_alt',
      path: 'ui/campus/ui_campus_button_purple_alt.png',
      placeholder: false,
      kind: 'image',
      width: 415,
      height: 146,
    },
    {
      key: 'ui_campus_button_dark',
      path: 'ui/campus/ui_campus_button_dark.png',
      placeholder: false,
      kind: 'image',
      width: 424,
      height: 143,
    },
    {
      key: 'ui_campus_panel_small',
      path: 'ui/campus/ui_campus_panel_small.png',
      placeholder: false,
      kind: 'image',
      width: 418,
      height: 142,
    },
    {
      key: 'ui_campus_icon_shop',
      path: 'ui/campus/ui_campus_icon_shop.png',
      placeholder: false,
      kind: 'image',
      width: 225,
      height: 222,
    },
    {
      key: 'ui_campus_icon_map',
      path: 'ui/campus/ui_campus_icon_map.png',
      placeholder: false,
      kind: 'image',
      width: 220,
      height: 222,
    },
    {
      key: 'ui_campus_icon_book',
      path: 'ui/campus/ui_campus_icon_book.png',
      placeholder: false,
      kind: 'image',
      width: 223,
      height: 219,
    },
    {
      key: 'ui_campus_icon_lock',
      path: 'ui/campus/ui_campus_icon_lock.png',
      placeholder: false,
      kind: 'image',
      width: 222,
      height: 220,
    },
    {
      key: 'ui_campus_icon_group',
      path: 'ui/campus/ui_campus_icon_group.png',
      placeholder: false,
      kind: 'image',
      width: 225,
      height: 221,
    },
    {
      key: 'ui_campus_icon_crosshair',
      path: 'ui/campus/ui_campus_icon_crosshair.png',
      placeholder: false,
      kind: 'image',
      width: 224,
      height: 220,
    },
    {
      key: 'ui_campus_icon_sword',
      path: 'ui/campus/ui_campus_icon_sword.png',
      placeholder: false,
      kind: 'image',
      width: 225,
      height: 219,
    },
    {
      key: 'ui_campus_icon_shield',
      path: 'ui/campus/ui_campus_icon_shield.png',
      placeholder: false,
      kind: 'image',
      width: 221,
      height: 220,
    },
    {
      key: 'ui_campus_map_round',
      path: 'ui/campus/ui_campus_map_round.png',
      placeholder: false,
      kind: 'image',
      width: 411,
      height: 402,
    },
    {
      key: 'ui_campus_bar_blue',
      path: 'ui/campus/ui_campus_bar_blue.png',
      placeholder: false,
      kind: 'image',
      width: 1008,
      height: 90,
    },
    {
      key: 'ui_campus_cursor',
      path: 'ui/campus/ui_campus_cursor.png',
      placeholder: false,
      kind: 'image',
      width: 117,
      height: 119,
    },
    {
      key: 'ui_campus_hand',
      path: 'ui/campus/ui_campus_hand.png',
      placeholder: false,
      kind: 'image',
      width: 117,
      height: 120,
    },
    {
      key: 'ui_campus_move_cross',
      path: 'ui/campus/ui_campus_move_cross.png',
      placeholder: false,
      kind: 'image',
      width: 119,
      height: 119,
    },
    {
      key: 'ui_campus_bar_pink',
      path: 'ui/campus/ui_campus_bar_pink.png',
      placeholder: false,
      kind: 'image',
      width: 1006,
      height: 85,
    },
    {
      key: 'ui_campus_bar_segments',
      path: 'ui/campus/ui_campus_bar_segments.png',
      placeholder: false,
      kind: 'image',
      width: 251,
      height: 96,
    },
    {
      key: 'ui_campus_frame_corner_tl',
      path: 'ui/campus/ui_campus_frame_corner_tl.png',
      placeholder: false,
      kind: 'image',
      width: 91,
      height: 94,
    },
    {
      key: 'ui_campus_bar_purple',
      path: 'ui/campus/ui_campus_bar_purple.png',
      placeholder: false,
      kind: 'image',
      width: 1007,
      height: 85,
    },
    {
      key: 'ui_campus_panel_reward',
      path: 'ui/campus/ui_campus_panel_reward.png',
      placeholder: false,
      kind: 'image',
      width: 494,
      height: 302,
    },
    {
      key: 'ui_campus_panel_notice',
      path: 'ui/campus/ui_campus_panel_notice.png',
      placeholder: false,
      kind: 'image',
      width: 831,
      height: 327,
    },
    {
      key: 'ui_campus_panel_message',
      path: 'ui/campus/ui_campus_panel_message.png',
      placeholder: false,
      kind: 'image',
      width: 552,
      height: 186,
    },
    {
      key: 'ui_campus_bar_short',
      path: 'ui/campus/ui_campus_bar_short.png',
      placeholder: false,
      kind: 'image',
      width: 387,
      height: 120,
    },
    {
      key: 'ui_campus_corner_tl',
      path: 'ui/campus/ui_campus_corner_tl.png',
      placeholder: false,
      kind: 'image',
      width: 72,
      height: 73,
    },
    {
      key: 'ui_campus_corner_tr',
      path: 'ui/campus/ui_campus_corner_tr.png',
      placeholder: false,
      kind: 'image',
      width: 70,
      height: 71,
    },
    {
      key: 'ui_campus_skill_orb_purple',
      path: 'ui/campus/ui_campus_skill_orb_purple.png',
      placeholder: false,
      kind: 'image',
      width: 195,
      height: 184,
    },
    {
      key: 'ui_campus_skill_orb_blue',
      path: 'ui/campus/ui_campus_skill_orb_blue.png',
      placeholder: false,
      kind: 'image',
      width: 190,
      height: 183,
    },
    {
      key: 'ui_campus_skill_orb_white',
      path: 'ui/campus/ui_campus_skill_orb_white.png',
      placeholder: false,
      kind: 'image',
      width: 188,
      height: 183,
    },
    {
      key: 'ui_campus_skill_orb_speed',
      path: 'ui/campus/ui_campus_skill_orb_speed.png',
      placeholder: false,
      kind: 'image',
      width: 189,
      height: 183,
    },
    {
      key: 'ui_campus_cursor_diamond',
      path: 'ui/campus/ui_campus_cursor_diamond.png',
      placeholder: false,
      kind: 'image',
      width: 145,
      height: 142,
    },
    {
      key: 'ui_campus_cursor_arrow',
      path: 'ui/campus/ui_campus_cursor_arrow.png',
      placeholder: false,
      kind: 'image',
      width: 106,
      height: 137,
    },
    {
      key: 'ui_campus_cursor_hand',
      path: 'ui/campus/ui_campus_cursor_hand.png',
      placeholder: false,
      kind: 'image',
      width: 98,
      height: 121,
    },
    {
      key: 'ui_campus_button_purple_long',
      path: 'ui/campus/ui_campus_button_purple_long.png',
      placeholder: false,
      kind: 'image',
      width: 388,
      height: 120,
    },
    {
      key: 'ui_campus_corner_bl',
      path: 'ui/campus/ui_campus_corner_bl.png',
      placeholder: false,
      kind: 'image',
      width: 71,
      height: 72,
    },
    {
      key: 'ui_campus_corner_br',
      path: 'ui/campus/ui_campus_corner_br.png',
      placeholder: false,
      kind: 'image',
      width: 71,
      height: 72,
    },
  ] as const),
  ...([
    {
      key: 'player_student_sword',
      path: 'sprites/player/player_student_sword.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 76,
      height: 76,
      frameWidth: 76,
      frameHeight: 76,
    },
    {
      key: 'player_student_shoot',
      path: 'sprites/player/player_student_shoot.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 72,
      height: 72,
      frameWidth: 72,
      frameHeight: 72,
    },
    {
      key: 'player_student_idle_overview',
      path: 'sprites/player/player_student_idle_overview.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 192,
      height: 192,
      frameWidth: 192,
      frameHeight: 192,
    },
    {
      key: 'player_student_idle_nw',
      path: 'sprites/player/player_student_idle_nw.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_n',
      path: 'sprites/player/player_student_idle_n.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_ne',
      path: 'sprites/player/player_student_idle_ne.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_e',
      path: 'sprites/player/player_student_idle_e.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_w',
      path: 'sprites/player/player_student_idle_w.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_sw',
      path: 'sprites/player/player_student_idle_sw.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_s',
      path: 'sprites/player/player_student_idle_s.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_idle_se',
      path: 'sprites/player/player_student_idle_se.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
    {
      key: 'player_student_run_gun',
      path: 'sprites/player/player_student_run_gun_clean.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 71,
      height: 71,
      frameWidth: 71,
      frameHeight: 71,
    },
    {
      key: 'ui_campus_pixel_board',
      path: 'ui/d1/ui_campus_pixel_board.png',
      placeholder: false,
      kind: 'image',
      width: 2048,
      height: 2048,
    },
    {
      key: 'ui_campus_fantasy_board',
      path: 'ui/d1/ui_campus_fantasy_board.png',
      placeholder: false,
      kind: 'image',
      width: 2048,
      height: 2048,
    },
    {
      key: 'player_student_run',
      path: 'sprites/player/player_student_run.png',
      placeholder: false,
      kind: 'spritesheet',
      width: 64,
      height: 64,
      frameWidth: 64,
      frameHeight: 64,
    },
  ] as const),
  // ---- 敌人：皇冠史莱姆分裂怪三代。统一使用 64×64 四行四列动画图集，代际用 visualScale 区分 ----
  {
    key: 'enemy_slime_t1_idle',
    path: 'sprites/enemies/enemy_slime_idle.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 64,
    height: 64,
    frameWidth: 64,
    frameHeight: 64,
  },
  {
    key: 'enemy_slime_t2_idle',
    path: 'sprites/enemies/enemy_slime_idle.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 64,
    height: 64,
    frameWidth: 64,
    frameHeight: 64,
  },
  {
    key: 'enemy_slime_t3_idle',
    path: 'sprites/enemies/enemy_slime_idle.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 64,
    height: 64,
    frameWidth: 64,
    frameHeight: 64,
  },

  // ---- 敌人：巨型肉盾怪 ----
  {
    key: 'enemy_tank_idle',
    path: 'sprites/enemies/enemy_tank_idle.png',
    placeholder: false,
    kind: 'spritesheet',
    width: 96,
    height: 96,
    frameWidth: 96,
    frameHeight: 96,
  },

  // ---- 玩家与抛射物（占位期测试场要用，正式资源归 D1 / D4）----
  {
    key: 'player_idle',
    path: 'sprites/player/player_idle.png',
    placeholder: true,
    kind: 'image',
    width: 24,
    height: 24,
  },
  {
    key: 'bullet_default',
    path: 'sprites/projectiles/bullet_default.png',
    placeholder: true,
    kind: 'image',
    width: 8,
    height: 8,
  },

  // ---- 特效 ----
  {
    key: 'fx_spark',
    path: 'sprites/fx/fx_spark.png',
    placeholder: true,
    kind: 'image',
    width: 8,
    height: 8,
  },

  // ---- 音效。path 是不含扩展名的基名，codecs 按优先级排列 ----
  audio('sfx_enemy_splitter_hit', 'audio/sfx/enemies/sfx_enemy_splitter_hit'),
  audio('sfx_enemy_splitter_pop', 'audio/sfx/enemies/sfx_enemy_splitter_pop'),
  audio('sfx_enemy_tank_hit', 'audio/sfx/enemies/sfx_enemy_tank_hit'),
  audio('sfx_enemy_tank_grind', 'audio/sfx/enemies/sfx_enemy_tank_grind'),
  audio('sfx_enemy_tank_windup', 'audio/sfx/enemies/sfx_enemy_tank_windup'),
  audio('sfx_enemy_tank_slam', 'audio/sfx/enemies/sfx_enemy_tank_slam'),
  audio('sfx_enemy_tank_stagger', 'audio/sfx/enemies/sfx_enemy_tank_stagger'),
  audio('sfx_enemy_tank_death', 'audio/sfx/enemies/sfx_enemy_tank_death'),
  audio('sfx_kill_flourish', 'audio/sfx/ui/sfx_kill_flourish'),
]

function audio(key: string, path: string): AssetEntry {
  return { key, path, placeholder: true, kind: 'audio', codecs: ['ogg', 'mp3'] }
}

/**
 * 动画表 —— **占位期不加载也不注册**。
 *
 * 为什么要单独一张表：清单如果只有 `kind: 'image' | 'audio'`，美术交付序列帧时
 * 只改 `placeholder` 是**不生效**的 —— 还得改加载代码（帧尺寸）并新增 `anims.create`。
 * 那就等于「美术丢文件即生效」这句承诺只在单帧资源上成立。
 *
 * 有了这张表，美术交付图集时只需把 `kind` 改成 `'spritesheet'`、填 `frameWidth/frameHeight`，
 * 再加一条动画条目，**加载与注册代码一行不改**。
 */
export interface AnimDef {
  animKey: string
  /** 指向 `ASSETS` 里的 key，且那条必须是 `kind: 'spritesheet'` */
  textureKey: string
  /** 帧序号（`spritesheet` 的第几格） */
  frames: readonly number[]
  /** 每秒播放帧数 */
  frameRate: number
  /** -1 = 无限循环 */
  repeat: number
  yoyo?: boolean
}

export const ANIMS: readonly AnimDef[] = [
  {
    animKey: 'enemy_stage2_idle_anim',
    textureKey: 'enemy_stage2_idle',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'enemy_stage2_attack_anim',
    textureKey: 'enemy_stage2_attack',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: 0,
  },

  {
    animKey: 'boss_final_poison_loop',
    textureKey: 'boss_final_poison',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: 0,
  },
  {
    animKey: 'boss_final_walk_loop',
    textureKey: 'boss_final_walk',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'boss_final_attack_loop',
    textureKey: 'boss_final_attack',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'boss_final_idle_loop',
    textureKey: 'boss_final_idle',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },

  {
    animKey: 'player_venom_run_equipped_anim',
    textureKey: 'player_venom_run_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_venom_shoot_equipped_anim',
    textureKey: 'player_venom_shoot_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_venom_hurt_equipped_anim',
    textureKey: 'player_venom_hurt_equipped',
    frames: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 30,
    repeat: 0,
  },
  {
    animKey: 'player_flare_run_equipped_anim',
    textureKey: 'player_flare_run_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_flare_shoot_equipped_anim',
    textureKey: 'player_flare_shoot_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_flare_hurt_equipped_anim',
    textureKey: 'player_flare_hurt_equipped',
    frames: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 30,
    repeat: 0,
  },
  {
    animKey: 'player_rail_run_equipped_anim',
    textureKey: 'player_rail_run_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_rail_shoot_equipped_anim',
    textureKey: 'player_rail_shoot_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_rail_hurt_equipped_anim',
    textureKey: 'player_rail_hurt_equipped',
    frames: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 30,
    repeat: 0,
  },
  {
    animKey: 'player_smg_run_equipped_anim',
    textureKey: 'player_smg_run_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_smg_shoot_equipped_anim',
    textureKey: 'player_smg_shoot_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_smg_hurt_equipped_anim',
    textureKey: 'player_smg_hurt_equipped',
    frames: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 30,
    repeat: 0,
  },
  {
    animKey: 'player_pulse_run_equipped_anim',
    textureKey: 'player_pulse_run_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_pulse_shoot_equipped_anim',
    textureKey: 'player_pulse_shoot_equipped',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_pulse_hurt_equipped_anim',
    textureKey: 'player_pulse_hurt_equipped',
    frames: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 30,
    repeat: 0,
  },
  {
    animKey: 'enemy_tank_walk_loop',
    textureKey: 'enemy_tank_walk',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_hurt_once',
    textureKey: 'player_student_hurt',
    frames: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 30,
    repeat: 0,
  },
  {
    animKey: 'enemy_slime_t1_idle_loop',
    textureKey: 'enemy_slime_t1_idle',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'enemy_slime_t2_idle_loop',
    textureKey: 'enemy_slime_t2_idle',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'enemy_slime_t3_idle_loop',
    textureKey: 'enemy_slime_t3_idle',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'enemy_tank_idle_loop',
    textureKey: 'enemy_tank_idle',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_sword_export',
    textureKey: 'player_student_sword',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_shoot_export',
    textureKey: 'player_student_shoot',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_overview_export',
    textureKey: 'player_student_idle_overview',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_nw_export',
    textureKey: 'player_student_idle_nw',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_n_export',
    textureKey: 'player_student_idle_n',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_ne_export',
    textureKey: 'player_student_idle_ne',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_e_export',
    textureKey: 'player_student_idle_e',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_w_export',
    textureKey: 'player_student_idle_w',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_sw_export',
    textureKey: 'player_student_idle_sw',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_s_export',
    textureKey: 'player_student_idle_s',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_idle_se_export',
    textureKey: 'player_student_idle_se',
    frames: [0],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_run_gun_export',
    textureKey: 'player_student_run_gun',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    frameRate: 8,
    repeat: -1,
  },
  {
    animKey: 'player_student_run_export',
    textureKey: 'player_student_run',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    frameRate: 8,
    repeat: -1,
  },
]

export const PLACEHOLDER_SUFFIX = '__placeholder'
/** 真资源加载失败时的统一兜底，一眼能看出「这里缺东西」 */
export const PLACEHOLDER_MISSING_KEY = '__placeholder_missing'

const byKey = new Map<string, AssetEntry>(ASSETS.map((a) => [a.key, a]))

/** 某个 key 在清单里的定义。 */
export function findAsset(key: string): AssetEntry | undefined {
  return byKey.get(key)
}

/** 清单里所有合法的 key。契约测试拿它校验配置表。 */
export function assetKeys(): readonly string[] {
  return ASSETS.map((a) => a.key)
}

/**
 * 把一个**逻辑 key** 解析成当前**实际该用的 texture key**。
 *
 * 游戏代码永远调它，永远不直接写 texture key。
 * 占位期返回 `${key}__placeholder`；真资源到位（`placeholder: false`）后返回 `key` 本身。
 */
export function resolveTextureKey(key: string): string {
  const entry = byKey.get(key)
  if (!entry) return PLACEHOLDER_MISSING_KEY
  if (entry.kind === 'audio') return key
  return entry.placeholder ? key + PLACEHOLDER_SUFFIX : key
}

/** 音效文件的实际 URL（按 codecs 顺序给候选，浏览器挑第一个能播的）。 */
export function audioUrls(entry: AssetEntry): string[] {
  const codecs = entry.codecs ?? ['ogg', 'mp3']
  return codecs.map((c) => `assets/${entry.path}.${c}`)
}

/** 图片文件的实际 URL。 */
export function imageUrl(entry: AssetEntry): string {
  return `assets/${entry.path}`
}
