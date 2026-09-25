/**
 * Grouped runs: collapse each group's member series into a centre line (the
 * mean, median, min or max of the members) and a band (± std, min–max, or ±
 * standard error around the centre). Pure, so it is unit-tested.
 *
 * Members rarely log at the same x, so every member is sampled "as of" each x
 * of the GLOBAL union grid (all members of all groups): its last point at or
 * before x, and nothing outside its own [first, last] x. Using one grid for
 * every group puts every band on the same columns, which is what uPlot draws.
 * Aggregation happens before smoothing (the mean line is then smoothed like
 * any other line; bands are not).
 */
import { seriesColor, type Series, type SeriesPoint } from "./types.ts";

export type BandKind = "std" | "minmax" | "sem";

/** The statistic a group's centre line draws. */
export type AggKind = "mean" | "median" | "min" | "max";

/** The `agg` statistic of `vals` (non-empty). */
export function centre(vals: readonly number[], agg: AggKind): number {
  if (agg === "min") return Math.min(...vals);
  if (agg === "max") return Math.max(...vals);
  if (agg === "median") {
    const s = [...vals].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  }
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export interface GroupInput<M> {
  /** Stable group identity (the line key). */
  key: string;
  members: M[];
}

export interface AggregatedGroup<M> {
  key: string;
  members: M[];
  mean: SeriesPoint[];
  lo: SeriesPoint[];
  hi: SeriesPoint[];
}

/** Group items by `keyOf`; items whose key is null are left out (and returned apart). */
export function groupBy<M>(
  items: M[],
  keyOf: (item: M) => string | null,
): { groups: GroupInput<M>[]; ungrouped: M[] } {
  const byKey = new Map<string, M[]>();
  const ungrouped: M[] = [];
  for (const item of items) {
    const k = keyOf(item);
    if (k == null) {
      ungrouped.push(item);
      continue;
    }
    let list = byKey.get(k);
    if (!list) byKey.set(k, (list = []));
    list.push(item);
  }
  return { groups: [...byKey].map(([key, members]) => ({ key, members })), ungrouped };
}

/** Sorted, de-duplicated union of every point's x. */
export function unionGrid(series: SeriesPoint[][]): number[] {
  const xs = new Set<number>();
  for (const s of series) for (const p of s) if (Number.isFinite(p.x)) xs.add(p.x);
  return [...xs].sort((a, b) => a - b);
}

/**
 * The member's value as of each grid x (its last point with `p.x <= x`), or
 * null before its first and after its last point. `points` need not be sorted.
 */
export function asOf(points: SeriesPoint[], grid: number[]): Array<number | null> {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  const out = new Array<number | null>(grid.length).fill(null);
  if (pts.length === 0) return out;
  const last = pts[pts.length - 1]!.x;
  let j = -1;
  for (let i = 0; i < grid.length; i++) {
    const x = grid[i]!;
    while (j + 1 < pts.length && pts[j + 1]!.x <= x) j++;
    if (j >= 0 && x <= last) out[i] = pts[j]!.y;
  }
  return out;
}

/**
 * Centre line (`agg`, default the mean) and band of the values present at
 * each grid column. The std / sem band spreads around the centre.
 */
export function aggregate(
  members: SeriesPoint[][],
  grid: number[],
  band: BandKind,
  agg: AggKind = "mean",
): { mean: SeriesPoint[]; lo: SeriesPoint[]; hi: SeriesPoint[] } {
  const sampled = members.map((m) => asOf(m, grid));
  const mean: SeriesPoint[] = [];
  const lo: SeriesPoint[] = [];
  const hi: SeriesPoint[] = [];
  for (let i = 0; i < grid.length; i++) {
    const vals: number[] = [];
    for (const s of sampled) if (s[i] != null) vals.push(s[i]!);
    if (vals.length === 0) continue;
    const x = grid[i]!;
    const n = vals.length;
    const m = vals.reduce((a, b) => a + b, 0) / n;
    const c = centre(vals, agg);
    let l: number;
    let h: number;
    if (band === "minmax") {
      l = Math.min(...vals);
      h = Math.max(...vals);
    } else {
      // Sample standard deviation (n - 1); a single member has no spread.
      const sd = n > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : 0;
      const d = band === "sem" ? sd / Math.sqrt(n) : sd;
      l = c - d;
      h = c + d;
    }
    mean.push({ x, y: c });
    lo.push({ x, y: l });
    hi.push({ x, y: h });
  }
  return { mean, lo, hi };
}

/** Aggregate every group on one grid: the union of all members of all groups. */
export function aggregateGroups<M>(
  groups: GroupInput<M>[],
  pointsOf: (member: M) => SeriesPoint[],
  band: BandKind,
  agg: AggKind = "mean",
): AggregatedGroup<M>[] {
  const grid = unionGrid(groups.flatMap((g) => g.members.map(pointsOf)));
  return groups.map((g) => ({ key: g.key, members: g.members, ...aggregate(g.members.map(pointsOf), grid, band, agg) }));
}

/** One run's series and the group it falls in (null = not grouped). */
export interface GroupableSeries {
  series: Series;
  /** Metric identity (its name): groups never mix metrics. */
  metricKey: string;
  metricName: string;
  group: string | null;
}

/**
 * Replace grouped runs' series by, per (metric, group): the members (faded,
 * unless `hideMembers`), the band edges, and the centre line (`agg`).
 * Everything a group draws takes the group's colour (`groupColor`, default a
 * palette slot per group in first-seen order); a one-run group is just that
 * run's line. Ungrouped series pass through with their own colour.
 */
export function groupSeries(
  items: GroupableSeries[],
  opts: {
    band: BandKind;
    hideMembers: boolean;
    labelMetric: boolean;
    agg?: AggKind;
    groupColor?: (group: string) => string;
  },
): { series: Series[]; groups: number } {
  const { groups, ungrouped } = groupBy(items, (i) => (i.group == null ? null : `${i.metricKey}\u0000${i.group}`));
  const colourIndex = new Map<string, number>();
  for (const g of groups) {
    const value = g.members[0]!.group!;
    if (!colourIndex.has(value)) colourIndex.set(value, colourIndex.size);
  }
  const colorOf = opts.groupColor ?? ((group: string) => seriesColor(colourIndex.get(group)!));
  const aggregated = aggregateGroups(groups, (m) => m.series.points, opts.band, opts.agg ?? "mean");
  const out: Series[] = [];
  for (const g of aggregated) {
    const first = g.members[0]!;
    const color = colorOf(first.group!);
    const label = `${opts.labelMetric ? `${first.metricName} · ` : ""}${first.group} (n=${g.members.length})`;
    if (g.members.length === 1) {
      out.push({ ...first.series, key: g.key, label, color, role: "line" });
      continue;
    }
    if (!opts.hideMembers) {
      for (const m of g.members) out.push({ ...m.series, color, role: "member" });
    }
    out.push({ key: g.key, label, color, points: g.hi, role: "bandHi" });
    out.push({ key: g.key, label, color, points: g.lo, role: "bandLo" });
    out.push({ key: g.key, label, color, points: g.mean, role: "line" });
  }
  for (const u of ungrouped) out.push(u.series);
  return { series: out, groups: groups.length };
}
