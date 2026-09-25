/**
 * The runs table's columns: which exist, which are pinned, hidden or moved,
 * and the computed expression columns.
 *
 * A column id is a built-in (`name`, `status`, `created_at`, `duration`,
 * `tags`), a metric (`value:<key>`, the server's last point or summary
 * value), a config param (`param:<key>`) or a computed column
 * (`computed:<id>`). `name` is always frozen on the left and can't be
 * hidden; pinned columns join the frozen block after it, in pin order.
 */

import type { Run } from "../../api/types.ts";
import { check, evaluate, ExprError, parse, type Node } from "../expr/index.ts";
import { runContextOf, parseTags } from "./context.ts";

export const BUILTIN_COLUMNS = ["name", "status", "created_at", "duration", "tags"] as const;
export type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number];

/** Which way is better for a column's values (deltas against the baseline). */
export type Better = "lower" | "higher";

export interface ComputedColumn {
  /** Stable id; the column id is `computed:<id>`. */
  id: string;
  /** Header label; defaults to the expression. */
  name?: string;
  /** A scalar expression (lib/expr), e.g. `min(val.loss)`. */
  expr: string;
  better?: Better;
}

export interface ColumnsState {
  /** Explicit order of the scrolling columns; ids not listed follow in their natural order. */
  order: string[];
  hidden: string[];
  /** Pinned column ids, in pin order (they freeze after Name). */
  pinned: string[];
  /** Per-column "better" override, beating the metric's summary rule. */
  better: Record<string, Better>;
}

export const EMPTY_COLUMNS: ColumnsState = { order: [], hidden: [], pinned: [], better: {} };

export const valueColumn = (key: string) => `value:${key}`;
export const paramColumn = (key: string) => `param:${key}`;
export const computedColumn = (id: string) => `computed:${id}`;

export function isBuiltinColumn(col: string): col is BuiltinColumn {
  return (BUILTIN_COLUMNS as readonly string[]).includes(col);
}

/** `{kind, key}` of a column id; builtins have kind "builtin". */
export function columnKind(col: string): { kind: "builtin" | "value" | "param" | "computed"; key: string } {
  for (const kind of ["value", "param", "computed"] as const) {
    if (col.startsWith(`${kind}:`)) return { kind, key: col.slice(kind.length + 1) };
  }
  return { kind: "builtin", key: col };
}

/**
 * Every column the loaded runs offer, in natural order: built-ins, metrics
 * (union across runs, sorted), params (union, sorted), then computed columns
 * in the order they were added.
 */
