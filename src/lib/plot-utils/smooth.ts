import type { SeriesPoint } from "./types.ts";

/**
 * Smoothing kinds for scalar series. One `smoothing` number drives all of
 * them; what it means depends on the kind:
 * - `ema`: the weight on the previous smoothed value, in [0, 1).
 * - `twema`: the same weight, per *average* x-step — gaps in x decay the
 *   memory more, and the start is debiased (no pull toward the first point).
 * - `gaussian`: the kernel's standard deviation, in points.
 * - `window`: a trailing running average over this many points.
 * `0` is off for every kind.
 */
export type SmoothingKind = "ema" | "twema" | "gaussian" | "window";

export interface SmoothingKindInfo {
  label: string;
  /** Short badge text. */
  short: string;
  min: number;
  max: number;
  step: number;
  /** The value picked when switching to this kind with smoothing on. */
  defaultValue: number;
  description: string;
}

export const SMOOTHING_KINDS: Record<SmoothingKind, SmoothingKindInfo> = {
  ema: {
    label: "Exponential moving average",
    short: "EMA",
    min: 0, max: 0.99, step: 0.01, defaultValue: 0.6,
    description: "Weight on the previous smoothed value",
  },
  twema: {
    label: "Time-weighted EMA",
    short: "TW-EMA",
    min: 0, max: 0.99, step: 0.01, defaultValue: 0.6,
    description: "EMA weight per average x-step, debiased at the start",
  },
  gaussian: {
    label: "Gaussian",
    short: "Gauss",
    min: 0, max: 50, step: 0.5, defaultValue: 3,
    description: "Kernel standard deviation, in points",
  },
  window: {
    label: "Running average",
    short: "Avg",
    min: 0, max: 200, step: 1, defaultValue: 10,
    description: "Trailing window size, in points",
  },
};

export function formatSmoothing(kind: SmoothingKind, value: number): string {
  return kind === "ema" || kind === "twema" ? value.toFixed(2) : String(value);
}

type Smoothed = { smoothed: SeriesPoint[]; raw: SeriesPoint[] | null };

/**
 * Smooth `points` (sorted by x) with `kind`. Returns the smoothed points and
 * the raw input (drawn faded underneath), or `{ smoothed: points, raw: null }`
 * when the value turns smoothing off.
 */
export function smoothSeries(points: SeriesPoint[], kind: SmoothingKind, value: number): Smoothed {
  if (!(value > 0) || points.length === 0) return { smoothed: points, raw: null };
  switch (kind) {
    case "ema": return emaSmooth(points, value);
    case "twema": return twemaSmooth(points, value);
    case "gaussian": return gaussianSmooth(points, value);
    case "window": return windowSmooth(points, value);
  }
}

/** y[i] = alpha * y[i-1] + (1 - alpha) * raw[i], seeded with raw[0]. */
export function emaSmooth(points: SeriesPoint[], alpha: number): Smoothed {
  const a = Math.min(alpha, 0.999);
  let prev = points[0]!.y;
  const smoothed = points.map((p) => {
    const sm = a * prev + (1 - a) * p.y;
    prev = sm;
    return { ...p, y: sm };
  });
  return { smoothed, raw: points };
}

/**
 * Debiased EMA whose decay scales with the x gap: a gap of `k` average steps
 * decays the memory by `alpha^k`, so irregular logging doesn't skew it.
 */
function twemaSmooth(points: SeriesPoint[], alpha: number): Smoothed {
  const a = Math.min(alpha, 0.999);
  const n = points.length;
  const span = points[n - 1]!.x - points[0]!.x;
  const meanDx = n > 1 && span > 0 ? span / (n - 1) : 1;
  let acc = 0;
  let weight = 0;
  let prevX = points[0]!.x;
  const smoothed = points.map((p) => {
    const decay = Math.pow(a, Math.max(0, p.x - prevX) / meanDx);
    acc = decay * acc + (1 - a) * p.y;
    weight = decay * weight + (1 - a);
    prevX = p.x;
    return { ...p, y: acc / weight };
  });
  return { smoothed, raw: points };
}

/** Gaussian kernel over point indices, truncated at 3 sigma and renormalised at the edges. */
function gaussianSmooth(points: SeriesPoint[], sigma: number): Smoothed {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Array<number>(2 * radius + 1);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
  const n = points.length;
  const smoothed = points.map((p, i) => {
    let sum = 0;
    let wsum = 0;
    for (let k = Math.max(-radius, -i); k <= Math.min(radius, n - 1 - i); k++) {
      const w = kernel[k + radius]!;
      sum += w * points[i + k]!.y;
      wsum += w;
    }
    return { ...p, y: sum / wsum };
  });
  return { smoothed, raw: points };
}

/** Trailing mean over the last `size` points (fewer at the start). */
function windowSmooth(points: SeriesPoint[], size: number): Smoothed {
  const w = Math.max(1, Math.round(size));
  if (w === 1) return { smoothed: points, raw: null };
  let sum = 0;
  const smoothed = points.map((p, i) => {
    sum += p.y;
    if (i >= w) sum -= points[i - w]!.y;
    return { ...p, y: sum / Math.min(i + 1, w) };
  });
  return { smoothed, raw: points };
}
