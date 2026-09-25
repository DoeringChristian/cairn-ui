/**
 * Table operations: derived columns, a row query and group-by with
 * aggregates, applied in that order to one logged table. Pure.
 *
 * ## Column names in expressions
 * Expressions are the `lib/expr` language evaluated once per row, with the
 * row standing in for the run. A column is named
 * - bare: `score`, `a.b` (dots are part of the name), or quoted when it is
 *   not a plain identifier or clashes with a keyword: `` `pred/label` ``;
 * - or explicitly as `config.<col>` (so `config.score` is `score`).
 * The reserved roots read columns of that literal name: `step`,
 * `wall_time`, `relative_time` read the column `step` (…), `summary.x` the
 * column `summary.x`, `run.name` the column `run.name`.
 *
 * This works by rewriting the parsed tree before evaluation: every metric
 * (a bare name) and axis root becomes a `config` lookup, so each column is a
 * scalar and the whole expression is a scalar per row (reducers such as
 * `max(x)` are the identity on a scalar; pointwise `max(a, b)` works).
 * Values keep their JSON types: numbers, strings, bools, null; a media cell
 * is an object, which arithmetic treats as null.
 */

import { ExprError, deps, evaluate, matches, parse, type Node } from "../expr/index.ts";
import { didYouMean } from "../expr/ast.ts";
import type { RunContext } from "../expr/index.ts";
import { cellText, inferColumnType, type ColumnType, type TableColumn, type TableData } from "./types.ts";

export interface DerivedColumn {
  name: string;
  expr: string;
}

export const AGG_FNS = ["count", "sum", "mean", "min", "max", "first", "nunique"] as const;
export type AggFn = (typeof AGG_FNS)[number];

export interface TableAgg {
  /** Source column; `count` also takes "" (or "*") for the number of rows. Others without one are skipped. */
  column: string;
  fn: AggFn;
}

export interface TableGroupBy {
  /** Key columns; none = one group of every row. */
  keys: string[];
  aggs: TableAgg[];
}

export interface TableOps {
  derived?: DerivedColumn[];
  /** A boolean expression; rows where it is not truthy are dropped. Empty = every row. */
  query?: string;
  groupBy?: TableGroupBy | null;
}

export interface TableOpsResult {
  table: TableData;
  /** One entry per `ops.derived` (null when it evaluated); a failed column is left out. */
  derivedErrors: Array<string | null>;
  /** The query's parse/type error; the query is then not applied. */
  queryError: string | null;
  /** An unknown group-by column; group-by is then not applied. */
  groupByError: string | null;
  /** Rows left after the query (before group-by). */
  queriedRows: number;
}

/** The output column name of an aggregate. */
export function aggColumnName(agg: TableAgg): string {
  const col = agg.column === "*" ? "" : agg.column;
  return col ? `${agg.fn}(${col})` : agg.fn;
}

/** Rewrite metric names and axis roots into column (`config`) lookups. */
function bindColumns(node: Node): Node {
  switch (node.type) {
    case "metric":
      return { type: "config", key: node.name, span: node.span };
    case "axis":
      return { type: "config", key: node.axis, span: node.span };
    case "list":
      return { ...node, items: node.items.map(bindColumns) };
    case "unary":
      return { ...node, operand: bindColumns(node.operand) };
    case "binary":
      return { ...node, left: bindColumns(node.left), right: bindColumns(node.right) };
    case "compare":
      return { ...node, operands: node.operands.map(bindColumns) };
    case "call":
      return { ...node, args: node.args.map(bindColumns) };
    default:
      return node;
  }
}

/**
 * Parse an expression over table columns (see the module doc). Throws
 * `ExprError`, also for a column `columns` does not have.
 */
export function parseRowExpr(src: string, columns?: readonly TableColumn[]): Node {
  const node = bindColumns(parse(src));
  if (columns) {
    const names = columns.map((c) => c.name);
    const known = new Set(names);
    const d = deps(node);
    const used = [...d.config, ...d.summary.map((k) => `summary.${k}`), ...d.run.map((f) => `run.${f}`)];
    const unknown = used.find((n) => !known.has(n));
    if (unknown !== undefined) {
      throw new ExprError(`unknown column '${unknown}'${didYouMean(unknown, names)}`, node.span);
    }
  }
  return node;
}

