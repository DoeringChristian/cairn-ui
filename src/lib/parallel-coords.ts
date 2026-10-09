/**
 * Parallel coordinates (wandb's): the axes, the lines and the brushing of
 * the parallel-coordinates card. Pure.
 *
 * - Axes: by default every config key that varies across the card's runs
 *   (in the order the runs log them), then the chosen metric (its final
 *   value under the project's summary rule, `run.values`). The card's
 *   settings may list them instead (config keys and metrics, each optionally
 *   on a log scale).
 * - An axis is numeric when every value on it is a number (linear, or log10
 *   where positive), else categorical: its distinct values as ordered
 *   categories (numbers first, ascending, then text).
 * - Lines: one per unit (a run, or an innermost group of a grouped
 *   workspace, lib/summary-tables.ts `unitsOf`). A group's value on an axis
 *   is its runs' mean for numbers; anything else is shown only when its runs
 *   agree, else the line skips that axis (as for a missing value).
 * - Brushing: per axis a range of positions (0 = bottom, 1 = top); a line
 *   matches when it lies inside every brush.
 */

import { aggregate, MIXED, type Scalar, type Unit } from "./summary-tables.ts";

export type AxisKind = "config" | "metric";

export interface ParallelAxis {
  kind: AxisKind;
  /** A config key (dotted) or a metric name. */
  key: string;
  /** Numeric axes only: a log10 scale. */
  log?: boolean;
}

/** What a run brings to the card: its config and final metric values. */
export interface PcRun {
  id: string;
  config: Readonly<Record<string, Scalar>>;
  values: Readonly<Record<string, Scalar>>;
}

const sameAxis = (a: ParallelAxis, b: ParallelAxis) => a.kind === b.kind && a.key === b.key;

/** Config keys with at least two distinct values over `runs`, in first-seen order. */
export function varyingConfigKeys(runs: readonly PcRun[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.config)) {
      if (v == null) continue;
      let s = seen.get(k);
      if (!s) seen.set(k, (s = new Set()));
      s.add(JSON.stringify(v));
    }
  }
  return [...seen].filter(([, s]) => s.size >= 2).map(([k]) => k);
}

/** The default axes: the varying config keys, then the metric. */
export function defaultAxes(runs: readonly PcRun[], metric: string | null): ParallelAxis[] {
  const axes: ParallelAxis[] = varyingConfigKeys(runs).map((key) => ({ kind: "config", key }));
  if (metric) axes.push({ kind: "metric", key: metric });
  return axes;
}

/**
 * The axes after choosing `next` as the metric: an explicit list swaps the
 * old metric's axis (or appends one); null (the defaults) stays null.
 */
export function axesWithMetric(axes: readonly ParallelAxis[] | null, old: string | null, next: string): ParallelAxis[] | null {
  if (axes == null) return null;
  const at = old == null ? -1 : axes.findIndex((a) => sameAxis(a, { kind: "metric", key: old }));
  const without = axes.filter((a) => !sameAxis(a, { kind: "metric", key: next }));
  if (at < 0) return [...without, { kind: "metric", key: next }];
  return axes.flatMap((a, i) => (i === at ? [{ ...a, key: next }] : sameAxis(a, { kind: "metric", key: next }) ? [] : [a]));
}

/** A run's value on an axis (null: missing). */
export function runValue(run: PcRun, axis: ParallelAxis): Scalar {
  const v = (axis.kind === "config" ? run.config : run.values)[axis.key];
  return v === undefined ? null : v;
}

/** A unit's value on an axis: a run's own; a group's mean of numbers, else its runs' common value (null when they differ). */
export function unitValue(runs: readonly PcRun[], axis: ParallelAxis): Scalar {
  if (runs.length === 1) return runValue(runs[0]!, axis);
  const v = aggregate(runs.map((r) => runValue(r, axis)));
  return v === MIXED ? null : v;
}

export interface PcLine {
  /** The unit's key (`run:<id>`, `group:<line>`). */
  key: string;
  unit: Unit;
  /** One value per axis (null: the line skips the axis). */
  values: Scalar[];
}

export function linesOf(units: readonly Unit[], axes: readonly ParallelAxis[]): PcLine[] {
  return units.map((unit) => ({
    key: unit.key,
    unit,
    values: axes.map((a) => unitValue(unit.runs, a)),
  }));
}

