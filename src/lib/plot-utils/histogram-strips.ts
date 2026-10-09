/**
 * The histogram card's heatmap over steps, one strip per run (or per
 * innermost group of the workspace, its runs' histograms merged per step),
 * every strip on one shared value grid (wandb's histogram panel). Pure:
 * runs under `node --test`.
 */

import { rebinHistograms, type HistogramData } from "./histogram.ts";

/** One strip to draw: a run, or an innermost group (its runs merged). */
export interface StripSpec {
  key: string;
  label: string;
  color: string;
  runIds: string[];
}

/**
 * The strips for `runIds` (in their order): grouped (`groupOf` maps a run to
 * its innermost group line), one strip per group line at its first run's
 * place; a run not in `groupOf` (or no grouping) is its own strip.
 */
export function planStrips(
  runIds: readonly string[],
  opts: {
    groupOf?: ReadonlyMap<string, string> | null;
    groupColor: (line: string) => string | undefined;
    runColor: (runId: string) => string;
    runLabel: (runId: string) => string;
  },
): StripSpec[] {
  const out: StripSpec[] = [];
  const byGroup = new Map<string, StripSpec>();
  for (const id of runIds) {
    const line = opts.groupOf?.get(id);
    if (line == null) {
      out.push({ key: id, label: opts.runLabel(id), color: opts.runColor(id), runIds: [id] });
      continue;
    }
    let s = byGroup.get(line);
    if (!s) {
      s = { key: `g\u0000${line}`, label: line, color: opts.groupColor(line) ?? opts.runColor(id), runIds: [] };
      byGroup.set(line, s);
      out.push(s);
    }
    s.runIds.push(id);
  }
  return out;
}

/** One logged histogram of a run: its step, its x on the chosen axis, its bins. */
export interface RunHistogram {
  step: number;
  /** The x-axis value (the step, seconds since the run started, or epoch ms). */
  x: number;
  hist: HistogramData;
}

/** A strip's columns: one per step, counts on the shared grid. */
export interface Strip extends StripSpec {
  steps: number[];
  /** Each column's x (a group: the earliest of its runs' at that step). */
  xs: number[];
  /** `counts[column][bin]`, summed over the strip's runs logging that step. */
  counts: number[][];
  /** Each column's total count. */
  totals: number[];
}

/**
 * Every strip's histograms resampled onto one shared uniform value grid
 * (spanning all of them), a group's runs summed per step (their samples
 * pooled), columns sorted by step.
 */
export function buildStrips(
  specs: readonly StripSpec[],
  byRun: ReadonlyMap<string, readonly RunHistogram[]>,
  bins = 64,
): { edges: number[]; strips: Strip[] } {
  const all: RunHistogram[] = [];
  for (const s of specs) for (const id of s.runIds) all.push(...(byRun.get(id) ?? []));
  const { edges, matrix } = rebinHistograms(all.map((h) => h.hist), bins);
  const rebinned = new Map<RunHistogram, number[]>(all.map((h, i) => [h, matrix[i]!]));
  const strips = specs.map((spec): Strip => {
    const cols = new Map<number, { x: number; counts: number[] }>();
    for (const id of spec.runIds) {
      for (const h of byRun.get(id) ?? []) {
        const row = rebinned.get(h)!;
        const col = cols.get(h.step);
        if (!col) {
          cols.set(h.step, { x: h.x, counts: [...row] });
          continue;
        }
        col.x = Math.min(col.x, h.x);
        for (let b = 0; b < row.length; b++) col.counts[b]! += row[b]!;
      }
    }
    const steps = [...cols.keys()].sort((a, b) => a - b);
    const counts = steps.map((st) => cols.get(st)!.counts);
    return {
      ...spec,
      steps,
      xs: steps.map((st) => cols.get(st)!.x),
      counts,
      totals: counts.map((c) => c.reduce((a, b) => a + b, 0)),
    };
  });
  return { edges, strips };
}

/**
 * The heatmap's z, `z[bin][column]`: the share of the step's samples in the
 * bin (density, comparable across strips and steps), or `log₁₀(1 + count)`.
 * Empty cells are null (not painted).
 */
export function stripZ(strip: Strip, scale: "density" | "log"): Array<Array<number | null>> {
  const bins = strip.counts[0]?.length ?? 0;
  const z: Array<Array<number | null>> = [];
  for (let b = 0; b < bins; b++) {
    z.push(
      strip.counts.map((col, c) => {
        const v = col[b]!;
        if (!(v > 0)) return null;
        return scale === "log" ? Math.log10(1 + v) : v / (strip.totals[c] || 1);
      }),
    );
  }
  return z;
}

/** The largest z over the strips (the shared colour range's top; 1 when there is none). */
export function maxZ(zs: ReadonlyArray<ReadonlyArray<ReadonlyArray<number | null>>>): number {
  let m = 0;
  for (const z of zs) for (const row of z) for (const v of row) if (v != null && v > m) m = v;
  return m > 0 ? m : 1;
}

/** The column nearest to `x` (ties: the earlier one); -1 for an empty strip. */
export function columnAt(strip: Pick<Strip, "xs">, x: number): number {
  let best = -1;
  let dist = Infinity;
  strip.xs.forEach((cx, i) => {
    const d = Math.abs(cx - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/** The bin of the shared grid that holds `value` (clamped); -1 for no grid. */
export function binAt(edges: readonly number[], value: number): number {
  const bins = edges.length - 1;
  if (bins < 1) return -1;
  const w = (edges[bins]! - edges[0]!) / bins;
  return Math.max(0, Math.min(bins - 1, Math.floor((value - edges[0]!) / (w || 1))));
}

/** What the hover tooltip shows: the hovered step's histogram of one strip. */
export interface StripTooltip {
  step: number;
  x: number;
  counts: number[];
  total: number;
  /** The hovered bin (-1: none). */
  bin: number;
}

/** The tooltip for a hover at (`x`, `value`) over `strip`; null for an empty strip. */
export function stripTooltip(strip: Strip, edges: readonly number[], x: number, value: number | null): StripTooltip | null {
  const c = columnAt(strip, x);
  if (c < 0) return null;
  return {
    step: strip.steps[c]!,
    x: strip.xs[c]!,
    counts: strip.counts[c]!,
    total: strip.totals[c]!,
    bin: value == null ? -1 : binAt(edges, value),
  };
}
