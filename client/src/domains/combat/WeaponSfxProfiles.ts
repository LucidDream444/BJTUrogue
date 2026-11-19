import type { WeaponId } from './config'

/**
 * 每把武器一条程序合成配方。**零 Phaser 依赖**，node 下可直测。
 *
 * 音色走 8-bit 路线：方波/锯齿为主、极短包络、`bitDepth` 量化成阶梯波形；
 * 重武器加低频正弦与噪声，切割类加高通噪声，能量类加带通/颤音。
 * 实际合成在 `WeaponSynth`（Web Audio），本文件只负责“这把武器该是什么声音”。
 */
export type SfxWave = 'square' | 'sawtooth' | 'triangle' | 'sine' | 'noise'

export interface SfxProfile {
  wave: SfxWave
  freq: number
  freqEnd: number
  /** 秒 */
  duration: number
  /** 0—1，相对音量（再乘玩家设置里的音效音量） */
  volume: number
  /** 0—1 噪声混入量 */
  noise?: number
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; q?: number }
  /** 量化台阶数，越小越“bit”；8—16 最像芯片音 */
  bitDepth?: number
  /** 起音秒数 */
  attack?: number
  /** 连击脉冲数与间隔（剪刀/双击/电击） */
  pulses?: number
  pulseGap?: number
  /** 颤音（回旋/声波/光剑） */
  vibrato?: { rate: number; depth: number }
}

const p = (
  wave: SfxWave,
  freq: number,
  freqEnd: number,
  duration: number,
  volume: number,
  extra: Partial<SfxProfile> = {},
): SfxProfile => ({ wave, freq, freqEnd, duration, volume, ...extra })

