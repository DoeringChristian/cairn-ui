/**
 * The Summary section's tables (pure): the **Scalars** table (run info,
 * every metric logged at a single step and the runs' `summary` values; one
 * row per run, or per group when the workspace is grouped) and the
 * **Config** table (config keys as rows, tags and notes first; one column
 * per run or group).
 *
 * Rows/columns of a grouped workspace: each innermost group is one unit
 * (its runs in the order shown), a run outside every group stays its own.
 * A group's value: numbers → the mean over its runs that have one; a
 * created time → its first; anything else → the value when its runs agree,
 * else `MIXED`. In the Config table a group's value is shown only when all
 * its runs that have a config agree (one without the key counts), else
 * `MIXED`; tags and notes count every run.
 *
 * Pure: runs under `node --test`.
 */

import type { RunDetailResponse } from "../api/types.ts";
import { isSystemMetric } from "./metric-defs.ts";
import { decodeConfigValue } from "./plot-utils/format.ts";
import { parseTags } from "./runs-table/context.ts";
import type { RunSummaryPresence } from "./workspace/summary-cards.ts";

export type Scalar = string | number | boolean | null;

/** A group whose runs disagree. */
export const MIXED: unique symbol = Symbol("mixed");
export type Cell = Scalar | typeof MIXED;

/** One run, as the tables read it. */
export interface TableRun {
  id: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  user: string | null;
  host: string | null;
  /** The run table's metric values (`run.values`: a scalar's last point, or its `summary` override). */
  values: Readonly<Record<string, Scalar>>;
  /** `run.summary(...)` values, dotted keys; only scalar values. */
  summary: Readonly<Record<string, Scalar>>;
  /** The config, dotted keys (`params`), decoded. */
  config: Readonly<Record<string, Scalar>>;
  tags: readonly string[];
  notes: string;
}

const isScalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** A run's detail (`GET /api/runs/{id}`) as the tables read it. */
export function tableRunOf(rd: RunDetailResponse): TableRun {
  const summary: Record<string, Scalar> = {};
  for (const p of rd.summary ?? []) {
    const v = decode(p.value);
    if (!isSystemMetric(p.key) && isScalar(v)) summary[p.key] = v;
  }
  const config: Record<string, Scalar> = {};
  for (const p of rd.params) config[p.key] = decodeConfigValue(p.value);
  const values: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(rd.run.values ?? {})) if (isScalar(v)) values[k] = v;
  return {
    id: rd.run.id,
    status: rd.run.status,
    createdAt: rd.run.created_at,
    endedAt: rd.run.ended_at,
    user: rd.run.user,
    host: rd.run.hostname,
    values,
    summary,
    config,
    tags: parseTags(rd.run.tags),
    notes: rd.run.notes?.trim() ?? "",
  };
}

/** What a run has for the Summary cards (lib/workspace/summary-cards.ts `summaryMetrics`). */
export function summaryPresenceOf(rd: RunDetailResponse): RunSummaryPresence {
  const t = tableRunOf(rd);
  return {
    runId: t.id,
    summaryKeys: Object.keys(t.summary).length,
    configKeys: Object.keys(t.config).length,
    tags: t.tags.length,
    notes: t.notes !== "",
  };
}

// ---------------------------------------------------------------------------
// Units: runs, or groups when the workspace is grouped
// ---------------------------------------------------------------------------

export type Unit =
  | { kind: "run"; key: string; runId: string; runs: TableRun[] }
  | { kind: "group"; key: string; group: string; runs: TableRun[] };

/**
 * The table's units in the order shown: each run, or (grouped: `groupOf`)
 * each innermost group at its first run's place; a run without a group
 * stays its own unit.
 */
export function unitsOf(runs: readonly TableRun[], groupOf: ReadonlyMap<string, string> | null): Unit[] {
  const out: Unit[] = [];
  const groups = new Map<string, Extract<Unit, { kind: "group" }>>();
  for (const r of runs) {
    const g = groupOf?.get(r.id);
    if (g == null) {
      out.push({ kind: "run", key: `run:${r.id}`, runId: r.id, runs: [r] });
      continue;
    }
    const unit = groups.get(g);
    if (unit) unit.runs.push(r);
    else {
      const u = { kind: "group" as const, key: `group:${g}`, group: g, runs: [r] };
      groups.set(g, u);
      out.push(u);
    }
  }
  return out;
}

