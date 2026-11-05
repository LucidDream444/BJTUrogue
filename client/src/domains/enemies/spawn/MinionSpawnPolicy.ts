/** Boss-room slots include live minions, queued spawns, and reserved split children. */
export function acceptedMinionSpawns(
  requested: number,
  population: number,
  cap: number | null,
): number {
  return cap === null ? requested : Math.min(requested, Math.max(0, cap - population))
}
