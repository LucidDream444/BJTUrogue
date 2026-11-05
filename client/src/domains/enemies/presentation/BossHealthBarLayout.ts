interface HudCamera {
  width: number
  height: number
  zoom: number
  originX: number
  originY: number
}

/** Keep the boss HUD clear of player meters and the new-monster prompt. */
export function bossHealthBarLayout(camera: HudCamera): {
  x: number
  y: number
  scale: number
  width: number
} {
  const { width, height, zoom, originX, originY } = camera
  const wide = width >= 1120
  const barWidth = Math.min(440, wide ? width - 800 : width - 32)
  const screenX = wide
    ? Math.min(Math.max((width - barWidth) / 2, 470), width - 330 - barWidth)
    : (width - barWidth) / 2
  const uiScale = Math.min(1, Math.max(0.3, (width - 36) / 450))
  const screenY = wide ? 16 : 36 + 160 * uiScale
  return {
    x: width * originX * (1 - 1 / zoom) + screenX / zoom,
    y: height * originY * (1 - 1 / zoom) + screenY / zoom,
    scale: 1 / zoom,
    width: barWidth,
  }
}
