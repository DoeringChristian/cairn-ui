import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { allSummarySeries, seriesRuns, type SeriesRef } from "../../lib/media/summary-series";

/**
 * Whether every series a card shows is a summary media value (one stepless
 * value from `run.summary`, see lib/media/summary-series.ts): read from the
 * runs' catalogues, the same cached `/sequences` queries the workspace uses.
 */
export function useSummarySeries(series: readonly SeriesRef[]): boolean {
  const seriesSig = series.map((s) => `${s.runId}\u0000${s.name}`).join("\u0001");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => [...series], [seriesSig]);
  const runIds = useMemo(() => seriesRuns(stable), [stable]);
  const qs = useQueries({
    queries: runIds.map((id) => ({ queryKey: qk.sequences(id), queryFn: () => api.sequences(id) })),
  });
  const sig = qs.map((q) => q.dataUpdatedAt).join("|");
  return useMemo(() => {
    const byRun = new Map(runIds.map((id, i) => [id, qs[i]?.data?.sequences]));
    return allSummarySeries((id) => byRun.get(id), stable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, stable, runIds]);
}
