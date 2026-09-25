/**
 * The media slider's key: what one position of a media card's slider means.
 *
 * The key is `step` (the default) or a scalar metric such as `epoch`. A
 * metric key is looked up per run AS OF each step that carries media (the
 * key's last logged value at or before that step), so one slider value
 * picks, in every run, the media logged while the key held that value, even
 * when the runs reach it at different steps.
 *
 * The slider persists a key VALUE (not an index): it survives new steps
 * arriving and means the same thing in every pane and every card of a
 * section.
 *
 * Pure: tested in `slider-key.test.ts`.
 */

export const STEP_KEY = "step";

/** One logged point of the key metric. */
export interface KeyPoint {
  step: number;
  scalar_value: number | null;
}

/** One slider position of a run: the key value and the media step it resolves to. */
export interface SliderPosition {
  value: number;
  step: number;
}

/**
 * One run's slider track over the `steps` its media was logged at.
 *
 * - `step` key: every step is its own position.
 * - Metric key: each step takes the key's value as of that step; steps before
 *   the key's first (non-null) point have no value and are dropped. Steps
 *   sharing a value collapse into one position that resolves to the LAST of
 *   them (the newest media while the key held that value). Non-monotonic keys
 *   are fine: positions are ordered by value, and a value the key returns to
 *   later resolves to its latest step.
 *
 * `keyPoints` absent (not loaded) gives an empty track for a metric key.
 * The result is sorted ascending by value, values unique.
 */
export function sliderTrack(
  steps: readonly number[],
  key: string,
  keyPoints?: readonly KeyPoint[] | null,
): SliderPosition[] {
  const sorted = [...new Set(steps)].sort((a, b) => a - b);
  if (key === STEP_KEY) return sorted.map((s) => ({ value: s, step: s }));
  if (!keyPoints) return [];
  const at = asOf(keyPoints);
  const byValue = new Map<number, number>();
  for (const s of sorted) {
    const v = at(s);
    if (v == null) continue;
    byValue.set(v, s); // ascending steps: the last write is the latest step
  }
  return [...byValue.entries()]
    .map(([value, step]) => ({ value, step }))
    .sort((a, b) => a.value - b.value);
}

/** As-of lookup: the last non-null, finite value at or before a step. */
function asOf(points: readonly KeyPoint[]): (step: number) => number | null {
  const pts = points
    .filter((p) => p.scalar_value != null && Number.isFinite(p.scalar_value))
    .sort((a, b) => a.step - b.step);
  return (step) => {
    let lo = 0;
    let hi = pts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]!.step <= step) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? null : pts[found]!.scalar_value!;
  };
}

/**
 * The step a run shows at slider value `value`: the position with the
 * largest value ≤ `value`. Below the track's first value: `null`, or its first
 * position with `nearest` (keeps a pane on screen for a run that reaches the
 * key later than its neighbours).
 */
export function resolveAtValue(
  track: readonly SliderPosition[],
  value: number,
  options?: { nearest?: boolean },
): number | null {
  const i = indexAsOf(track.map((p) => p.value), value);
  if (i >= 0) return track[i]!.step;
  return options?.nearest && track.length > 0 ? track[0]!.step : null;
}

/** The union of every track's values, ascending and unique. */
export function unionValues(tracks: ReadonlyArray<readonly SliderPosition[] | readonly number[]>): number[] {
  const set = new Set<number>();
  for (const t of tracks) for (const p of t) set.add(typeof p === "number" ? p : p.value);
  return [...set].sort((a, b) => a - b);
}

/** Largest index `i` with `values[i] <= value` in an ascending list; -1 when none. */
export function indexAsOf(values: readonly number[], value: number): number {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! <= value) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The slider index a persisted value lands on: the value itself, else the
 * largest value below it; below every value (or nothing persisted) the
 * first position.
 */
export function sliderIndex(values: readonly number[], value: number | null | undefined): number {
  if (value == null || values.length === 0) return 0;
  return Math.max(0, indexAsOf(values, value));
}

/** A key value for labels: integers as is, other numbers to 4 significant digits. */
export function formatKeyValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(4)));
}
