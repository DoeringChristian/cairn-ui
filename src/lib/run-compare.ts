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
import { summaryRuleFor } from "./metric-defs.ts";
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
  /** Lower is better (a metric whose summary rule is "min"): colour inverted. */
  lowerBetter: boolean;
}

export interface CompareTable {
  runIds: string[];
  /** Sorted by key. */
  rows: CompareRow[];
}

function makeRow(key: string, values: CompareValue[], lowerBetter = false): CompareRow {
  const differs = values.some((v) => v == null) || values.some((v) => v !== values[0]);
  const statuses = isNumericSeries(values) ? computeCellStatuses(values.map(toNumeric)) : null;
  return { key, values, differs, statuses, lowerBetter };
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

function toTable(runs: readonly RunDetailResponse[], map: Map<string, Map<string, CompareValue>>, lower?: Set<string>): CompareTable {
  const runIds = runs.map((rd) => rd.run.id);
  const rows = Array.from(map.keys())
    .sort()
    .map((key) => {
      const row = map.get(key)!;
      return makeRow(key, runIds.map((id) => row.get(id) ?? null), lower?.has(key) ?? false);
    });
  return { runIds, rows };
}

/** Each run's params (their raw logged value strings). */
export function buildParamDiff(runs: readonly RunDetailResponse[]): CompareTable {
  return toTable(runs, byKey(runs, (rd) => rd.params.map((p) => [p.key, p.value] as [string, CompareValue])));
}

/**
 * Each run's final metric values: `run.values` (a scalar's last point, its
 * `summary=` rule's value, or an explicit `run.summary(...)` key), without the
 * `system.*` sampler metrics. A metric whose rule is "min" (in any run's
 * metric defs or stats) counts lower as better.
 */
export function buildMetricsSummary(runs: readonly RunDetailResponse[]): CompareTable {
  const lower = new Set<string>();
  const map = byKey(runs, (rd) => {
    const out: [string, CompareValue][] = [];
    for (const [name, v] of Object.entries(rd.run.values ?? {})) {
      if (name.startsWith("system.")) continue;
      out.push([name, v]);
      const rule = summaryRuleFor(name, rd.metric_defs) ?? rd.run.stats?.[name]?.rule ?? null;
      if (rule === "min") lower.add(name);
    }
    return out;
  });
  return toTable(runs, map, lower);
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
    return { ...makeRow(field.replace(/_/g, " "), values), statuses: null };
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
