/**
 * Run comparison tables: params, final metric values and environment side
 * by side (rows = keys, columns = runs), with which rows differ and the
 * better/worse cells of numeric rows.
 *
 * Pure; rendered by components/run-compare/* in the run-compare card and the
 * comparison's Overview tab.
 */

import type { RunDetailResponse } from "../api/types.ts";
import { safeJsonParse } from "./format.ts";
import { decodeConfigValue } from "./plot-utils/format.ts";
import { isSystemMetric } from "./metric-defs.ts";
import { noRules, type Goal, type RuleOf } from "./metric-rules.ts";
import { computeCellStatuses, isNumericSeries, toNumeric, type CellComparison } from "./table-diff.ts";

export type CompareValue = string | number | boolean | null;

export interface CompareRow {
  key: string;
  /** One per run, in the table's `runIds` order; `null` where the run lacks the key. */
  values: CompareValue[];
  /** Missing in some run, or not the same everywhere. */
  differs: boolean;
  /** Per cell, for a numeric row (see lib/table-diff.ts); `null` otherwise. */
  statuses: CellComparison[] | null;
  /**
   * Which way is better: a metric's goal in the project (lib/metric-rules.ts);
   * "none" leaves the row uncoloured. Params colour higher green.
   */
  goal: Goal;
}

export interface CompareTable {
  runIds: string[];
  /** Sorted by key. */
  rows: CompareRow[];
}

function makeRow(key: string, values: CompareValue[], goal: Goal): CompareRow {
  const differs = values.some((v) => v == null) || values.some((v) => v !== values[0]);
  const statuses = goal !== "none" && isNumericSeries(values) ? computeCellStatuses(values.map(toNumeric)) : null;
  return { key, values, differs, statuses, goal };
}

function byKey(runs: readonly RunDetailResponse[], cells: (rd: RunDetailResponse) => Iterable<[string, CompareValue]>): Map<string, Map<string, CompareValue>> {
  const map = new Map<string, Map<string, CompareValue>>();
  for (const rd of runs) {
    for (const [key, v] of cells(rd)) {
      let row = map.get(key);
      if (!row) map.set(key, (row = new Map()));
      row.set(rd.run.id, v);
    }
  }
  return map;
}

function toTable(runs: readonly RunDetailResponse[], map: Map<string, Map<string, CompareValue>>, goalOf: (key: string) => Goal): CompareTable {
  const runIds = runs.map((rd) => rd.run.id);
  const rows = Array.from(map.keys())
    .sort()
    .map((key) => {
      const row = map.get(key)!;
      return makeRow(key, runIds.map((id) => row.get(id) ?? null), goalOf(key));
    });
  return { runIds, rows };
}

/** Each run's params, decoded (see `decodeConfigValue`). */
export function buildParamDiff(runs: readonly RunDetailResponse[]): CompareTable {
  return toTable(runs, byKey(runs, (rd) => rd.params.map((p) => [p.key, decodeConfigValue(p.value)] as [string, CompareValue])), () => "higher");
}

/**
 * Each run's final metric values: `run.values` (a scalar's last point, its
 * summary rule's value, or an explicit `run.summary(...)` key), without the
 * `system.*` sampler metrics. Each row's goal is the metric's in the project
 * (`ruleOf`, lib/metric-rules.ts).
 */
export function buildMetricsSummary(runs: readonly RunDetailResponse[], ruleOf: RuleOf = noRules): CompareTable {
  const map = byKey(runs, (rd) => {
    const out: [string, CompareValue][] = [];
    for (const [name, v] of Object.entries(rd.run.values ?? {})) {
      if (isSystemMetric(name)) continue;
      out.push([name, v]);
    }
    return out;
  });
  return toTable(runs, map, (key) => ruleOf(key).goal);
}

const ENV_FIELDS = ["python_version", "platform", "cuda_available", "cuda_version", "gpu_names"] as const;

/** The captured environment's headline fields (`run.env_snapshot`); "—" where absent. */
export function buildEnvDiff(runs: readonly RunDetailResponse[]): CompareTable {
  const runIds = runs.map((rd) => rd.run.id);
  const envs = runs.map((rd) => safeJsonParse<Record<string, unknown>>(rd.run.env_snapshot));
  const rows = ENV_FIELDS.map((field) => {
    const values = envs.map((env) => {
      if (!env) return "—";
      const raw = env[field];
      if (field === "gpu_names" && Array.isArray(raw)) return raw.length > 0 ? (raw as string[]).join(", ") : "—";
      if (field === "cuda_available") return raw ? `yes (${env.cuda_version ?? "?"})` : "no";
      return raw != null ? String(raw) : "—";
    });
    // Env values are labels, never coloured.
    return makeRow(field.replace(/_/g, " "), values, "none");
  });
  return { runIds, rows };
}

export interface RowFilter {
  onlyDiffs: boolean;
  /** Case-insensitive substring of the key. */
  filter: string;
  /** Shown first, in this order, whatever `onlyDiffs` and `filter` say. */
  pinnedKeys: readonly string[];
}

/** The rows to show: pinned keys first, then the rest that pass the filters. */
export function selectRows(table: CompareTable, { onlyDiffs, filter, pinnedKeys }: RowFilter): CompareRow[] {
  const byKeyMap = new Map(table.rows.map((r) => [r.key, r]));
  const pinned = pinnedKeys.map((k) => byKeyMap.get(k)).filter((r): r is CompareRow => r != null);
  const pinnedSet = new Set(pinnedKeys);
  const q = filter.trim().toLowerCase();
  const rest = table.rows.filter(
    (r) => !pinnedSet.has(r.key) && (!onlyDiffs || r.differs) && (!q || r.key.toLowerCase().includes(q)),
  );
  return [...pinned, ...rest];
}

/** How many rows differ. */
export function differingCount(table: CompareTable): number {
  return table.rows.reduce((n, r) => n + (r.differs ? 1 : 0), 0);
}
