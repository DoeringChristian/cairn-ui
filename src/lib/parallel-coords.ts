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
    return { kind: "numeric", lo: Math.min(...xs), hi: Math.max(...xs), log };
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