export function availableColumns(runs: readonly Run[], computed: readonly ComputedColumn[]): string[] {
  const values = new Set<string>();
  const params = new Set<string>();
  for (const r of runs) {
    for (const k of Object.keys(r.values ?? {})) values.add(k);
    for (const k of Object.keys(r.params ?? {})) params.add(k);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return [
    ...BUILTIN_COLUMNS,
    ...sorted(values).map(valueColumn),
    ...sorted(params).map(paramColumn),
    ...computed.map((c) => computedColumn(c.id)),
  ];
}

export interface ColumnLayout {
  /** Frozen on the left: `name`, then the pinned columns in pin order. */
  frozen: string[];
  /** The horizontally scrolling columns. */
  scroll: string[];
}

/** Arrange the available columns by the state: hidden dropped, pinned frozen, the rest ordered. */
export function layoutColumns(available: readonly string[], state: ColumnsState): ColumnLayout {
  const avail = new Set(available);
  const hidden = new Set(state.hidden);
  hidden.delete("name");
  const pinned = state.pinned.filter((c) => avail.has(c) && !hidden.has(c) && c !== "name");
  const pinnedSet = new Set(pinned);
  const rank = new Map<string, number>();
  state.order.forEach((c, i) => rank.set(c, i));
  const natural = new Map<string, number>();
  available.forEach((c, i) => natural.set(c, i));
  // Columns in `order` keep their slot; a new column sits right after the
  // ordered column that precedes it naturally, so it appears near its kin.
  const rest = available.filter((c) => c !== "name" && !hidden.has(c) && !pinnedSet.has(c));
  const ordered = rest.filter((c) => rank.has(c)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  const out = [...ordered];
  for (const c of rest) {
    if (rank.has(c)) continue;
    const n = natural.get(c)!;
    // Insert right after its natural predecessor among the placed columns.
    let at = 0;
    let best = -1;
    for (let i = 0; i < out.length; i++) {
      const m = natural.get(out[i]!)!;
      if (m < n && m > best) {
        best = m;
        at = i + 1;
      }
    }
    out.splice(at, 0, c);
  }
  return { frozen: ["name", ...pinned], scroll: out };
}

export function togglePinned(state: ColumnsState, col: string): ColumnsState {
  if (col === "name") return state;
  const pinned = state.pinned.includes(col) ? state.pinned.filter((c) => c !== col) : [...state.pinned, col];
  return { ...state, pinned, hidden: state.hidden.filter((c) => c !== col) };
}

export function setHidden(state: ColumnsState, col: string, hidden: boolean): ColumnsState {
  if (col === "name") return state;
  const rest = state.hidden.filter((c) => c !== col);
  return {
    ...state,
    hidden: hidden ? [...rest, col] : rest,
    pinned: hidden ? state.pinned.filter((c) => c !== col) : state.pinned,
  };
}

/**
 * Move `col` to sit just before `before` (or last when null) among the
 * given on-screen scrolling columns, persisting the whole visible order.
 * Pinned columns reorder within the pin list instead.
 */
export function moveColumn(state: ColumnsState, visible: readonly string[], col: string, before: string | null): ColumnsState {
  if (col === before) return state;
  if (state.pinned.includes(col)) {
    const pinned = state.pinned.filter((c) => c !== col);
    const at = before !== null && pinned.includes(before) ? pinned.indexOf(before) : pinned.length;
    pinned.splice(at, 0, col);
    return { ...state, pinned };
  }
  const order = visible.filter((c) => c !== col);
  const at = before !== null && order.includes(before) ? order.indexOf(before) : order.length;
  order.splice(at, 0, col);
  // Keep ordered-but-now-hidden columns' slots at the end so they return near where they were.
  const keep = state.order.filter((c) => !order.includes(c) && c !== col);
  return { ...state, order: [...order, ...keep] };
}

export function setBetter(state: ColumnsState, col: string, better: Better | null): ColumnsState {
  const next = { ...state.better };
  if (better) next[col] = better;
  else delete next[col];
  return { ...state, better: next };
}

// ---------------------------------------------------------------------------
// Computed columns
// ---------------------------------------------------------------------------

export interface CompiledExpr {
  node: Node | null;
  /** Parse or type error, or "not a scalar". */
  error: string | null;
}

const compiledCache = new Map<string, CompiledExpr>();

/** Parse + check a scalar expression (cached by source). */
export function compileScalarExpr(src: string): CompiledExpr {
  const hit = compiledCache.get(src);
  if (hit) return hit;
  let out: CompiledExpr;
  try {
    const node = parse(src);
    const t = check(node);
    out = t.shape === "scalar"
      ? { node, error: null }
      : { node: null, error: "a series, not a single value: wrap it in a reducer such as last(…) or min(…)" };
  } catch (e) {
    out = { node: null, error: e instanceof ExprError ? e.message : String(e) };
  }
  if (compiledCache.size > 500) compiledCache.clear();
  compiledCache.set(src, out);
  return out;
}

/** A scalar expression's value for one run; null on error or missing data. */
export function evalScalar(node: Node, run: Run): unknown {
  try {
    const r = evaluate(node, runContextOf(run));
    return r.value.kind === "scalar" ? r.value.value : null;
  } catch {
    return null;
  }
}

/** `computedId → value` for each run (only for valid expressions). */
export function computeColumns(runs: readonly Run[], computed: readonly ComputedColumn[]): Map<string, Record<string, unknown>> {
  const nodes = computed
    .map((c) => ({ id: c.id, node: compileScalarExpr(c.expr).node }))
    .filter((c): c is { id: string; node: Node } => c.node !== null);
  const out = new Map<string, Record<string, unknown>>();
  for (const r of runs) {
    const row: Record<string, unknown> = {};
    for (const c of nodes) row[c.id] = evalScalar(c.node, r);
    out.set(r.id, row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------

export function durationMs(run: Run, now: number = Date.now()): number {
  const start = new Date(run.created_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : now;
  return Math.max(0, end - start);
}

/**
 * A run's value in a column, as sorted, grouped and compared (null when
 * missing). `computed` holds the rows of `computeColumns`.
 */
export function cellValue(run: Run, col: string, computed?: Map<string, Record<string, unknown>>): unknown {
  const { kind, key } = columnKind(col);
  switch (kind) {
    case "value":
      return run.values?.[key] ?? null;
    case "param":
      return run.params?.[key] ?? null;
    case "computed":
      return computed?.get(run.id)?.[key] ?? null;
  }
  switch (key as BuiltinColumn) {
    case "name":
      return run.display_name ?? run.id;
    case "status":
      return run.status;
    case "created_at": {
      const t = new Date(run.created_at).getTime();
      return Number.isFinite(t) ? t : null;
    }
    case "duration":
      return durationMs(run);
    case "tags":
      return parseTags(run.tags);
  }
  return null;
}

/** Header label for a column. */
export function columnLabel(col: string, computed: readonly ComputedColumn[]): string {
  const { kind, key } = columnKind(col);
  if (kind === "computed") {
    const c = computed.find((x) => x.id === key);
    return c ? (c.name || c.expr) : key;
  }
  if (kind === "builtin") {
    return { name: "Name", status: "Status", created_at: "Created", duration: "Duration", tags: "Tags" }[key as BuiltinColumn] ?? key;
  }
  return key;
}

/** True for columns whose values are numeric-ish (right-aligned, mono). */
export function isNumericColumn(col: string): boolean {
  const { kind, key } = columnKind(col);
  return kind !== "builtin" || key === "duration";
}