const same = (a: Cell, b: Cell) => a === b || (typeof a !== "symbol" && typeof b !== "symbol" && JSON.stringify(a) === JSON.stringify(b));

/** Values of a group's runs that have one: all numbers → the mean; all agreeing → that; none → null; else MIXED. */
export function aggregate(values: readonly Scalar[]): Cell {
  const have = values.filter((v) => v != null);
  if (have.length === 0) return null;
  if (have.every((v) => typeof v === "number")) return (have as number[]).reduce((a, b) => a + b, 0) / have.length;
  return have.every((v) => same(v, have[0]!)) ? have[0]! : MIXED;
}

/** Every run's value, the run without one counting: all agree → that value (null: none has it), else MIXED. */
export function agreement(values: readonly Scalar[]): Cell {
  return values.every((v) => same(v, values[0] ?? null)) ? (values[0] ?? null) : MIXED;
}

// ---------------------------------------------------------------------------
// The Scalars table
// ---------------------------------------------------------------------------

export type ColumnKind = "info" | "metric" | "summary";

export interface Column {
  key: string;
  label: string;
  kind: ColumnKind;
}

/** The run info columns (`showRunInfo`), first. */
export const INFO_COLUMNS: readonly Column[] = [
  { key: "info:status", label: "status", kind: "info" },
  { key: "info:duration", label: "duration", kind: "info" },
  { key: "info:created", label: "created", kind: "info" },
  { key: "info:user", label: "user", kind: "info" },
  { key: "info:host", label: "host", kind: "info" },
];

export interface ScalarsRow {
  unit: Unit;
  /** By column key. */
  cells: Record<string, Cell>;
}

export interface ScalarsTable {
  columns: Column[];
  rows: ScalarsRow[];
}

export interface ScalarsOptions {
  /** Single-step metric names (lib/workspace/summary-cards.ts `isSingleStepScalar`). */
  singleStep: readonly string[];
  groupOf: ReadonlyMap<string, string> | null;
  showRunInfo: boolean;
  /** Now (ms): a running run's duration so far. */
  now: number;
}

/** Seconds from created to ended (or `now`); null without a valid created time. */
function durationOf(r: TableRun, now: number): number | null {
  const start = Date.parse(r.createdAt);
  if (!Number.isFinite(start)) return null;
  const end = r.endedAt ? Date.parse(r.endedAt) : now;
  return Number.isFinite(end) ? Math.max(0, (end - start) / 1000) : null;
}

function infoCell(key: string, runs: readonly TableRun[], now: number): Cell {
  switch (key) {
    case "info:status":
      return aggregate(runs.map((r) => r.status));
    case "info:duration":
      return aggregate(runs.map((r) => durationOf(r, now)));
    case "info:created": {
      // A group: its first run's time (ms; formatted by the card).
      const ts = runs.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite);
      return ts.length ? Math.min(...ts) : null;
    }
    case "info:user":
      return aggregate(runs.map((r) => r.user));
    case "info:host":
      return aggregate(runs.map((r) => r.host));
  }
  return null;
}

/**
 * Rows = units, columns = run info (optional), the single-step metrics A–Z,
 * then the summary keys A–Z that are not single-step metrics. A metric or
 * summary column no shown run has is left out.
 */
