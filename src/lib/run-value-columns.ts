/**
 * The run table's metric columns — the decisions, separate from the view.
 *
 * A column's value comes from the server's read-time merge: each scalar
 * sequence's LAST point, with an explicit `run.summary()` key of the same name
 * replacing it. Nothing here re-derives that; it only decides which columns
 * exist and how they sort.
 */

import type { Run } from "../api/types";

export type ValueColumn = `value:${string}`;

/** True for a metric column id. A guard, not a predicate: the caller's switch
 *  over the built-in columns keeps its exhaustiveness check only if the
 *  template-literal member is narrowed away, which `startsWith` alone will not
 *  do. */
export function isValueColumn(col: string): col is ValueColumn {
  return col.startsWith("value:");
}

/** The metric key a column id refers to. */
export function valueColumnKey(col: ValueColumn): string {
  return col.slice("value:".length);
}

/**
 * The UNION of value keys across the given runs, sorted by name.
 *
 * Union rather than intersection: a run that crashed before logging `val.acc`
 * should show a blank cell, not delete the column for every other run.
 */
export function valueColumnsOf(runs: readonly Run[]): string[] {
  const keys = new Set<string>();
  for (const r of runs) {
    for (const k of Object.keys(r.values ?? {})) keys.add(k);
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * Compare two runs on one metric column, ALREADY accounting for direction.
 *
 * Direction lives here because missing values must sort last in BOTH
 * directions, and the caller's usual `dir === "asc" ? cmp : -cmp` would flip
 * them to the top on a descending sort. Sorting by a metric asks "which runs
 * scored best on this"; a run that never logged it has no answer, and burying
 * the runs that do have one under a block of blanks is the opposite of what
 * the click meant.
 *
 * Two missing values return 0 so the caller's stable id tiebreaker decides.
 */
export function compareValuesDirected(
  a: Run,
  b: Run,
  key: string,
  direction: "asc" | "desc",
): number {
  const av = a.values?.[key];
  const bv = b.values?.[key];
  const aMissing = av == null;
  const bMissing = bv == null;
  if (aMissing || bMissing) return aMissing && bMissing ? 0 : aMissing ? 1 : -1;
  const cmp =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv));
  return direction === "asc" ? cmp : -cmp;
}
