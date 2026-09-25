/**
 * Combining logged tables: stack them (`concatTables`) or join two on key
 * columns (`joinTables`, pandas `merge` semantics). Pure; media cells pass
 * through untouched.
 */

import { detectKeyColumn } from "../table-diff.ts";
import { cellText, type ColumnType, type TableColumn, type TableData } from "./types.ts";

export type JoinHow = "inner" | "left" | "outer";

export interface JoinOptions {
  /**
   * Key column(s), present in both tables. Default: the shared id-like first
   * column (`detectKeyColumn`), else rows are joined by position.
   */
  on?: string | string[];
  how?: JoinHow;
  /** Appended to non-key columns present in both tables. Default `["_1", "_2"]`. */
  suffixes?: [string, string];
}

export interface ConcatOptions {
  /** One label per table, written to a leading column (see `sourceColumn`). No labels, no column. */
  labels?: string[];
  /** Name of the label column. Default "source". */
  sourceColumn?: string;
}

function mergeType(a: ColumnType | undefined, b: ColumnType): ColumnType {
  return a === undefined || a === b ? b : "other";
}

/** A name not in `taken`: `name`, else `name` with `suffix` repeated until free. */
function freeName(name: string, taken: Set<string>, suffix = "_"): string {
  let out = name;
  while (taken.has(out)) out += suffix;
  return out;
}

/**
 * Stack tables row-wise. Columns are unioned by name in first-seen order; a
 * table without a column gets null there. With `labels`, a leading column
 * says which table each row came from.
 */
export function concatTables(tables: readonly TableData[], opts: ConcatOptions = {}): TableData {
  const names: string[] = [];
  const types = new Map<string, ColumnType>();
  for (const t of tables) {
    for (const c of t.columns) {
      if (!types.has(c.name)) names.push(c.name);
      types.set(c.name, mergeType(types.get(c.name), c.type));
    }
  }
  const labelled = opts.labels !== undefined;
  const source = labelled ? freeName(opts.sourceColumn ?? "source", new Set(names)) : "";
  const columns: TableColumn[] = [
    ...(labelled ? [{ name: source, type: "string" as ColumnType }] : []),
    ...names.map((name) => ({ name, type: types.get(name)! })),
  ];
  const data: unknown[][] = [];
  tables.forEach((t, ti) => {
    const idx = names.map((n) => t.columns.findIndex((c) => c.name === n));
    for (const row of t.data) {
      const cells = idx.map((i) => (i < 0 ? null : (row[i] ?? null)));
      data.push(labelled ? [opts.labels![ti] ?? null, ...cells] : cells);
    }
  });
  return { columns, data, truncated: tables.some((t) => t.truncated) || undefined };
}

/** The join identity of a key tuple; null when any part is null (never matches). */
function keyToken(values: unknown[]): string | null {
  const parts: string[] = [];
  for (const v of values) {
    if (v === null || v === undefined) return null;
    parts.push(`${typeof v}:${cellText(v)}`);
  }
  return parts.join("\u0000");
}

/** The default join key: the shared id-like first column, or null (join by position). */
export function defaultJoinKey(l: TableData, r: TableData): string | null {
  return detectKeyColumn([l, r]) === null ? null : l.columns[0]!.name;
}

/**
 * Join two tables on key columns, like pandas `merge`:
 * - `inner`: rows whose keys match; `left`: every left row; `outer`: every
 *   row of both. Unmatched sides are null.
 * - Duplicate keys give every matching pair (left order, then right order);
 *   right-only rows (outer) follow at the end in their own order.
 * - A null key never matches.
 * - Key columns appear once, first (for right-only rows they come from the
 *   right table); other columns in both tables get `suffixes`.
 * - With no key at all, rows are joined by position.
 * Throws when a key column is missing from either table.
 */
