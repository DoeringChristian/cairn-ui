// Constraint kept free of an index signature so plain interfaces (e.g.
// SequencePoint) satisfy it — TS does not give interfaces implicit string
// index signatures, so `{ step: number; [k: string]: unknown }` would reject them.
export interface SteppedPoint {
  step: number;
}

export interface ResolveAtStepOptions {
  /**
   * Fall back to the smallest point *above* `step` when the run has nothing at
   * or below it. Opt-in: it is what keeps a comparison pane on screen for a run
   * whose first artifact lands later than its neighbours', but cards that treat
   * "nothing logged yet at this step" as a real, displayable state
   * (VideoPlayerCard, FigureInteractiveCard) must keep seeing `null`.
   */
  nearest?: boolean;
}

/**
 * Largest point with `point.step <= step`; `null` when none qualifies.
 *
 * With `{ nearest: true }` a run that only starts logging above `step` resolves
 * to its first point instead, so `null` then means only "this run has no points
 * at all".
 *
 * Assumes `points` are sorted ascending by step (as returned by the sequence
 * API). The scan short-circuits once it passes `step`, so callers relying on
 * that ordering keep their previous behavior.
 */
export function resolveAtStep<T extends SteppedPoint>(
  points: T[],
  step: number,
  options?: ResolveAtStepOptions,
): T | null {
  let best: T | null = null;
  for (const p of points) {
    if (p.step <= step) {
      best = p;
      continue;
    }
    // First point above `step`; with ascending input it is the smallest one.
    if (best === null && options?.nearest) return p;
    break;
  }
  return best;
}

/** The sorted union of every series' steps (the step key's slider positions). */
export function stepUnion(seriesPoints: ReadonlyArray<ReadonlyArray<SteppedPoint>>): number[] {
  const set = new Set<number>();
  for (const pts of seriesPoints) for (const p of pts) set.add(p.step);
  return [...set].sort((a, b) => a - b);
}

/**
 * The point each series shows at its own step: `steps[i]` for series `i`
 * (a slider key resolves to a different step per run), `null` for none.
 */
export function resolveEach<T extends SteppedPoint>(
  seriesPoints: ReadonlyArray<T[]>,
  steps: ReadonlyArray<number | null>,
  options?: ResolveAtStepOptions,
): Array<T | null> {
  return seriesPoints.map((pts, i) => {
    const step = steps[i];
    return step == null ? null : resolveAtStep(pts, step, options);
  });
}
