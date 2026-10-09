/**
 * Windowing math for the runs table (components/runs-table/use-window.ts):
 * only the rows (and, on the Runs page, the scrolling columns) near the
 * viewport are rendered, with spacers standing in for the rest. Items have
 * measured sizes (rows: heights, columns: widths); `offsets` are their
 * prefix sums. Pure: tested in window.test.ts.
 */

/** More rows than this are windowed (fewer render as they always did). */
export const ROW_WINDOW_MIN = 100;
/** More scrolling columns than this are windowed (the Runs page). */
export const COL_WINDOW_MIN = 30;
/** Rows rendered beyond the viewport, px each side. */
export const ROW_OVERSCAN = 600;
/** Columns rendered beyond the viewport, px each side. */
export const COL_OVERSCAN = 800;
/** Candidate cells measured per column for its width (the longest texts). */
export const WIDTH_CANDIDATES = 3;

/** A half-open item range `[start, end)`. */
export interface Range {
  start: number;
  end: number;
}

/** `offsets[i]`: where item `i` starts; `offsets[n]`: the total size. */
export function prefixSums(sizes: readonly number[]): number[] {
  const out = new Array<number>(sizes.length + 1);
  out[0] = 0;
  for (let i = 0; i < sizes.length; i++) out[i + 1] = out[i]! + sizes[i]!;
  return out;
}

/** The first item ending after `x` (n when none). */
function firstEndingAfter(offsets: readonly number[], x: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The items overlapping `[lo, hi)`, in the items' coordinates. */
export function rangeIn(offsets: readonly number[], lo: number, hi: number): Range {
  const n = offsets.length - 1;
  if (n <= 0 || hi <= lo) {
    const at = n <= 0 ? 0 : Math.min(n, firstEndingAfter(offsets, lo));
    return { start: at, end: at };
  }
  const start = firstEndingAfter(offsets, lo);
  let end = start;
  while (end < n && offsets[end]! < hi) end++;
  return { start, end };
}

/**
 * The range to render for the visible span `[lo, hi)`: the visible items
 * plus `overscan` px each side. The `current` range is kept while it still
 * covers every visible item and is not too far ahead (so scrolling within
 * the overscan re-renders nothing); `keep` (a focused row) is always in.
 */
export function nextWindow(
  offsets: readonly number[],
  lo: number,
  hi: number,
  overscan: number,
  current: Range | null,
  keep: number | null = null,
): Range {
  const n = offsets.length - 1;
  const visible = rangeIn(offsets, lo, hi);
  const wanted = rangeIn(offsets, lo - overscan, hi + overscan);
  let next = wanted;
  if (current && current.end <= n && current.start <= visible.start && current.end >= visible.end) {
    // Not further than twice the overscan past the visible span on either side.
    const loose = rangeIn(offsets, lo - 2 * overscan, hi + 2 * overscan);
    if (current.start >= loose.start && current.end <= loose.end) next = current;
  }
  if (keep != null && keep >= 0 && keep < n) {
    next = { start: Math.min(next.start, keep), end: Math.max(next.end, keep + 1) };
  }
  return current && next.start === current.start && next.end === current.end ? current : next;
}

/** The spacers' sizes around a rendered range. */
export function padding(offsets: readonly number[], r: Range): { before: number; after: number } {
  const total = offsets[offsets.length - 1] ?? 0;
  return { before: offsets[r.start] ?? 0, after: total - (offsets[r.end] ?? total) };
}

/**
 * Up to `k` items with the largest `length` (ties: the earlier one), in
 * descending length; items of length 0 are never picked. A column's width
 * is measured from its candidates (the longest texts) rather than every row.
 */
export function longest<T>(items: readonly T[], length: (item: T) => number, k: number = WIDTH_CANDIDATES): T[] {
  const top: { item: T; len: number }[] = [];
  for (const item of items) {
    const len = length(item);
    if (len <= 0 || (top.length === k && len <= top[k - 1]!.len)) continue;
    let i = top.length;
    while (i > 0 && top[i - 1]!.len < len) i--;
    top.splice(i, 0, { item, len });
    if (top.length > k) top.pop();
  }
  return top.map((t) => t.item);
}
