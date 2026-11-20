import { BOSS_ROSTER_ART, NAILONG_ART, type BossRosterArt } from '@/core/assetManifest'

export interface BossArt {
  key: string
  tint: number
  /** Final display scale for the 256px roster cell (or Nailong's reference art). */
  scale: number
  idleFrames?: number
  idleFrameRate?: number
  skillKey?: string
  skillFrames?: number
  skillFrameRate?: number
  audio?: string
  audioGain?: number
}

function roster(_stage: number, art: BossRosterArt): BossArt {
  return {
    key: art.idle,
    tint: 0xffffff,
    scale: art.displayScale,
    idleFrames: art.idleFrames,
    idleFrameRate: art.idleFrameRate,
    skillKey: art.skill,
    skillFrames: art.skillFrames,
    skillFrameRate: art.skillFrameRate,
    audio: art.audio,
    audioGain: art.audioGain,
  }
}

/** Profile 2—8 are the seven regular bosses; profile 9 is the final Nailong. */
export function bossArt(stage: number): BossArt {
  const art = BOSS_ROSTER_ART[stage]
  if (art) return roster(stage, art)
  if (stage === 9) return { key: NAILONG_ART.texture, tint: 0xffffff, scale: 2.0 }
  return { key: 'boss_bull_idle', tint: 0xffffff, scale: 1 }
}

export function bossDisplayName(stage: number, paperName = '考卷纸鸢'): string {
  return (
    {
      2: '课业重压',
      3: paperName,
      4: '酸蚀喷灌设备',
      5: '失控体育器材',
      6: '分身点名册',
      7: '香蕉猫',
      8: '肥嘟嘟',
      9: '奶龙',
    } as Record<number, string>
  )[stage] ?? '课业重压'
}
