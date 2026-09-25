/**
 * Grouping runs by a value (a param, `run.group`, any scalar expression) and
 * summarising each group's values: the data behind the bar card's grouped
 * bar / box / violin / strip plots. Pure; tested in `grouping.test.ts`.
 */

export interface Group<T> {
  /** Stable identity of the group's value (JSON of it); "null" for a missing value. */
  key: string;
  /** The value as shown ("(none)" when missing). */
  label: string;
  value: unknown;
  items: T[];
}

export const NO_GROUP_LABEL = "(none)";

function groupLabel(v: unknown): string {
  if (v === null || v === undefined) return NO_GROUP_LABEL;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Order of group values: numbers ascending, then bools, then strings/other by label; missing last. */
function compareValues(a: Group<unknown>, b: Group<unknown>): number {
  const rank = (v: unknown) =>
    v === null || v === undefined ? 3 : typeof v === "number" ? 0 : typeof v === "boolean" ? 1 : 2;
  const ra = rank(a.value);
  const rb = rank(b.value);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a.value as number) - (b.value as number);
  return a.label.localeCompare(b.label, undefined, { numeric: true });
}

/**
 * Split `items` into groups by `keyOf(item)`, in value order (numbers
 * ascending, then booleans, then text; items with no value last in a
 * "(none)" group). Items keep their order within a group.
 */
export function groupRuns<T>(items: readonly T[], keyOf: (item: T) => unknown): Group<T>[] {
  const byKey = new Map<string, Group<T>>();
  for (const item of items) {
    let v = keyOf(item);
    if (v === undefined) v = null;
    const key = JSON.stringify(v) ?? "null";
    let g = byKey.get(key);
    if (!g) byKey.set(key, (g = { key, label: groupLabel(v), value: v, items: [] }));
    g.items.push(item);
  }
  return [...byKey.values()].sort(compareValues);
}

/**
 * Quantiles of `values` by linear interpolation between order statistics
 * (NumPy's default "linear" method). Non-finite values are ignored; an
 * empty input gives NaN for every q.
 */
export function quantiles(values: readonly number[], qs: readonly number[]): number[] {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return qs.map((q) => {
    if (xs.length === 0) return NaN;
    const pos = Math.min(Math.max(q, 0), 1) * (xs.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return xs[lo]! + (xs[hi]! - xs[lo]!) * (pos - lo);
  });
}

export interface Summary {
  n: number;
  mean: number;
  std: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** Count, mean, sample std (0 for one value) and five-number summary of the finite values. */
export function summarize(values: readonly number[]): Summary {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  const mean = n ? xs.reduce((a, b) => a + b, 0) / n : NaN;
  const std = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : n === 1 ? 0 : NaN;
  const [min, q1, median, q3, max] = quantiles(xs, [0, 0.25, 0.5, 0.75, 1]) as [number, number, number, number, number];
  return { n, mean, std, min, q1, median, q3, max };
}
