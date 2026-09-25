/**
 * Stacked and percent area charts (pure). The scalar chart draws each line
 * at its cumulative top and fills between consecutive tops (uPlot bands);
 * the tooltip still reads each line's own values.
 *
 * Columns are the chart's shared x grid, so a line is null wherever it did
 * not log. Within a line's own range a gap holds its last value (as-of);
 * outside its range it contributes nothing.
 */

export type StackMode = "none" | "stacked" | "percent";

/** A line's value at every column: as-of inside its range, null outside. */
export function fillWithin(col: ReadonlyArray<number | null>): Array<number | null> {
  const out = new Array<number | null>(col.length).fill(null);
  let first = -1;
  let last = -1;
  for (let j = 0; j < col.length; j++) {
    if (col[j] != null && Number.isFinite(col[j]!)) {
      if (first < 0) first = j;
      last = j;
    }
  }
  if (first < 0) return out;
  let held = col[first]!;
  for (let j = first; j <= last; j++) {
    const v = col[j];
    if (v != null && Number.isFinite(v)) held = v;
    out[j] = held;
  }
  return out;
}

/**
 * Cumulative tops of `cols` (bottom line first). `stacked`: top i is the sum
 * of lines 0..i; `percent`: that sum as a percentage of all lines' total at
 * the column (null where the total is 0). A column where none of lines 0..i
 * has a value is null for top i.
 */
export function stackColumns(
  cols: ReadonlyArray<ReadonlyArray<number | null>>,
  mode: Exclude<StackMode, "none">,
): Array<Array<number | null>> {
  const filled = cols.map(fillWithin);
  const n = filled[0]?.length ?? 0;
  const tops: Array<Array<number | null>> = [];
  const sum = new Array<number>(n).fill(0);
  const any = new Array<boolean>(n).fill(false);
  for (const col of filled) {
    const top = new Array<number | null>(n).fill(null);
    for (let j = 0; j < n; j++) {
      const v = col[j];
      if (v != null) {
        sum[j]! += v;
        any[j] = true;
      }
      if (any[j]) top[j] = sum[j]!;
    }
    tops.push(top);
  }
  if (mode === "stacked") return tops;
  // `sum` now holds every line's total per column.
  return tops.map((top) =>
    top.map((v, j) => (v == null || sum[j] === 0 ? null : (v / sum[j]!) * 100)),
  );
}
