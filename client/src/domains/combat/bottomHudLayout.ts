/** Screen-space layout shared by the weapon and skill HUD; no Phaser dependencies. */
export const BOTTOM_HUD = {
  margin: 18,
  gap: 12,
  slotWidth: 192,
  slotGap: 10,
  height: 84,
  skillWidth: 354,
} as const
export interface HudBox {
  x: number
  y: number
  width: number
  height: number
  scale: number
}
export function bottomHudLayout(
  width: number,
  height: number,
): { loadout: HudBox; skill: HudBox; stacked: boolean } {
  const { margin, gap, slotWidth, slotGap, height: h, skillWidth } = BOTTOM_HUD
  const group = slotWidth * 2 + slotGap
  const usable = Math.max(1, width - margin * 2)
  const stacked = usable < group + gap + skillWidth
  // Keep clearance below the top status/room HUD in short landscape windows.
  const heightScale = stacked ? Math.max(0.5, (height - 200) / (h * 2 + gap)) : 1
  const scale = Math.min(1, usable / group, heightScale)
  const baseY = height - margin - h * scale
  const loadout = { x: margin, y: baseY, width: group * scale, height: h * scale, scale }
  const skill = {
    x: stacked ? margin : Math.max(margin + group + gap, (width - skillWidth) / 2),
    y: stacked ? baseY - gap - h * scale : baseY,
    width: skillWidth * scale,
    height: h * scale,
    scale,
  }
  return { loadout, skill, stacked }
}
