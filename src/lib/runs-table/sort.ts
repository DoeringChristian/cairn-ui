/**
 * Multi-key sort for the runs table. A click sorts by one column (a second
 * click flips it); a shift-click adds the column as the next key (or flips
 * it when it is already a key). Missing values sort last in BOTH directions:
 * sorting by a metric asks "which runs scored best", and a run that never
 * logged it has no answer. The run id breaks ties, so the order is stable.
 */

export type SortDirection = "asc" | "desc";

export interface SortKey {
  column: string;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortKey[] = [{ column: "created_at", direction: "desc" }];

/** The direction a column starts in: newest first for Created, else ascending. */
export function initialDirection(column: string): SortDirection {
  return column === "created_at" ? "desc" : "asc";
}

const flip = (d: SortDirection): SortDirection => (d === "asc" ? "desc" : "asc");

/** The sort after clicking `column` (`additive` = shift held). */
export function toggleSort(sort: readonly SortKey[], column: string, additive: boolean): SortKey[] {
  const i = sort.findIndex((k) => k.column === column);
  if (additive) {
    if (i >= 0) return sort.map((k, j) => (j === i ? { ...k, direction: flip(k.direction) } : k));
    return [...sort, { column, direction: initialDirection(column) }];
  }
  if (sort.length === 1 && i === 0) return [{ column, direction: flip(sort[0]!.direction) }];
  return [{ column, direction: i >= 0 ? sort[i]!.direction : initialDirection(column) }];
}

/** Remove one key (a column that no longer exists, or the user's ×). */
export function removeSortKey(sort: readonly SortKey[], column: string): SortKey[] {
  return sort.filter((k) => k.column !== column);
}

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}

/** Ascending comparison of two present values: numbers (bools as 0/1) numerically, else as text. */
export function compareValues(a: unknown, b: unknown): number {
  const na = typeof a === "boolean" ? Number(a) : a;
  const nb = typeof b === "boolean" ? Number(b) : b;
  if (typeof na === "number" && typeof nb === "number") return na < nb ? -1 : na > nb ? 1 : 0;
  // Numbers before text in a mixed column.
  if (typeof na === "number") return -1;
  if (typeof nb === "number") return 1;
  const sa = typeof na === "string" ? na : JSON.stringify(na);
  const sb = typeof nb === "string" ? nb : JSON.stringify(nb);
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Sort `items` by the keys; `valueOf(item, column)` supplies each cell and
 * `idOf` the stable tiebreaker. Returns a new array.
 */
export function sortBy<T>(
  items: readonly T[],
  sort: readonly SortKey[],
  valueOf: (item: T, column: string) => unknown,
  idOf: (item: T) => string,
): T[] {
  // Precompute each key's values once.
  const rows = items.map((item) => ({ item, id: idOf(item), vals: sort.map((k) => valueOf(item, k.column)) }));
  rows.sort((x, y) => {
    for (let i = 0; i < sort.length; i++) {
      const a = x.vals[i];
      const b = y.vals[i];
      const am = isMissing(a);
      const bm = isMissing(b);
      if (am || bm) {
        if (am && bm) continue;
        return am ? 1 : -1;
      }
      const c = compareValues(a, b);
      if (c !== 0) return sort[i]!.direction === "asc" ? c : -c;
    }
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return rows.map((r) => r.item);
}
