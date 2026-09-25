/**
 * The runs table's filter: a tree of and/or groups over builder chips
 * (field/operator/argument predicates) and expression leaves (lib/expr),
 * evaluated client-side over the loaded runs. Also the table's persisted
 * state (`RunsFilterState` v2).
 *
 * The operators are a TS port of the server's authoritative comparators
 * (cairn `cairn/server/_operators.py`), with Python's semantics: `==` that
 * treats `True == 1`, lexicographic list ordering, `in` on strings meaning
 * substring, and a comparison Python would reject (`"a" > 1`) counting as
 * "no match", exactly like the server's `except (TypeError, ValueError)`.
 * `docs/schemas/filter-vectors.json` pins both sides to the same cases.
 *
 * A typed argument is coerced like a URL query value on the server
 * (`query_resolver._coerce`): true/false, then int, then float, else the
 * string; `in` splits on commas first.
 */

import type { Run } from "../api/types.ts";
import { loadJson, saveJson, storageKeys } from "./storage.ts";
// lib/expr imports this module's Python semantics back (a cycle): nothing
// below may use these imports at module top level, only inside functions.
import { evaluate as evaluate_, matches } from "./expr/index.ts";
import { clampColumnWidth, compileScalarExpr, type Better, type ColumnsState, type ComputedColumn } from "./runs-table/columns.ts";
import { parseTags, runContextOf } from "./runs-table/context.ts";
import { isGroupBy, type GroupBy } from "./runs-table/group.ts";
import { DEFAULT_SORT, type SortKey } from "./runs-table/sort.ts";

export const OPERATORS = [
  "exact",
  "iexact",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "icontains",
  "startswith",
  "endswith",
  "isnull",
] as const;
export type Operator = (typeof OPERATORS)[number];

