import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { MetricInfo } from "../../lib/workspace/layout";
import { mergeRunMetrics } from "../../lib/workspace/metrics";
import { summaryPresenceOf } from "../../lib/summary-tables";
import type { RunSummaryPresence } from "../../lib/workspace/summary-cards";

/**
 * The metrics the bound runs log (sequences + the artifacts they produced), merged by
 * name. A running run's roster is polled, so a metric first logged mid-run
 * gets its panel. Also what each run has for the Summary cards (`presence`).
 */
export function useWorkspaceMetrics(runIds: readonly string[]): {
  metrics: MetricInfo[];
  presence: RunSummaryPresence[];
  loading: boolean;
  error: unknown;
} {
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
    queries: runIds.map((id) => ({ queryKey: qk.runOutputArtifacts(id), queryFn: () => api.runOutputArtifacts(id) })),
  });
  const key = [...seqQs, ...artQs].map((q) => q.dataUpdatedAt).join("|");
  const metrics = useMemo(
    () =>
      mergeRunMetrics(
        runIds.map((runId, i) => ({
          runId,
          sequences: seqQs[i]?.data?.sequences ?? [],
          // A custom viewer the run published (`run.use_viewer`) is code for cards, not an output to show.
          artifactNames: (artQs[i]?.data?.outputs ?? []).filter((a) => a.type !== "cairn-viewer").map((a) => a.name),
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), key],
  );
  const runKey = runQs.map((q) => q.dataUpdatedAt).join("|");
  const presence = useMemo(
    () => runQs.flatMap((q) => (q.data ? [summaryPresenceOf(q.data)] : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), runKey],
  );
  return {
    metrics,
    presence,
    loading: seqQs.some((q) => q.isLoading),
    error: seqQs.find((q) => q.isError)?.error ?? null,
  };
}
