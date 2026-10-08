/**
 * The run page Overview's tables (pure): the config and the summary as
 * flat `key → value` rows, filtered by the search box above each.
 *
 * Pure: runs under `node --test`.
 */

import type { RuleOf } from "./metric-rules.ts";
import type { Param } from "../api/types.ts";
import { isSystemMetric, metricValueSource } from "./metric-defs.ts";
import { summaryMediaOf, type SummaryMedia } from "./media/summary-media.ts";

export interface ConfigRow {
  /** Dotted, as the runs table's config columns. */
  key: string;
  value: unknown;
}

export interface SummaryRow {
  key: string;
  value: unknown;
  /** Where the value comes from: `last`, a summary rule (`min`, …), or `summary` (`run.summary(...)`). */
  source: string;
  /** A media value (`run.summary(fig=cairn.Figure(...))`). */
  media: SummaryMedia | null;
}

/** The config, flattened as the server stores it (`params`: dotted keys, JSON values), A–Z. */
export function configRows(params: readonly Param[]): ConfigRow[] {
  return params
    .map((p) => {
      let value: unknown = p.value;
      try {
        value = JSON.parse(p.value);
      } catch {
        // A value the server did not JSON-encode: shown as stored.
      }
      return { key: p.key, value };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The leaves of a nested summary document under dotted keys; a media marker is one leaf. */
function summaryLeaves(doc: unknown, prefix = ""): Array<[string, unknown]> {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return prefix ? [[prefix, doc]] : [];
  if (prefix && summaryMediaOf(doc)) return [[prefix, doc]];
  return Object.entries(doc).flatMap(([k, v]) => summaryLeaves(v, prefix ? `${prefix}.${k}` : k));
}

/**
 * The run's final values, A–Z: every metric's value as the runs table shows
 * it (`values`: the last point, its summary rule's value, or an explicit
 * `run.summary` key), then the summary's other keys (media, strings the
 * table has no column for). `system.*` sampler series are the System tab's.
 */
export function summaryRows(
  values: Readonly<Record<string, unknown>>,
  summaryDoc: Readonly<Record<string, unknown>>,
  summary: readonly Param[],
  ruleOf: RuleOf,
): SummaryRow[] {
  const explicit = new Set(summary.map((p) => p.key));
  const rows = new Map<string, SummaryRow>();
  for (const [key, value] of Object.entries(values)) {
    if (isSystemMetric(key)) continue;
    rows.set(key, { key, value, source: metricValueSource(key, explicit, ruleOf), media: null });
  }
  for (const [key, value] of summaryLeaves(summaryDoc)) {
    if (rows.has(key) || isSystemMetric(key)) continue;
    rows.set(key, { key, value, source: "summary", media: summaryMediaOf(value) });
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Rows whose key contains `query` (case-insensitive); an empty query keeps all. */
export function filterRows<T extends { key: string }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.key.toLowerCase().includes(q)) : [...rows];
}

/** The command line: `python <script> <args…>` for a Python script, else the argv as captured. */
export function commandLine(argv: readonly string[]): string {
  if (argv.length === 0) return "";
  const quoted = argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`));
  return argv[0]!.endsWith(".py") ? `python ${quoted.join(" ")}` : quoted.join(" ");
}