export type AxisScale =
  | { kind: "numeric"; lo: number; hi: number; log: boolean }
  | { kind: "categorical"; categories: string[] };

const catKey = (v: Scalar) => (typeof v === "string" ? v : JSON.stringify(v));

/** An axis's scale over the lines' values on it. */
export function axisScale(values: readonly Scalar[], log = false): AxisScale {
  const present = values.filter((v): v is Exclude<Scalar, null> => v != null);
  if (present.every((v) => typeof v === "number")) {
    const xs = (present as number[]).filter((v) => Number.isFinite(v) && (!log || v > 0)).map((v) => (log ? Math.log10(v) : v));
    if (xs.length === 0) return { kind: "numeric", lo: 0, hi: 1, log };
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    // Means that differ only by rounding (3.7e-4 vs 3.7000000000000005e-4) are one value.
    return { kind: "numeric", lo, hi: hi - lo <= 1e-9 * Math.max(Math.abs(lo), Math.abs(hi)) ? lo : hi, log };
  }
  const nums = [...new Set(present.filter((v): v is number => typeof v === "number"))].sort((a, b) => a - b);
  const texts = [...new Set(present.filter((v) => typeof v !== "number").map(catKey))].sort();
  return { kind: "categorical", categories: [...nums.map(catKey), ...texts] };
}

/** A value's position on its axis in [0, 1] (1 = top: the largest / last category); null when it has none. */
export function position(scale: AxisScale, v: Scalar): number | null {
  if (v == null) return null;
  if (scale.kind === "categorical") {
    const i = scale.categories.indexOf(catKey(v));
    if (i < 0) return null;
    return scale.categories.length === 1 ? 0.5 : i / (scale.categories.length - 1);
  }
  if (typeof v !== "number" || !Number.isFinite(v) || (scale.log && v <= 0)) return null;
  const x = scale.log ? Math.log10(v) : v;
  return scale.hi === scale.lo ? 0.5 : (x - scale.lo) / (scale.hi - scale.lo);
}

/** The tick labels of an axis: top and bottom for numbers (original units), every category otherwise. */
export function axisTicks(scale: AxisScale): Array<{ at: number; value: Scalar }> {
  if (scale.kind === "categorical") {
    const n = scale.categories.length;
    return scale.categories.map((c, i) => ({ at: n === 1 ? 0.5 : i / (n - 1), value: c }));
  }
  const un = (x: number) => (scale.log ? 10 ** x : x);
  if (scale.hi === scale.lo) return [{ at: 0.5, value: un(scale.lo) }];
  return [
    { at: 1, value: un(scale.hi) },
    { at: 0, value: un(scale.lo) },
  ];
}

/** A brush on an axis: positions [lo, hi], 0 = bottom. */
export type Brush = readonly [number, number];

