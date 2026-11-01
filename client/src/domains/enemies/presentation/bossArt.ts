import { BOSS_FIRST_ART, FINAL_BOSS_ART, STAGE2_BOSS_ART } from '@/core/assetManifest'

/** Keep MVP boss identities separate from the ordinary textbook's art. */
export function bossArt(stage: number, finalBoss: boolean): { key: string; tint: number } {
  if (finalBoss) return { key: FINAL_BOSS_ART.idle, tint: 0xffffff }
  if (stage === 2) return { key: STAGE2_BOSS_ART.idle, tint: 0xffffff }
  return { key: BOSS_FIRST_ART.texture, tint: 0xffffff }
}