/** The expression context of one row: columns by name. */
const INDEX_CACHE = new WeakMap<readonly TableColumn[], Map<string, number>>();

function columnIndex(columns: readonly TableColumn[]): Map<string, number> {
  let index = INDEX_CACHE.get(columns);
  if (!index) {
    index = new Map();
    for (let i = 0; i < columns.length; i++) if (!index.has(columns[i]!.name)) index.set(columns[i]!.name, i);
    INDEX_CACHE.set(columns, index);
  }
  return index;
}

export function rowContext(columns: readonly TableColumn[], row: readonly unknown[]): RunContext {
  const index = columnIndex(columns);
  const col = (name: string) => {
    const i = index.get(name);
    return i === undefined ? null : row[i];
  };
  return {
    series: () => null,
    config: (key) => col(key),
    summary: (key) => col(`summary.${key}`),
    run: (field) => col(`run.${field}`),
  };
}

function errorText(e: unknown): string {
  return e instanceof ExprError || e instanceof Error ? e.message : String(e);
}

/** A derived cell: the scalar value, or null (a series cannot happen after `bindColumns`). */
function scalarOf(value: ReturnType<typeof evaluate>["value"]): unknown {
  return value.kind === "scalar" ? value.value : null;
}

function addDerived(table: TableData, derived: readonly DerivedColumn[], errors: Array<string | null>): TableData {
  let columns = table.columns;
  let rows = table.data;
  for (const d of derived) {
    const name = d.name.trim();
    if (!name || !d.expr.trim()) {
      errors.push(!name ? "name the column" : "enter an expression");
      continue;
    }
    let node: Node;
    try {
      node = parseRowExpr(d.expr, columns);
    } catch (e) {
      errors.push(errorText(e));
      continue;
    }
    let values: unknown[];
    try {
      values = rows.map((row) => scalarOf(evaluate(node, rowContext(columns, row)).value));
    } catch (e) {
      errors.push(errorText(e));
      continue;
    }
    errors.push(null);
    // A derived column named like an existing one replaces it in place.
    const existing = columns.findIndex((c) => c.name === name);
    const col: TableColumn = { name, type: inferColumnType(values) };
    if (existing >= 0) {
      columns = columns.map((c, i) => (i === existing ? col : c));
      rows = rows.map((row, r) => row.map((v, i) => (i === existing ? values[r] : v)));
    } else {
      columns = [...columns, col];
      rows = rows.map((row, r) => [...row, values[r]]);
    }
  }
  return { ...table, columns, data: rows };
}

function applyQuery(table: TableData, query: string): { table: TableData; error: string | null } {
  let node: Node;
  try {
    node = parseRowExpr(query, table.columns);
  } catch (e) {
    return { table, error: errorText(e) };
  }
  try {
    const data = table.data.filter((row) => matches(evaluate(node, rowContext(table.columns, row))));
    return { table: { ...table, data }, error: null };
  } catch (e) {
    return { table, error: errorText(e) };
  }
}

/** Grouping identity of a cell: its type plus its text (so 1 and "1" differ). */
function groupToken(v: unknown): string {
  if (v === null || v === undefined) return "n:";
  return `${typeof v}:${cellText(v)}`;
}

function aggregate(fn: AggFn, values: unknown[]): unknown {
  const present = values.filter((v) => v !== null && v !== undefined);
  switch (fn) {
    case "count":
      return present.length;
    case "nunique":
      return new Set(present.map(groupToken)).size;
    case "first":
      return present[0] ?? null;
    case "sum":
    case "mean": {
      const nums = present.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
      if (nums.length === 0) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      return fn === "sum" ? sum : sum / nums.length;
    }
    case "min":
    case "max": {
      const nums = present.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
      if (nums.length > 0) return fn === "min" ? Math.min(...nums) : Math.max(...nums);
      const strs = present.filter((v): v is string => typeof v === "string");
      if (strs.length === 0) return null;
      return strs.reduce((a, b) => ((fn === "min" ? b < a : b > a) ? b : a));
    }
  }
}

