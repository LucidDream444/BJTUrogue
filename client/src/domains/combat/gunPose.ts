/** Frame coordinates use the same foot anchor, scale and horizontal reflection as the sprite. */
export function gunMuzzlePosition(
  position: { x: number; y: number },
  size: { frameWidth: number; frameHeight: number },
  anchor: readonly number[],
  point: readonly [number, number],
  scale: number,
  flip: boolean,
): { x: number; y: number } {
  const dx = (point[0] - size.frameWidth * anchor[0]!) * scale
  return {
    x: position.x + (flip ? -dx : dx),
    y: position.y + (point[1] - size.frameHeight * anchor[1]!) * scale,
  }
}