export function isOperator(s: unknown): s is Operator {
  return typeof s === "string" && (OPERATORS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Python value semantics
// ---------------------------------------------------------------------------

/** What Python raises for an unsupported operand; evaluate() maps it to false. */
export class PyTypeError extends Error {}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number | boolean {
  return typeof v === "number" || typeof v === "boolean";
}

/** Python `a == b` over JSON values (bool is an int: `True == 1`). */
export function pyEq(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (isNum(a) && isNum(b)) return Number(a) === Number(b);
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => pyEq(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && pyEq(a[k], b[k]));
  }
  return false;
}

function cmpCodePoints(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const d = ca[i]!.codePointAt(0)! - cb[i]!.codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return ca.length === cb.length ? 0 : ca.length < cb.length ? -1 : 1;
}

/** Python ordering (-1/0/1); throws PyTypeError where Python raises. */
export function pyCmp(a: unknown, b: unknown): number {
  if (isNum(a) && isNum(b)) {
    const x = Number(a);
    const y = Number(b);
    // NaN is unordered: every comparison against it is False, as in Python.
    if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") return cmpCodePoints(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (!pyEq(a[i], b[i])) return pyCmp(a[i], b[i]);
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }
  throw new PyTypeError("unorderable");
}

/** Python `bool(v)`. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

/** Python `a in b`. */
export function pyIn(a: unknown, b: unknown): boolean {
  if (typeof b === "string") {
    if (typeof a !== "string") throw new PyTypeError("'in <string>' requires string");
    return b.includes(a);
  }
  if (Array.isArray(b)) return b.some((x) => pyEq(x, a));
  if (isObj(b)) {
    if (Array.isArray(a) || isObj(a)) throw new PyTypeError("unhashable");
    return typeof a === "string" && Object.prototype.hasOwnProperty.call(b, a);
  }
  throw new PyTypeError("not iterable");
}

function requireStr(b: unknown): string {
  if (typeof b !== "string") throw new PyTypeError("expected str");
  return b;
}

const COMPARATORS: Record<Operator, (a: unknown, b: unknown) => boolean> = {
  exact: (a, b) => pyEq(a, b),
  iexact: (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase(),
  gt: (a, b) => a !== null && pyCmp(a, b) > 0,
  gte: (a, b) => a !== null && pyCmp(a, b) >= 0,
  lt: (a, b) => a !== null && pyCmp(a, b) < 0,
  lte: (a, b) => a !== null && pyCmp(a, b) <= 0,
  in: (a, b) => pyIn(a, b),
  contains: (a, b) => (typeof a === "string" || Array.isArray(a) ? pyIn(b, a) : false),
  icontains: (a, b) =>
    typeof a === "string" && typeof b === "string" && a.toLowerCase().includes(b.toLowerCase()),
  startswith: (a, b) => typeof a === "string" && a.startsWith(requireStr(b)),
  endswith: (a, b) => typeof a === "string" && a.endsWith(requireStr(b)),
  isnull: (a, b) => (a === null) === pyTruthy(b),
};

/**
 * `OPERATORS[op](fieldValue, arg)` with the server's error handling: a
 * comparison Python would raise on is "no match". `undefined` is None.
 */
export function evaluate(op: Operator, fieldValue: unknown, arg: unknown): boolean {
  const a = fieldValue === undefined ? null : fieldValue;
  const b = arg === undefined ? null : arg;
  try {
    return COMPARATORS[op](a, b);
  } catch (e) {
    if (e instanceof PyTypeError) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Argument coercion (query_resolver._coerce)
// ---------------------------------------------------------------------------

const INT_RE = /^[+-]?\d+(?:_\d+)*$/;
const FLOAT_RE = /^[+-]?(?:(?:\d+(?:_\d+)*)?\.?\d+(?:_\d+)*|\d+(?:_\d+)*\.)(?:[eE][+-]?\d+(?:_\d+)*)?$/;
const SPECIAL_FLOAT_RE = /^[+-]?(?:inf|infinity|nan)$/i;

/** Best-effort coerce a typed string into a bool / number, else the string. */
export function coerceScalar(s: string): unknown {
  const low = s.toLowerCase();
  if (low === "true" || low === "false") return low === "true";
  const t = s.trim();
  if (INT_RE.test(t)) return Number(t.replace(/_/g, ""));
  if (FLOAT_RE.test(t)) return Number(t.replace(/_/g, ""));
  if (SPECIAL_FLOAT_RE.test(t)) {
    const neg = t.startsWith("-");
    if (/nan/i.test(t)) return NaN;
    return neg ? -Infinity : Infinity;
  }
  return s;
}

/** The argument an operator receives for the text the user typed. */
export function coerceArg(op: Operator, text: string): unknown {
  return op === "in" ? text.split(",").map(coerceScalar) : coerceScalar(text);
}

// ---------------------------------------------------------------------------
// Runs: the filter tree
// ---------------------------------------------------------------------------

/**
 * One builder chip. `arg` is kept as typed; it is coerced on evaluation.
 * A chip compiles to its `__op_<op>` builtin applied to the field's value.
 */
export interface RunFilter {
  field: string;
  op: Operator;
  arg: string;
}

export interface ChipNode extends RunFilter {
  kind: "chip";
}

/** A scalar expression (lib/expr) that a run matches when it is truthy. */
export interface ExprNode {
  kind: "expr";
  expr: string;
}

/** And/or over children. An empty group constrains nothing. */
export interface GroupNode {
  kind: "group";
  op: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = ChipNode | ExprNode | GroupNode;

export const EMPTY_FILTER: GroupNode = { kind: "group", op: "and", children: [] };

/** The builtins chips compile to: `__op_<operator>(fieldValue, coercedArg)`. */
export type OpBuiltin = `__op_${Operator}`;

export const OP_BUILTINS = Object.fromEntries(
  OPERATORS.map((op) => [`__op_${op}`, (a: unknown, b: unknown) => evaluate(op, a, b)]),
) as Record<OpBuiltin, (fieldValue: unknown, arg: unknown) => boolean>;

export function opBuiltin(op: Operator): OpBuiltin {
  return `__op_${op}`;
}

export const BUILTIN_FIELDS = ["display_name", "status", "tags", "group", "job_type"] as const;

/**
 * A run's value for a filter field: a built-in column, `values.<key>` (the
 * table's resolved metric/summary value) or `params.<key>` (JSON-decoded).
 * Missing is null. `tags` is the parsed list, `[]` when untagged, like the
 * server's `_parse_tags`.
 */
export function fieldValue(run: Run, field: string): unknown {
  switch (field) {
    case "display_name":
      return run.display_name ?? null;
    case "status":
      return run.status;
    case "tags":
      return parseTags(run.tags);
    case "group":
      return run.group ?? null;
    case "job_type":
      return run.job_type ?? null;
  }
  if (field.startsWith("values.")) return run.values?.[field.slice("values.".length)] ?? null;
  if (field.startsWith("params.")) return run.params?.[field.slice("params.".length)] ?? null;
  return null;
}

/** True when the run satisfies one chip. */
export function matchesChip(run: Run, f: RunFilter): boolean {
  return OP_BUILTINS[opBuiltin(f.op)](fieldValue(run, f.field), coerceArg(f.op, f.arg));
}

/** True when the run satisfies every chip (all-of, like repeated query keys). */
export function matchesFilters(run: Run, filters: readonly RunFilter[]): boolean {
  return filters.every((f) => matchesChip(run, f));
}

/**
 * The error of an expression leaf (parse/type error, or a series where a
 * single value is needed), or null when it is valid. An invalid leaf is
 * skipped (matches everything) so a half-typed expression never blanks
 * the table; the bar shows the error instead.
 */
export function exprLeafError(expr: string): string | null {
  return compileScalarExpr(expr).error;
}

/** True when the run satisfies the filter tree. */
export function matchesFilter(run: Run, node: FilterNode): boolean {
  switch (node.kind) {
    case "chip":
      return matchesChip(run, node);
    case "expr": {
      const { node: ast } = compileScalarExpr(node.expr);
      if (!ast) return true;
      try {
        return matches(evaluate_(ast, runContextOf(run)));
      } catch {
        return false;
      }
    }
    case "group": {
      if (node.children.length === 0) return true;
      return node.op === "and"
        ? node.children.every((c) => matchesFilter(run, c))
        : node.children.some((c) => matchesFilter(run, c));
    }
  }
}

/** True when the tree constrains nothing (only empty groups). */
export function isEmptyFilter(node: FilterNode): boolean {
  return node.kind === "group" && node.children.every(isEmptyFilter);
}

/** Every filterable field across the runs: built-ins, then values.*, then params.*. */
export function filterFieldsOf(runs: readonly Run[]): string[] {
  const values = new Set<string>();
  const params = new Set<string>();
  for (const r of runs) {
    for (const k of Object.keys(r.values ?? {})) values.add(`values.${k}`);
    for (const k of Object.keys(r.params ?? {})) params.add(`params.${k}`);
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return [...BUILTIN_FIELDS, ...sort(values), ...sort(params)];
}

// Tree edits, addressed by a path of child indices from the root.

export type NodePath = readonly number[];

export function nodeAt(root: FilterNode, path: NodePath): FilterNode | null {
  let n: FilterNode = root;
  for (const i of path) {
    if (n.kind !== "group") return null;
    const c: FilterNode | undefined = n.children[i];
    if (!c) return null;
    n = c;
  }
  return n;
}

/** Replace the node at `path` (null removes it). Returns a new tree. */
export function updateAt(root: GroupNode, path: NodePath, fn: (n: FilterNode) => FilterNode | null): GroupNode {
  const rec = (n: FilterNode, depth: number): FilterNode | null => {
    if (depth === path.length) return fn(n);
    if (n.kind !== "group") return n;
    const i = path[depth]!;
    const children: FilterNode[] = [];
    n.children.forEach((c, k) => {
      if (k !== i) {
        children.push(c);
        return;
      }
      const next = rec(c, depth + 1);
      if (next) children.push(next);
    });
    return { ...n, children };
  };
  const out = rec(root, 0);
  return out && out.kind === "group" ? out : EMPTY_FILTER;
}

/** Append `child` to the group at `path`. */
export function addChild(root: GroupNode, path: NodePath, child: FilterNode): GroupNode {
  return updateAt(root, path, (n) => (n.kind === "group" ? { ...n, children: [...n.children, child] } : n));
}

function parseNode(v: unknown, depth: number): FilterNode | null {
  if (!isObj(v) || depth > 16) return null;
  if (v.kind === "chip") {
    return typeof v.field === "string" && isOperator(v.op) && typeof v.arg === "string"
      ? { kind: "chip", field: v.field, op: v.op, arg: v.arg }
      : null;
  }
  if (v.kind === "expr") return typeof v.expr === "string" ? { kind: "expr", expr: v.expr } : null;
  if (v.kind === "group" && (v.op === "and" || v.op === "or") && Array.isArray(v.children)) {
    return {
      kind: "group",
      op: v.op,
      children: v.children.map((c) => parseNode(c, depth + 1)).filter((c): c is FilterNode => c !== null),
    };
  }
  return null;
}

/** Parse a stored filter tree; the root is always a group. */
export function parseFilter(raw: unknown): GroupNode {
  const n = parseNode(raw, 0);
  return n && n.kind === "group" ? n : EMPTY_FILTER;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** The runs table's persisted view: filter, nested grouping, multi-sort, columns and computed columns. */
export interface RunsFilterState {
  version: 2;
  filter: GroupNode;
  groupBy: GroupBy[];
  sort: SortKey[];
  columns: ColumnsState;
  computed: ComputedColumn[];
}

export const EMPTY_RUNS_FILTER: RunsFilterState = {
  version: 2,
  filter: EMPTY_FILTER,
  groupBy: [],
  sort: DEFAULT_SORT,
  // Not `EMPTY_COLUMNS`: see the import cycle note at the top.
  columns: { order: [], hidden: [], pinned: [], better: {}, widths: {} },
  computed: [],
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseColumns(v: unknown): ColumnsState {
  if (!isObj(v)) return EMPTY_RUNS_FILTER.columns;
  const better: Record<string, Better> = {};
  if (isObj(v.better)) {
    for (const [k, b] of Object.entries(v.better)) if (b === "lower" || b === "higher") better[k] = b;
  }
  const widths: Record<string, number> = {};
  if (isObj(v.widths)) {
    for (const [k, w] of Object.entries(v.widths)) if (typeof w === "number" && Number.isFinite(w)) widths[k] = clampColumnWidth(w);
  }
  return { order: strings(v.order), hidden: strings(v.hidden), pinned: strings(v.pinned), better, widths };
}

function parseSort(v: unknown): SortKey[] {
  if (!Array.isArray(v)) return DEFAULT_SORT;
  return v
    .filter((k): k is SortKey => isObj(k) && typeof k.column === "string" && (k.direction === "asc" || k.direction === "desc"))
    .map((k) => ({ column: k.column, direction: k.direction }));
}

function parseComputed(v: unknown): ComputedColumn[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => isObj(c) && typeof c.id === "string" && typeof c.expr === "string")
    .map((c) => ({
      id: c.id as string,
      expr: c.expr as string,
      ...(typeof c.name === "string" && c.name ? { name: c.name } : {}),
      ...(c.better === "lower" || c.better === "higher" ? { better: c.better } : {}),
    }));
}

/** Parse a stored state, dropping anything malformed. Anything but v2 is empty (no migration). */
export function parseRunsFilterState(raw: unknown): RunsFilterState {
  if (!isObj(raw) || raw.version !== 2) return EMPTY_RUNS_FILTER;
  return {
    version: 2,
    filter: parseFilter(raw.filter),
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy.filter(isGroupBy) : [],
    sort: parseSort(raw.sort),
    columns: parseColumns(raw.columns),
    computed: parseComputed(raw.computed),
  };
}

export function loadRunsFilter(storage: Storage, projectId: string): RunsFilterState {
  return parseRunsFilterState(loadJson<unknown>(storage, storageKeys.runsFilter(projectId)));
}

export function saveRunsFilter(storage: Storage, projectId: string, state: RunsFilterState): void {
  saveJson(storage, storageKeys.runsFilter(projectId), state);
}
