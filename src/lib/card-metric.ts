/**
 * The metric a parallel-coordinates or parameter-importance card reads: a
 * key of the runs' final values (`run.values`: each scalar metric under its
 * effective summary rule, or a `summary` key), and the default when the
 * card has none chosen. Pure.
 */

import { isSystemMetric } from "./metric-defs.ts";
import type { RuleOf } from "./metric-rules.ts";

/** A run's final values, by metric. */
export interface RunValues {
  values: Readonly<Record<string, unknown>>;
}

/** Every metric with a number on some run, sorted (system metrics left out). */
export function metricKeys(runs: readonly RunValues[]): string[] {
  const out = new Set<string>();
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.values)) if (typeof v === "number" && !isSystemMetric(k)) out.add(k);
  }
  return [...out].sort();
}

/** The chosen metric, else the first of `keys` with a goal, else the first. */
export function cardMetric(chosen: string | null | undefined, keys: readonly string[], ruleOf: RuleOf): string | null {
  if (chosen) return chosen;
  return keys.find((k) => ruleOf(k).goal !== "none") ?? keys[0] ?? null;
}
