/**
 * An expression `RunContext` over one row of the runs table: what the list
 * endpoint returns with `include: ["params", "stats"]`. There are no series
 * here, so a reducer over a metric (`min(val.loss)`) answers from the
 * server's `run.stats`; an expression that needs a whole series (`plan(node)
 * === "series"`) sees empty series and evaluates to null.
 *
 * `config.<key>` reads `run.params`, `summary.<key>` reads `run.values` (the
 * table's metric columns: the last point, or an explicit summary value).
 */

import type { Run } from "../../api/types.ts";
import type { Reducer, RunContext, RunField } from "../expr/index.ts";

export function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function runContextOf(run: Run): RunContext {
  return {
    series: () => null,
    stat: (name: string, reducer: Reducer) => {
      if (!run.stats) return undefined;
      const s = run.stats[name];
      if (!s) return null;
      const v = s[reducer];
      return typeof v === "number" ? v : null;
    },
    config: (key: string) => run.params?.[key] ?? null,
    summary: (key: string) => run.values?.[key] ?? null,
    run: (field: RunField) => {
      switch (field) {
        case "name":
          return run.display_name ?? run.id;
        case "id":
          return run.id;
        case "status":
          return run.status;
        case "tags":
          return parseTags(run.tags);
        case "group":
          return run.group ?? null;
        case "job_type":
          return run.job_type ?? null;
        case "created_at":
          return run.created_at;
      }
      return null;
    },
  };
}
