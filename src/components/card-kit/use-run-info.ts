import { useMemo } from "react";
import { useRunsDetails } from "../../api/hooks";

/**
 * Fetch run details for `runIds` — which also seeds the run-label cache, so
 * cards call this for their labels — and derive `runId → created_at (ms)` for
 * the wall-time x-axis.
 */
export function useRunInfo(runIds: string[]): {
  runCreatedAtByRunId: Map<string, number>;
} {
  const queries = useRunsDetails(runIds);

  const runCreatedAtByRunId = useMemo(() => {
    const map = new Map<string, number>();
    runIds.forEach((rid, i) => {
      const raw = queries[i]?.data?.run.created_at;
      if (!raw) return;
      const t = new Date(raw).getTime();
      if (Number.isFinite(t)) map.set(rid, t);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, queries]);

  return { runCreatedAtByRunId };
}
