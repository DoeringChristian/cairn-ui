import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequenceMeta } from "../../api/types";
import { buildMetricIndex, type MetricIndex } from "./metric-index";

/**
 * Fetch + build a `MetricIndex` for a run set, so a ```cairn card with a
 * bare `metric:` field can have its type inferred.
 */
export function useMetricIndex(runIds: string[]): { index: MetricIndex; isLoading: boolean } {
  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 10_000,
    })),
  });

  const index = useMemo(
    () =>
      buildMetricIndex(
        seqQueries
          .map((q, idx) => ({ runId: runIds[idx], sequences: q.data?.sequences }))
          .filter((r): r is { runId: string; sequences: SequenceMeta[] } => !!r.runId && !!r.sequences),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), seqQueries.map((q) => q.dataUpdatedAt).join("|")],
  );
  const isLoading = seqQueries.some((q) => q.isLoading);
  return { index, isLoading };
}
