/**
 * Scatter overlays: a least-squares regression line, running min / max /
 * mean lines, and reference lines as Plotly shapes. Pure; tested in
 * `scatter-extras.test.ts`.
 *
 * Log axes: Plotly places shapes and annotations on a log axis in log10
 * units, and a fit on a log axis is a fit in log space, so every helper
 * takes the axes' log flags.
 */

export interface XY {
  x: number;
  y: number;
}

export interface AxesLog {
  xLog?: boolean;
  yLog?: boolean;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination; 1 when y is constant and fits exactly. */
  r2: number;
  n: number;
}

/** Ordinary least squares y = slope·x + intercept; null for < 2 points or constant x. */
export function linearFit(xs: readonly number[], ys: readonly number[]): LinearFit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

const fwd = (v: number, log?: boolean) => (log ? (v > 0 ? Math.log10(v) : NaN) : v);
const inv = (v: number, log?: boolean) => (log ? 10 ** v : v);

/**
 * The regression line through `points`, fitted in the displayed (possibly
 * log) space across the points' x extent, as its two end points in data
 * units (Plotly draws it straight in pixel space). Points that cannot be
 * shown on a log axis are left out. Null when no line can be fitted.
 */
export function regressionLine(
  points: readonly XY[],
  axes: AxesLog = {},
): { x: number[]; y: number[]; fit: LinearFit } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const x = fwd(p.x, axes.xLog);
    const y = fwd(p.y, axes.yLog);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  const fit = linearFit(xs, ys);
  if (!fit) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const x = [lo, hi].map((t) => inv(t, axes.xLog));
  const y = [lo, hi].map((t) => inv(fit.slope * t + fit.intercept, axes.yLog));
  return { x, y, fit };
}

export type RunningStat = "min" | "max" | "mean";

/**
 * The cumulative min / max / mean of y as x grows: one point per distinct x
 * (ties are folded in together), sorted by x.
 */
export function runningStat(points: readonly XY[], stat: RunningStat): { x: number[]; y: number[] } {
  const sorted = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice()
    .sort((a, b) => a.x - b.x);
  const x: number[] = [];
  const y: number[] = [];
  let acc = stat === "min" ? Infinity : stat === "max" ? -Infinity : 0;
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    n += 1;
    if (stat === "min") acc = Math.min(acc, p.y);
    else if (stat === "max") acc = Math.max(acc, p.y);
    else acc += p.y;
    if (i + 1 < sorted.length && sorted[i + 1]!.x === p.x) continue;
    x.push(p.x);
    y.push(stat === "mean" ? acc / n : acc);
  }
  return { x, y };
}

/** A horizontal (`axis: "y"`) or vertical (`axis: "x"`) line at `value`. */
export interface RefLine {
  axis: "x" | "y";
  value: number;
  label?: string;
}

export const MAX_REF_LINES = 5;

/**
 * Plotly shapes (dotted lines across the plot) and annotations (their
 * labels) for reference lines. Lines that cannot be shown (non-finite, or
 * <= 0 on a log axis) are skipped; at most `MAX_REF_LINES`.
 */
export function refLineShapes(
  lines: readonly RefLine[],
  opts: AxesLog & { color: string },
): { shapes: Array<Record<string, unknown>>; annotations: Array<Record<string, unknown>> } {
  const shapes: Array<Record<string, unknown>> = [];
  const annotations: Array<Record<string, unknown>> = [];
  for (const l of lines.slice(0, MAX_REF_LINES)) {
    const v = fwd(l.value, l.axis === "x" ? opts.xLog : opts.yLog);
    if (!Number.isFinite(v)) continue;
    const line = { color: opts.color, width: 1, dash: "dot" };
    if (l.axis === "x") {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: v, x1: v, y0: 0, y1: 1, line });
      if (l.label) {
        annotations.push({
          xref: "x", yref: "paper", x: v, y: 1, text: l.label, showarrow: false,
          xanchor: "left", yanchor: "top", font: { size: 10, color: opts.color },
        });
      }
    } else {
      shapes.push({ type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: v, y1: v, line });
      if (l.label) {
        annotations.push({
          xref: "paper", yref: "y", x: 1, y: v, text: l.label, showarrow: false,
          xanchor: "right", yanchor: "bottom", font: { size: 10, color: opts.color },
        });
      }
    }
  }
  return { shapes, annotations };
}

/**
 * A Plotly axis range from optional bounds: both set → fixed, one set → the
 * other autoranges, none → auto. On a log axis the bounds are in log10 units.
 */
export function axisRange(
  r: { min: number | null; max: number | null; log: boolean },
): { autorange: boolean | "min" | "max"; range?: [number | null, number | null] } {
  if (r.min == null && r.max == null) return { autorange: true };
  const lo = r.min == null ? null : fwd(r.min, r.log);
  const hi = r.max == null ? null : fwd(r.max, r.log);
  const ok = (v: number | null) => v == null || Number.isFinite(v);
  if (!ok(lo) || !ok(hi)) return { autorange: true };
  return { autorange: lo == null ? "min" : hi == null ? "max" : false, range: [lo, hi] };
}
