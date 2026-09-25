/**
 * Client-side min/max bucketing (pure): a dense line becomes one point per x
 * pixel bucket (the bucket's mean) plus the bucket's min and max, drawn as a
 * band. Recomputed for the visible x range on every zoom, so zooming in shows
 * more detail until every point has its own bucket.
 */
import type { SeriesPoint } from "./types.ts";

export interface BucketOptions {
  /** Visible x range; null ends take the data's extent. */
  lo: number | null;
  hi: number | null;
  /** Number of buckets across the range (≈ the plot width in px). */
  buckets: number;
  /** Buckets equally wide in log(x) (a log x-axis). */
  log?: boolean;
}

export interface Bucketed {
  /** Each bucket's mean at its centre, plus the nearest point outside each end. */
  line: SeriesPoint[];
  /** The bucket's min and max at the same x (empty when not bucketed). */
  lo: SeriesPoint[];
  hi: SeriesPoint[];
  /** False when the range held at most `buckets` points: `line` is the input. */
  bucketed: boolean;
}

/**
 * Bucket `points` (sorted by x) over [lo, hi]. With no more points in range
 * than buckets the line is returned as is. Points outside the range keep
 * only the nearest one on each side, so the line still runs to the edges.
 */
export function bucketPoints(points: readonly SeriesPoint[], opts: BucketOptions): Bucketed {
  const n = Math.max(1, Math.floor(opts.buckets));
  const log = !!opts.log;
  const first = points[0]?.x;
  const last = points[points.length - 1]?.x;
  const lo = opts.lo ?? first ?? 0;
  const hi = opts.hi ?? last ?? 0;
  const inRange: SeriesPoint[] = [];
  let before: SeriesPoint | null = null;
  let after: SeriesPoint | null = null;
  for (const p of points) {
    if (p.x < lo) before = p;
    else if (p.x > hi) {
      if (!after) after = p;
    } else inRange.push(p);
  }
  if (inRange.length <= n || !(hi > lo) || (log && lo <= 0)) {
    return { line: [...points], lo: [], hi: [], bucketed: false };
  }

  const t = (x: number) => (log ? Math.log(x) : x);
  const inv = (v: number) => (log ? Math.exp(v) : v);
  const t0 = t(lo);
  const width = (t(hi) - t0) / n;
  const sum = new Array<number>(n).fill(0);
  const count = new Array<number>(n).fill(0);
  const min = new Array<number>(n).fill(Infinity);
  const max = new Array<number>(n).fill(-Infinity);
  const wall = new Array<string | undefined>(n);
  for (const p of inRange) {
    const b = Math.min(n - 1, Math.max(0, Math.floor((t(p.x) - t0) / width)));
    sum[b]! += p.y;
    count[b]!++;
    if (p.y < min[b]!) min[b] = p.y;
    if (p.y > max[b]!) max[b] = p.y;
    wall[b] = p.wallTime;
  }

  const line: SeriesPoint[] = [];
  const loPts: SeriesPoint[] = [];
  const hiPts: SeriesPoint[] = [];
  const edge = (p: SeriesPoint) => {
    line.push(p);
    loPts.push({ x: p.x, y: p.y });
    hiPts.push({ x: p.x, y: p.y });
  };
  if (before) edge(before);
  for (let b = 0; b < n; b++) {
    if (count[b] === 0) continue;
    const x = inv(t0 + (b + 0.5) * width);
    const pt: SeriesPoint = { x, y: sum[b]! / count[b]! };
    if (wall[b] !== undefined) pt.wallTime = wall[b];
    line.push(pt);
    loPts.push({ x, y: min[b]! });
    hiPts.push({ x, y: max[b]! });
  }
  if (after) edge(after);
  return { line, lo: loPts, hi: hiPts, bucketed: true };
}
