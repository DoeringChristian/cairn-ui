/**
 * Metric rules, set with `run.track(..., summary=..., x=...)`, as
 * `GET /api/runs/{id}` returns them (`metric_defs`). A rule governs exactly
 * the metric it names — there are no globs.
 */

import type { MetricDef } from "../api/types.ts";

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

/** The summary rule (`"min"`, `"max"`, `"mean"`, `"last"`) `run.track(..., summary=...)` assigns to `name`. */
export function summaryRuleFor(
  name: string,
  defs: readonly MetricDef[] | undefined,
): string | null {
  return defFor(name, defs)?.summary ?? null;
}
