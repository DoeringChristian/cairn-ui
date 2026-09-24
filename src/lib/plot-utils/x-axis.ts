import type { SeriesPoint } from "./types.ts";

/** `metric`: another scalar series of the same run is the x-axis (see `xMetric`). */
export type AxisSource = "step" | "relative_time" | "wall_time" | "metric";

// A type alias, not an interface, so it fits the card-spec's JSON settings.
/** The scalar series a `metric` x-axis reads, as card settings name it. */
export type XMetricRef = {
  name: string;
};

/**
 * The x-metric's value in effect at each step: an as-of join, so a point at
 * step s takes the x-metric's value at the largest step <= s (an `epoch`
 * logged once per epoch applies to every step until the next one). Steps
 * before the x-metric's first point have no value.
 */
export function asOfLookup(
  xPoints: ReadonlyArray<{ step: number; scalar_value: number | null }>,
): (step: number) => number | null {
  const steps: number[] = [];
  const values: number[] = [];
  for (const p of [...xPoints].sort((a, b) => a.step - b.step)) {
    if (p.scalar_value == null) continue;
    steps.push(p.step);
    values.push(p.scalar_value);
  }
  return (step) => {
    let lo = 0;
    let hi = steps.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid]! <= step) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? null : values[found]!;
  };
}

/**
 * Map raw sequence points to (x, y) pairs based on the chosen x-axis source.
 *
 * Each raw point must have at least { step, scalar_value, wall_time }.
 * `runCreatedAt` is the epoch-ms creation time of the run — required for
 * relative_time mode where x = (wall_time - runCreatedAt) in seconds.
 * `xMetric` is the run's x-metric series — required for metric mode, where
 * x is its as-of value at the point's step (see `asOfLookup`).
 */
export function mapToXAxis(
  raw: ReadonlyArray<{
    step: number;
    scalar_value: number | null;
    wall_time: string;
  }>,
  source: AxisSource,
  runCreatedAt?: number | null,
  xMetric?: ReadonlyArray<{ step: number; scalar_value: number | null }> | null,
): SeriesPoint[] {
  const mapped: SeriesPoint[] = [];
  if (source === "metric" && !xMetric) return mapped;
  const xAt = source === "metric" ? asOfLookup(xMetric!) : null;
  for (const p of raw) {
    if (p.scalar_value == null) continue;
    let x: number;
    if (source === "step") {
      x = p.step;
    } else if (xAt) {
      const v = xAt(p.step);
      if (v == null) continue;
      x = v;
    } else if (source === "wall_time") {
      const t = new Date(p.wall_time).getTime();
      if (!Number.isFinite(t)) continue;
      x = t;
    } else {
      const anchor = runCreatedAt ?? null;
      if (anchor == null) continue;
      const t = new Date(p.wall_time).getTime();
      if (!Number.isFinite(t)) continue;
      x = (t - anchor) / 1000;
    }
    mapped.push({
      x,
      y: p.scalar_value,
      wallTime: p.wall_time,
    });
  }
  mapped.sort((a, b) => a.x - b.x);
  return mapped;
}
