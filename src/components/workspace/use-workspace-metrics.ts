import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { MetricInfo } from "../../lib/workspace/layout";
import { mergeRunMetrics } from "../../lib/workspace/metrics";

/**
 * The metrics the bound runs log (sequences + named artifacts), merged by
 * name. A running run's roster is polled, so a metric first logged mid-run
 * gets its panel.
 */
export function useWorkspaceMetrics(runIds: readonly string[]): { metrics: MetricInfo[]; loading: boolean; error: unknown } {
  const runQs = useQueries({
    queries: runIds.map((id) => ({ queryKey: qk.run(id), queryFn: () => api.run(id), staleTime: 5_000 })),
  });
  const seqQs = useQueries({
    queries: runIds.map((id, i) => {
      const status = runQs[i]?.data?.run.status;
      return {
        queryKey: qk.sequences(id),
        queryFn: () => api.sequences(id),
        refetchInterval: status === undefined || status === "running" ? 2_000 : (false as const),
      };
    }),
  });
  const artQs = useQueries({
    queries: runIds.map((id) => ({ queryKey: qk.artifacts(id), queryFn: () => api.artifactsForRun(id) })),
  });
  const key = [...seqQs, ...artQs].map((q) => q.dataUpdatedAt).join("|");
  const metrics = useMemo(
    () =>
      mergeRunMetrics(
        runIds.map((runId, i) => ({
          runId,
          sequences: seqQs[i]?.data?.sequences ?? [],
          artifactNames: (artQs[i]?.data?.named ?? []).map((a) => a.name),
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), key],
  );
  return {
    metrics,
    loading: seqQs.some((q) => q.isLoading),
    error: seqQs.find((q) => q.isError)?.error ?? null,
  };
}