export const WEAPON_SFX: Record<WeaponId, SfxProfile> = {
  // ---- 旧六把 ----
  pencil: p('square', 900, 500, 0.045, 0.26, { bitDepth: 10 }),
  pulse: p('sawtooth', 160, 50, 0.24, 0.42, {
    noise: 0.25,
    filter: { type: 'lowpass', frequency: 800 },
    bitDepth: 14,
  }),
  venom: p('square', 300, 120, 0.15, 0.3, {
    noise: 0.4,
    filter: { type: 'lowpass', frequency: 900 },
    bitDepth: 10,
  }),
  flare: p('noise', 120, 40, 0.24, 0.5, {
    noise: 1,
    filter: { type: 'lowpass', frequency: 600 },
    bitDepth: 12,
  }),
  rail: p('square', 1800, 300, 0.14, 0.4, {
    noise: 0.1,
    filter: { type: 'highpass', frequency: 600 },
    bitDepth: 6,
  }),
  smg: p('square', 1200, 800, 0.032, 0.2, { bitDepth: 6 }),

  // ---- 近战 10 ----
  pencil_knife: p('square', 1700, 700, 0.055, 0.28, {
    noise: 0.2,
    filter: { type: 'highpass', frequency: 1000 },
    bitDepth: 6,
  }),
  ruler_sword: p('sawtooth', 700, 250, 0.09, 0.32, {
    noise: 0.25,
    filter: { type: 'bandpass', frequency: 1100, q: 1.2 },
    bitDepth: 8,
  }),
  pointer_rapier: p('square', 1500, 600, 0.075, 0.32, {
    noise: 0.1,
    filter: { type: 'highpass', frequency: 900 },
    bitDepth: 6,
  }),
  compass: p('triangle', 1300, 400, 0.09, 0.35, {
    noise: 0.15,
    filter: { type: 'bandpass', frequency: 1500 },
    bitDepth: 8,
  }),
  eraser_maul: p('sine', 130, 45, 0.26, 0.55, {
    noise: 0.55,
    filter: { type: 'lowpass', frequency: 380 },
    bitDepth: 10,
  }),
  broom: p('noise', 200, 80, 0.14, 0.3, {
    noise: 1,
    filter: { type: 'lowpass', frequency: 1500 },
    bitDepth: 8,
  }),
  scissors: p('square', 1900, 1200, 0.13, 0.32, {
    pulses: 2,
    pulseGap: 0.05,
    bitDepth: 5,
  }),
  glowstick: p('square', 900, 1500, 0.12, 0.3, {
    vibrato: { rate: 18, depth: 80 },
    bitDepth: 6,
  }),
  mop: p('noise', 250, 100, 0.12, 0.28, {
    noise: 1,
    filter: { type: 'lowpass', frequency: 700 },
    bitDepth: 8,
  }),
  bug_swatter: p('sawtooth', 1800, 200, 0.12, 0.4, {
    noise: 0.5,
    filter: { type: 'highpass', frequency: 600 },
    pulses: 3,
    pulseGap: 0.03,
    bitDepth: 4,
  }),

  // ---- 新远程 20 ----
  eraser_shotgun: p('noise', 100, 40, 0.18, 0.5, {
    noise: 1,
    filter: { type: 'lowpass', frequency: 900 },
    bitDepth: 8,
  }),
  set_square_sniper: p('square', 2200, 200, 0.16, 0.5, {
    noise: 0.15,
    filter: { type: 'highpass', frequency: 500 },
    bitDepth: 6,
  }),
  auto_pencil_smg: p('square', 1500, 1000, 0.03, 0.2, { bitDepth: 5 }),
  chem_sprayer: p('noise', 300, 100, 0.2, 0.3, {
    noise: 1,
    filter: { type: 'bandpass', frequency: 700, q: 0.8 },
    bitDepth: 8,
  }),
  cryo_sprayer: p('noise', 800, 200, 0.22, 0.3, {
    noise: 1,
    filter: { type: 'highpass', frequency: 1200 },
    bitDepth: 8,
  }),
  laser_pointer: p('sawtooth', 1200, 180, 0.2, 0.45, {
    vibrato: { rate: 30, depth: 40 },
    filter: { type: 'bandpass', frequency: 1200, q: 2 },
    bitDepth: 6,
  }),
  basketball_boomerang: p('triangle', 280, 620, 0.24, 0.35, {
    vibrato: { rate: 7, depth: 30 },
    bitDepth: 8,
  }),
  paper_plane: p('noise', 500, 200, 0.12, 0.25, {
    noise: 1,
    filter: { type: 'bandpass', frequency: 1000 },
    bitDepth: 8,
  }),
  tennis_ball: p('square', 650, 280, 0.055, 0.3, { bitDepth: 6 }),
  model_rocket: p('noise', 140, 40, 0.32, 0.5, {
    noise: 1,
    filter: { type: 'lowpass', frequency: 700 },
    bitDepth: 10,
  }),
  grenade_launcher: p('sine', 190, 50, 0.18, 0.45, {
    noise: 0.3,
    filter: { type: 'lowpass', frequency: 500 },
    bitDepth: 10,
  }),
  arc_emitter: p('square', 2000, 300, 0.13, 0.42, {
    noise: 0.55,
    filter: { type: 'highpass', frequency: 700 },
    bitDepth: 4,
  }),
  split_dart: p('square', 1500, 900, 0.05, 0.28, { bitDepth: 6 }),
  lifesteal_syringe: p('sine', 700, 1600, 0.09, 0.28, { bitDepth: 6 }),
  nail_gun: p('square', 1700, 1100, 0.028, 0.2, { bitDepth: 4 }),
  bubble_gun: p('sine', 280, 720, 0.11, 0.28, { bitDepth: 8 }),
  double_barrel: p('noise', 120, 50, 0.2, 0.5, {
    noise: 1,
    filter: { type: 'lowpass', frequency: 800 },
    pulses: 2,
    pulseGap: 0.08,
    bitDepth: 8,
  }),
  magnetic_frisbee: p('triangle', 700, 1500, 0.15, 0.32, {
    filter: { type: 'bandpass', frequency: 1800, q: 3 },
    bitDepth: 6,
  }),
  sonic_horn: p('sawtooth', 220, 150, 0.26, 0.42, {
    filter: { type: 'lowpass', frequency: 700 },
    vibrato: { rate: 5, depth: 20 },
    bitDepth: 8,
  }),
  firework_launcher: p('sawtooth', 400, 1600, 0.3, 0.4, {
    noise: 0.35,
    filter: { type: 'highpass', frequency: 500 },
    bitDepth: 8,
  }),
}

/** 运行时兜底：未知 id 用起始手枪的声音，绝不静默成“没声音”。 */
export function sfxProfileFor(id: WeaponId): SfxProfile {
  return WEAPON_SFX[id] ?? WEAPON_SFX.pencil
}
