/** Display and player-hit dimensions stay independent of navigation and solid collision. */
export interface BossPresentationConfig {
  bossVisualScaleMultiplier: number
  bossHitRadiusMultiplier: number
}

export function bossFootprint(radius: number, visualScale: number, config: BossPresentationConfig) {
  return {
    visualScale: visualScale * config.bossVisualScaleMultiplier,
    // Arcade multiplies a local circle by the sprite scale. Compensate for display enlargement.
    bodyTextureRadius: radius / config.bossVisualScaleMultiplier,
    hitRadius: radius * visualScale * config.bossHitRadiusMultiplier,
  }
}