function aggType(fn: AggFn, source: TableColumn | undefined, values: unknown[]): ColumnType {
  if (fn === "count" || fn === "nunique" || fn === "sum" || fn === "mean") return "number";
  if (fn === "first" && source) return source.type;
  return inferColumnType(values);
}

function applyGroupBy(table: TableData, spec: TableGroupBy): { table: TableData; error: string | null } {
  // An aggregate still being set up (no column yet) is left out.
  const groupBy = { ...spec, aggs: spec.aggs.filter((a) => a.fn === "count" || (a.column !== "" && a.column !== "*")) };
  const colIndex = (name: string) => table.columns.findIndex((c) => c.name === name);
  const keyIdx = groupBy.keys.map(colIndex);
  const missing = groupBy.keys.filter((_, i) => keyIdx[i]! < 0);
  const aggIdx = groupBy.aggs.map((a) => (a.fn === "count" && (a.column === "" || a.column === "*") ? -1 : colIndex(a.column)));
  const missingAgg = groupBy.aggs.filter((a, i) => aggIdx[i]! < 0 && !(a.fn === "count" && (a.column === "" || a.column === "*")));
  const unknown = [...missing, ...missingAgg.map((a) => a.column)];
  if (unknown.length > 0) {
    return { table, error: `unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` };
  }

  // Groups in order of first appearance.
  const groups = new Map<string, number[]>();
  table.data.forEach((row, r) => {
    const token = keyIdx.map((i) => groupToken(row[i])).join("\u0000");
    let g = groups.get(token);
    if (!g) groups.set(token, (g = []));
    g.push(r);
  });
  if (table.data.length === 0 && keyIdx.length === 0) groups.set("", []);

  const outRows: unknown[][] = [];
  const aggValues: unknown[][] = groupBy.aggs.map(() => []);
  for (const members of groups.values()) {
    const first = table.data[members[0]!];
    const keys = keyIdx.map((i) => (first ? first[i] : null));
    const aggs = groupBy.aggs.map((a, j) => {
      const i = aggIdx[j]!;
      const values = i < 0 ? members.map(() => 1) : members.map((r) => table.data[r]![i]);
      const v = aggregate(a.fn, values);
      aggValues[j]!.push(v);
      return v;
    });
    outRows.push([...keys, ...aggs]);
  }
  const columns: TableColumn[] = [
    ...keyIdx.map((i) => table.columns[i]!),
    ...groupBy.aggs.map((a, j) => ({
      name: aggColumnName(a),
      type: aggType(a.fn, aggIdx[j]! >= 0 ? table.columns[aggIdx[j]!] : undefined, aggValues[j]!),
    })),
  ];
  return { table: { ...table, columns, data: outRows }, error: null };
}

/**
 * Apply `ops` to `table`: derived columns (each may use the ones before it),
 * then the query (which may use derived columns), then group-by. An
 * operation with an error is skipped and reported; the rest still apply.
 * Rows are never mutated; media cells pass through untouched.
 */
export function applyTableOps(table: TableData, ops: TableOps | null | undefined): TableOpsResult {
  const derivedErrors: Array<string | null> = [];
  let out = table;
  if (ops?.derived?.length) out = addDerived(out, ops.derived, derivedErrors);
  let queryError: string | null = null;
  if (ops?.query?.trim()) {
    const q = applyQuery(out, ops.query);
    out = q.table;
    queryError = q.error;
  }
  const queriedRows = out.data.length;
  let groupByError: string | null = null;
  const gb = ops?.groupBy;
  if (gb && (gb.keys.length > 0 || gb.aggs.length > 0)) {
    const g = applyGroupBy(out, gb);
    out = g.table;
    groupByError = g.error;
  }
  return { table: out, derivedErrors, queryError, groupByError, queriedRows };
}

/** Whether `ops` changes anything (for skipping the pipeline). */
export function hasTableOps(ops: TableOps | null | undefined): boolean {
  return !!(
    ops &&
    (ops.derived?.length ||
      ops.query?.trim() ||
      (ops.groupBy && (ops.groupBy.keys.length > 0 || ops.groupBy.aggs.length > 0)))
  );
}