export function scalarsTable(runs: readonly TableRun[], opts: ScalarsOptions): ScalarsTable {
  const singleStep = new Set(opts.singleStep);
  const metricKeys = [...singleStep].filter((k) => runs.some((r) => r.values[k] != null)).sort((a, b) => a.localeCompare(b));
  const summaryKeys = [...new Set(runs.flatMap((r) => Object.keys(r.summary)))]
    .filter((k) => !singleStep.has(k))
    .sort((a, b) => a.localeCompare(b));
  const columns: Column[] = [
    ...(opts.showRunInfo ? INFO_COLUMNS : []),
    ...metricKeys.map((k) => ({ key: `metric:${k}`, label: k, kind: "metric" as const })),
    ...summaryKeys.map((k) => ({ key: `summary:${k}`, label: k, kind: "summary" as const })),
  ];
  const rows = unitsOf(runs, opts.groupOf).map((unit): ScalarsRow => {
    const cells: Record<string, Cell> = {};
    for (const c of columns) {
      if (c.kind === "info") cells[c.key] = infoCell(c.key, unit.runs, opts.now);
      else if (c.kind === "metric") cells[c.key] = aggregate(unit.runs.map((r) => r.values[c.label] ?? null));
      else cells[c.key] = aggregate(unit.runs.map((r) => r.summary[c.label] ?? null));
    }
    return { unit, cells };
  });
  return { columns, rows };
}

/** A column sort: `"label"` (the row label) or a column key. */
export interface ScalarsSort {
  key: string;
  desc: boolean;
}

/** Click a header: ascending, then descending, then unsorted. */
export function nextSort(cur: ScalarsSort | null, key: string): ScalarsSort | null {
  if (!cur || cur.key !== key) return { key, desc: false };
  return cur.desc ? null : { key, desc: true };
}

function compareCells(a: Scalar, b: Scalar): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Rows sorted by `sort` (stable; null: as given). Empty and mixed cells go
 * last in either direction. `labelOf` gives the row label for `"label"`.
 */
export function sortRows<R extends { cells: Record<string, Cell> }>(
  rows: readonly R[],
  sort: ScalarsSort | null,
  labelOf: (row: R) => string,
): R[] {
  if (!sort) return [...rows];
  const val = (r: R): Cell => (sort.key === "label" ? labelOf(r) : (r.cells[sort.key] ?? null));
  return rows
    .map((r, i) => ({ r, i, v: val(r) }))
    .sort((x, y) => {
      const xe = x.v == null || x.v === MIXED;
      const ye = y.v == null || y.v === MIXED;
      if (xe || ye) return xe === ye ? x.i - y.i : xe ? 1 : -1;
      const d = compareCells(x.v as Scalar, y.v as Scalar);
      return d !== 0 ? (sort.desc ? -d : d) : x.i - y.i;
    })
    .map((x) => x.r);
}

// ---------------------------------------------------------------------------
// The Config table
// ---------------------------------------------------------------------------

export interface ConfigRow {
  /** `tags`, `notes`, or a config key. */
  key: string;
  kind: "tags" | "notes" | "config";
  /** One per unit, in unit order. */
  cells: Cell[];
  /** Not the same in every unit (a mixed group differs). */
  differs: boolean;
}

export interface ConfigTable {
  units: Unit[];
  rows: ConfigRow[];
}

/**
 * Tags and notes (when a shown run has any), then every config key A–Z;
 * `onlyDiffs` keeps the rows that are not the same in every unit.
 */
export function configTable(
  runs: readonly TableRun[],
  { groupOf, onlyDiffs }: { groupOf: ReadonlyMap<string, string> | null; onlyDiffs: boolean },
): ConfigTable {
  const units = unitsOf(runs, groupOf);
  const row = (key: string, kind: ConfigRow["kind"], of: (r: TableRun) => Scalar, counts = (_r: TableRun) => true): ConfigRow => {
    const cells = units.map((u) => agreement(u.runs.filter(counts).map(of)));
    return { key, kind, cells, differs: cells.some((c) => c === MIXED || !same(c, cells[0]!)) };
  };
  const rows: ConfigRow[] = [];
  if (runs.some((r) => r.tags.length > 0)) rows.push(row("tags", "tags", (r) => (r.tags.length ? [...r.tags].sort().join(", ") : null)));
  if (runs.some((r) => r.notes)) rows.push(row("notes", "notes", (r) => r.notes || null));
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r.config)))].sort((a, b) => a.localeCompare(b));
  // A run without any config (a prepare step of a group) says nothing about its group's config.
  const hasConfig = (r: TableRun) => Object.keys(r.config).length > 0;
  for (const k of keys) rows.push(row(k, "config", (r) => (k in r.config ? r.config[k]! : null), hasConfig));
  return { units, rows: onlyDiffs ? rows.filter((r) => r.differs) : rows };
}
