import { useMemo } from "react";
import { useRunsDetails } from "../../api/hooks";
import type { Run } from "../../api/types";

/**
 * Fetch run details for `runIds` — which also seeds the run-label cache, so
 * cards call this for their labels — and derive `runId → created_at (ms)` for
 * the wall-time x-axis, the runs themselves, and each run's params
 * (JSON-decoded values, keyed by the flattened param key) and summary keys.
 */
export function useRunInfo(runIds: string[]): {
  runCreatedAtByRunId: Map<string, number>;
  runById: Map<string, Run>;
  paramsByRunId: Map<string, Record<string, unknown>>;
  summaryByRunId: Map<string, Record<string, unknown>>;
} {
  const queries = useRunsDetails(runIds);
  // `queries` is a fresh array every render; the fetch timestamps change iff data landed.
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");

  return useMemo(() => {
    const runCreatedAtByRunId = new Map<string, number>();
    const runById = new Map<string, Run>();
    const paramsByRunId = new Map<string, Record<string, unknown>>();
    const summaryByRunId = new Map<string, Record<string, unknown>>();
    runIds.forEach((rid, i) => {
      const data = queries[i]?.data;
      if (!data) return;
      runById.set(rid, data.run);
      const t = new Date(data.run.created_at).getTime();
      if (Number.isFinite(t)) runCreatedAtByRunId.set(rid, t);
      const params: Record<string, unknown> = {};
      for (const p of data.params) {
        try {
          params[p.key] = JSON.parse(p.value);
        } catch {
          params[p.key] = p.value;
        }
      }
      paramsByRunId.set(rid, params);
      const summary: Record<string, unknown> = {};
      for (const p of data.summary ?? []) {
        try {
          summary[p.key] = JSON.parse(p.value);
        } catch {
          summary[p.key] = p.value;
        }
      }
      summaryByRunId.set(rid, summary);
    });
    return { runCreatedAtByRunId, runById, paramsByRunId, summaryByRunId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, dataKey]);
}