export function joinTables(l: TableData, r: TableData, opts: JoinOptions = {}): TableData {
  const how = opts.how ?? "inner";
  const [sl, sr] = opts.suffixes ?? ["_1", "_2"];
  const onOpt = opts.on ?? defaultJoinKey(l, r);
  const on = onOpt === null ? [] : Array.isArray(onOpt) ? onOpt : [onOpt];

  const find = (t: TableData, name: string) => t.columns.findIndex((c) => c.name === name);
  const missing = on.flatMap((k) => [
    ...(find(l, k) < 0 ? [`left table has no column '${k}'`] : []),
    ...(find(r, k) < 0 ? [`right table has no column '${k}'`] : []),
  ]);
  if (missing.length > 0) throw new Error(missing.join("; "));

  const lKey = on.map((k) => find(l, k));
  const rKey = on.map((k) => find(r, k));
  const keyOf = (row: unknown[], idx: number[], rowIdx: number) =>
    idx.length === 0 ? `#${rowIdx}` : keyToken(idx.map((i) => row[i]));

  // Non-key columns of each side, suffixed where both have the name.
  const keySet = new Set(on);
  const lRest = l.columns.map((c, i) => ({ c, i })).filter(({ c }) => !keySet.has(c.name));
  const rRest = r.columns.map((c, i) => ({ c, i })).filter(({ c }) => !keySet.has(c.name));
  const lNames = new Set(lRest.map((x) => x.c.name));
  const rNames = new Set(rRest.map((x) => x.c.name));
  const taken = new Set<string>(on);
  const outName = (name: string, clash: boolean, suffix: string) => {
    const n = freeName(clash ? `${name}${suffix}` : name, taken, suffix);
    taken.add(n);
    return n;
  };
  const lCols = lRest.map(({ c }) => ({ name: outName(c.name, rNames.has(c.name), sl), type: c.type }));
  const rCols = rRest.map(({ c }) => ({ name: outName(c.name, lNames.has(c.name), sr), type: c.type }));
  const columns: TableColumn[] = [
    ...on.map((k, j) => ({ name: k, type: mergeType(l.columns[lKey[j]!]!.type, r.columns[rKey[j]!]!.type) })),
    ...lCols,
    ...rCols,
  ];

  const rByKey = new Map<string, number[]>();
  r.data.forEach((row, ri) => {
    const k = keyOf(row, rKey, ri);
    if (k === null) return;
    let list = rByKey.get(k);
    if (!list) rByKey.set(k, (list = []));
    list.push(ri);
  });

  const nulls = (n: number) => Array.from({ length: n }, () => null);
  const data: unknown[][] = [];
  const rMatched = new Set<number>();
  l.data.forEach((lRow, li) => {
    const k = keyOf(lRow, lKey, li);
    const matches = k === null ? undefined : rByKey.get(k);
    const lPart = [...lKey.map((i) => lRow[i] ?? null), ...lRest.map(({ i }) => lRow[i] ?? null)];
    if (matches && matches.length > 0) {
      for (const ri of matches) {
        rMatched.add(ri);
        const rRow = r.data[ri]!;
        data.push([...lPart, ...rRest.map(({ i }) => rRow[i] ?? null)]);
      }
    } else if (how !== "inner") {
      data.push([...lPart, ...nulls(rRest.length)]);
    }
  });
  if (how === "outer") {
    r.data.forEach((rRow, ri) => {
      if (rMatched.has(ri)) return;
      data.push([
        ...rKey.map((i) => rRow[i] ?? null),
        ...nulls(lRest.length),
        ...rRest.map(({ i }) => rRow[i] ?? null),
      ]);
    });
  }
  return { columns, data, truncated: l.truncated || r.truncated || undefined };
}

/**
 * Pairs of joined columns to text-diff: for each column `x<sr>` whose left
 * twin `x<sl>` exists, `[leftIndex, rightIndex]`.
 */
export function suffixedPairs(table: TableData, suffixes: [string, string] = ["_1", "_2"]): Array<[number, number]> {
  const [sl, sr] = suffixes;
  const out: Array<[number, number]> = [];
  table.columns.forEach((c, ri) => {
    if (!c.name.endsWith(sr)) return;
    const base = c.name.slice(0, c.name.length - sr.length);
    const li = table.columns.findIndex((x) => x.name === `${base}${sl}`);
    if (li >= 0) out.push([li, ri]);
  });
  return out;
}