/** Whether a line's positions lie inside every brush (axis index → range); a missing position never matches. */
export function brushMatches(positions: ReadonlyArray<number | null>, brushes: ReadonlyMap<number, Brush>): boolean {
  for (const [axis, [lo, hi]] of brushes) {
    const p = positions[axis];
    if (p == null || p < Math.min(lo, hi) - 1e-9 || p > Math.max(lo, hi) + 1e-9) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Many axes: which default axes fit, and labels that never overlap.
// ---------------------------------------------------------------------------

/**
 * The least room between two axes, px: an axis's tick values are drawn to
 * its left (up to ~9 characters of 10px mono) and must clear the previous
 * axis.
 */
export const MIN_AXIS_GAP = 64;

/** How many axes a plot `span` px wide holds (at least 2). */
export function axesThatFit(span: number): number {
  return Math.max(2, Math.floor(span / MIN_AXIS_GAP) + 1);
}

/** Bins a numeric axis's values fall into for `axisVariation`. */
const VARIATION_BINS = 10;

/**
 * How much the runs vary along a config key: the Shannon entropy (bits) of
 * its present values, numbers counted in `VARIATION_BINS` equal-width bins
 * over their range (in log10 when every value is positive and they span
 * more than two decades: a learning rate), anything else by distinct value.
 * 0 for a constant; up to log2(bins) for numbers spread evenly.
 */
export function axisVariation(values: readonly Scalar[]): number {
  const present = values.filter((v): v is Exclude<Scalar, null> => v != null);
  if (present.length === 0) return 0;
  const counts = new Map<string, number>();
  const nums = present.every((v) => typeof v === "number" && Number.isFinite(v)) ? (present as number[]) : null;
  if (nums) {
    const log = nums.every((v) => v > 0) && Math.max(...nums) / Math.min(...nums) > 100;
    const xs = log ? nums.map(Math.log10) : nums;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    for (const x of xs) {
      const bin = hi === lo ? 0 : Math.min(VARIATION_BINS - 1, Math.floor(((x - lo) / (hi - lo)) * VARIATION_BINS));
      counts.set(String(bin), (counts.get(String(bin)) ?? 0) + 1);
    }
  } else {
    for (const v of present) counts.set(catKey(v), (counts.get(catKey(v)) ?? 0) + 1);
  }
  let h = 0;
  for (const c of counts.values()) {
    const p = c / present.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * The default axes a card shows when it holds at most `max` axes: all of
 * them when they fit, else the metric axis and the `max - 1` config keys
 * the runs vary most along (`axisVariation`; ties: the earlier key), in
 * their default order. The rest are added in the settings.
 */
export function fitDefaultAxes(axes: readonly ParallelAxis[], runs: readonly PcRun[], max: number): ParallelAxis[] {
  if (axes.length <= max) return [...axes];
  const metrics = axes.filter((a) => a.kind === "metric");
  const room = Math.max(0, max - metrics.length);
  const ranked = axes
    .map((a, i) => ({ a, i, v: a.kind === "config" ? axisVariation(runs.map((r) => runValue(r, a))) : -1 }))
    .filter((x) => x.a.kind === "config")
    .sort((x, y) => y.v - x.v || x.i - y.i)
    .slice(0, room);
  const keep = new Set(ranked.map((x) => x.i));
  return axes.filter((a, i) => a.kind === "metric" || keep.has(i));
}

/** Width of one character of an axis label (11px monospace), px. */
export const LABEL_CHAR_W = 6.7;
/** Most characters an axis label shows (the rest: "…", the full name in its tooltip). */
export const LABEL_MAX_CHARS = 22;

export interface AxisLabel {
  /** The label as drawn (truncated with "…" when its room is short). */
  text: string;
  /** 0: the top row; 1: the second row (labels staggered). */
  row: 0 | 1;
}

const clip = (label: string, chars: number) =>
  label.length <= chars ? label : chars <= 1 ? "…" : `${label.slice(0, chars - 1)}…`;

/**
 * The axes' labels, centred over axes at `xs` in a plot `width` px wide,
 * so that no two overlap: on one row when every label (at most
 * `LABEL_MAX_CHARS`) fits between its neighbours; else staggered on two
 * rows (alternate axes), each label truncated to the room up to the next
 * label on its row. A label never runs past the plot's edges.
 */
export function axisLabels(labels: readonly string[], xs: readonly number[], width: number): AxisLabel[] {
  /** Room between label `i` and its neighbours `step` axes away (none: unbounded). */
  const between = (i: number, step: number) => {
    const left = i - step >= 0 ? (xs[i]! - xs[i - step]!) / 2 : Infinity;
    const right = i + step < xs.length ? (xs[i + step]! - xs[i]!) / 2 : Infinity;
    // Centred: twice the nearer side, less a gap between neighbours.
    return 2 * Math.min(left, right) - 6;
  };
  /** Room up to the plot's edges. */
  const edges = (i: number) => 2 * Math.min(xs[i]!, width - xs[i]!);
  const chars = (px: number) => Math.max(0, Math.min(LABEL_MAX_CHARS, Math.floor(px / LABEL_CHAR_W)));
  const oneRow = labels.every((l, i) => Math.min(l.length, LABEL_MAX_CHARS) <= chars(between(i, 1)));
  const step = oneRow ? 1 : 2;
  return labels.map((l, i) => ({
    text: clip(l, chars(Math.min(between(i, step), edges(i)))),
    row: (oneRow ? 0 : i % 2) as 0 | 1,
  }));
}
