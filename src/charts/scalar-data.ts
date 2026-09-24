import { smoothSeries, type SmoothingKind } from "../lib/plot-utils/smooth.ts";
import { filterOutliers } from "../lib/plot-utils/outlier.ts";
import type { AxisScale, Series, SeriesPoint } from "../lib/plot-utils/types.ts";

/**
 * One drawn line: a series, the faded raw copy under a smoothed one ("raw"),
 * a group member, or a band edge (which shares its mean line's key).
 */
export type DrawnRole = "line" | "raw" | "member" | "bandHi" | "bandLo";

export interface DrawnSeries {
  key: string;
  label: string;
  color: string;
  role: DrawnRole;
  /** Source points aligned with the shared x array (null = no sample at that x). */
  points: Array<SeriesPoint | null>;
}

export interface AlignedData {
  xs: number[];
  lines: DrawnSeries[];
}

/**
 * Put every series on one shared, sorted x array — uPlot draws columns, and
 * runs rarely log at the same steps. Missing samples become null and the
 * line spans over them. Values a log axis can't show become null too.
 */
export function alignSeries(
  series: Series[],
  opts: { smoothing: number; smoothingKind: SmoothingKind; outlierPct: [number, number]; xScale: AxisScale; yScale: AxisScale },
): AlignedData {
  const prepared: Array<{ s: Series; role: DrawnRole; points: SeriesPoint[] }> = [];
  for (const s of series) {
    const role = s.role ?? "line";
    const band = role === "bandHi" || role === "bandLo";
    // Band edges are already aggregates: no outlier cut, smoothing or raw copy.
    let points = band ? s.points : filterOutliers(s.points, opts.outlierPct[0], opts.outlierPct[1]);
    if (opts.xScale === "log") points = points.filter((p) => p.x > 0);
    if (opts.yScale === "log") points = points.filter((p) => p.y > 0);
    if (band) {
      prepared.push({ s, role, points });
      continue;
    }
    const { smoothed, raw } = smoothSeries(points, opts.smoothingKind, opts.smoothing);
    // A member is already the faded copy under its group's mean.
    if (raw && role === "line") prepared.push({ s, role: "raw", points: raw });
    prepared.push({ s, role, points: smoothed });
  }

  const xSet = new Set<number>();
  for (const p of prepared) for (const pt of p.points) xSet.add(pt.x);
  const xs = Array.from(xSet).sort((a, b) => a - b);
  const index = new Map<number, number>();
  xs.forEach((x, i) => index.set(x, i));

  const lines = prepared.map(({ s, role, points }) => {
    const col = new Array<SeriesPoint | null>(xs.length).fill(null);
    for (const pt of points) col[index.get(pt.x)!] = pt;
    return { key: s.key, label: s.label, color: s.color, role, points: col };
  });
  return { xs, lines };
}
