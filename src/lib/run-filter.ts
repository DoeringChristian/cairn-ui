/**
 * The runs table's filter builder: field/operator/argument predicates over
 * the loaded runs, evaluated client-side.
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
class PyTypeError extends Error {}

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
function pyCmp(a: unknown, b: unknown): number {
  if (isNum(a) && isNum(b)) {
    const x = Number(a);
    const y = Number(b);
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
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

/** Python `a in b`. */
function pyIn(a: unknown, b: unknown): boolean {
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
// Runs
// ---------------------------------------------------------------------------

/** One builder chip. `arg` is kept as typed; it is coerced on evaluation. */
export interface RunFilter {
  field: string;
  op: Operator;
  arg: string;
}

export const BUILTIN_FIELDS = ["display_name", "status", "tags", "group", "job_type"] as const;

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

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

/** True when the run satisfies every filter (all-of, like repeated query keys). */
export function matchesFilters(run: Run, filters: readonly RunFilter[]): boolean {
  return filters.every((f) => evaluate(f.op, fieldValue(run, f.field), coerceArg(f.op, f.arg)));
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

// ---------------------------------------------------------------------------
// Group-by
// ---------------------------------------------------------------------------

export type GroupBy =
  | { source: "group" | "job_type" | "tag" }
  | { source: "param"; key: string };

export interface RunGroup {
  /** Stable id for React keys and collapse state; null-valued groups use "∅". */
  id: string;
  /** Display label; null when the runs have no value. */
  label: string | null;
  runs: Run[];
}

function labelOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * Partition runs (kept in their given order) into groups. A run with several
 * tags appears under each of them. Groups sort by label (numeric-aware), the
 * no-value group last.
 */
export function groupRuns(runs: readonly Run[], by: GroupBy): RunGroup[] {
  const groups = new Map<string | null, Run[]>();
  const add = (label: string | null, run: Run) => {
    const arr = groups.get(label) ?? [];
    arr.push(run);
    groups.set(label, arr);
  };
  for (const run of runs) {
    switch (by.source) {
      case "group":
        add(labelOf(run.group), run);
        break;
      case "job_type":
        add(labelOf(run.job_type), run);
        break;
      case "param":
        add(labelOf(run.params?.[by.key]), run);
        break;
      case "tag": {
        const tags = parseTags(run.tags);
        if (tags.length === 0) add(null, run);
        for (const t of new Set(tags)) add(t, run);
        break;
      }
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return b === null ? 0 : 1;
      if (b === null) return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([label, rs]) => ({ id: label === null ? "∅" : `=${label}`, label, runs: rs }));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface RunsFilterState {
  version: 1;
  filters: RunFilter[];
  groupBy: GroupBy | null;
}

export const EMPTY_RUNS_FILTER: RunsFilterState = { version: 1, filters: [], groupBy: null };

function validGroupBy(v: unknown): GroupBy | null {
  if (!isObj(v)) return null;
  if (v.source === "group" || v.source === "job_type" || v.source === "tag") return { source: v.source };
  if (v.source === "param" && typeof v.key === "string") return { source: "param", key: v.key };
  return null;
}

/** Parse a stored state, dropping anything malformed. */
export function parseRunsFilterState(raw: unknown): RunsFilterState {
  if (!isObj(raw)) return EMPTY_RUNS_FILTER;
  const filters = Array.isArray(raw.filters)
    ? raw.filters.filter(
        (f): f is RunFilter =>
          isObj(f) && typeof f.field === "string" && isOperator(f.op) && typeof f.arg === "string",
      ).map((f) => ({ field: f.field, op: f.op, arg: f.arg }))
    : [];
  return { version: 1, filters, groupBy: validGroupBy(raw.groupBy) };
}

export function loadRunsFilter(storage: Storage, projectId: string): RunsFilterState {
  return parseRunsFilterState(loadJson<unknown>(storage, storageKeys.runsFilter(projectId)));
}

export function saveRunsFilter(storage: Storage, projectId: string, state: RunsFilterState): void {
  saveJson(storage, storageKeys.runsFilter(projectId), state);
}
