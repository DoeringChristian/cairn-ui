/**
 * A run's own metric rules, set with `run.track(..., summary=..., x=...)`, as
 * `GET /api/runs/{id}` returns them (`metric_defs`): here only `x`, the
 * x-axis. A rule governs exactly the metric it names — there are no globs.
 * Summary and goal are per project (lib/metric-rules.ts).
 */

import type { MetricDef } from "../api/types.ts";
import type { RuleOf } from "./metric-rules.ts";

function defFor(name: string, defs: readonly MetricDef[] | undefined): MetricDef | null {
  return defs?.find((d) => d.name === name) ?? null;
}

/** The x-axis series `run.track(..., x=...)` assigns to `name`. */
export function xMetricFor(
  name: string,
  defs: readonly MetricDef[] | undefined,
): string | null {
  return defFor(name, defs)?.x ?? null;
}

/**
 * A `system.*` metric (the SDK's CPU / GPU / memory sampler): listed apart
 * from the run's own metrics (folded on the run page, left out of run
 * comparisons and comparison templates).
 */
export function isSystemMetric(name: string): boolean {
  return name.startsWith("system.");
}

/** Where a run's final value of `key` comes from: an explicit summary key, the metric's summary rule in the project, or its last point. */
export function metricValueSource(key: string, explicitSummaryKeys: ReadonlySet<string>, ruleOf: RuleOf): string {
  return explicitSummaryKeys.has(key) ? "summary" : (ruleOf(key).summary ?? "last");
}
