import { FINAL_BOSS_ART, STAGE2_BOSS_ART } from '@/core/assetManifest'

/** Keep MVP boss identities separate from the ordinary textbook's art. */
export function bossArt(stage: number, finalBoss: boolean): { key: string; tint: number } {
  if (finalBoss) return { key: FINAL_BOSS_ART.idle, tint: 0xa855f7 }
  if (stage === 2) return { key: STAGE2_BOSS_ART.idle, tint: 0x4da6ff }
  // Reuse an otherwise retired boss slot so the first boss has its own placeholder key.
  return { key: FINAL_BOSS_ART.poison, tint: 0xffffff }
}
