/** Which way is better on one axis. */
export type Better = "min" | "max";

/** The optimisation goal per axis, set independently. */
export interface ParetoDirection {
  x: Better;
  y: Better;
}

/**
 * The Pareto-optimal points of a 2D set: those no other point beats (or ties)
 * on both axes, for the given per-axis `direction`.
 */
export function computeParetoFront<T extends { x: number; y: number }>(
  points: T[],
  direction: ParetoDirection,
): T[] {
  if (points.length === 0) return [];
  const minX = direction.x === "min";
  const minY = direction.y === "min";

  // Best x first; among equal x, best y first.
  const sorted = [...points].sort((a, b) => {
    const cmp = minX ? a.x - b.x : b.x - a.x;
    return cmp !== 0 ? cmp : (minY ? a.y - b.y : b.y - a.y);
  });

  const front: T[] = [];
  let bestY = minY ? Infinity : -Infinity;
  for (const pt of sorted) {
    if (minY ? pt.y < bestY : pt.y > bestY) {
      front.push(pt);
      bestY = pt.y;
    }
  }
  return front;
}

/**
 * Plotly line shape for the staircase through the front sorted by ascending x:
 * it bounds the dominated region, which lies on the worse side of x. With
 * "lower x is better" that region is to the right, so each step runs across
 * first ("hv"); with "higher x is better" it is to the left ("vh").
 */
export function paretoLineShape(direction: ParetoDirection): "hv" | "vh" {
  return direction.x === "min" ? "hv" : "vh";
}
