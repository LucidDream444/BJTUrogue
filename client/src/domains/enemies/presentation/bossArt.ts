import { BOSS_FIRST_ART, FINAL_BOSS_ART, STAGE2_BOSS_ART, SPRAYER_ART, MUSCOVY_ART, GRABBER_ART, NAILONG_ART } from '@/core/assetManifest'

/** Keep MVP boss identities separate from the ordinary textbook's art. */
export function bossArt(stage: number, finalBoss: boolean): { key: string; tint: number } {
  if (finalBoss) return { key: FINAL_BOSS_ART.idle, tint: 0xffffff }
  if (stage === 3) return { key: STAGE2_BOSS_ART.idle, tint: 0xffffff }
  if (stage === 4) return { key: SPRAYER_ART.texture, tint: 0xffffff }
  if (stage === 5) return { key: MUSCOVY_ART.texture, tint: 0xffffff }
  if (stage === 6) return { key: GRABBER_ART.texture, tint: 0xffffff }
  if (stage === 7) return { key: NAILONG_ART.texture, tint: 0xffffff }
  return { key: BOSS_FIRST_ART.texture, tint: 0xffffff }
}

export function bossDisplayName(stage: number, paperName = '考卷纸鸢'): string {
  return ({ 2: '课业重压', 3: paperName, 4: '酸蚀喷灌设备', 5: '失控体育器材',
    6: '分身点名册', 7: '奶龙', 8: '心魔' } as Record<number, string>)[stage] ?? '课业重压'
}
