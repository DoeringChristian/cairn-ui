import { useMemo } from "react";
import { useSequences } from "../../api/hooks";
import { shortRunLabel, useRunMetadataVersion } from "../../lib/run-label";
import { useRunColors, useVisibleRuns } from "../../lib/run-view";
import { limitRuns } from "../../lib/media/panel-layout";
import { seriesKey } from "../../lib/series-utils";
import { useRunInfo } from "./use-run-info";

export interface MediaPanes<T> {
  /** The series shown: hidden runs dropped, pinned runs first, at most `maxRuns` runs. */
  shown: T[];
  /** `seriesKey` per shown series. */
  keys: string[];
  /** Run id per shown series. */
  runIds: string[];
  /** Distinct runs of every series (before hiding / limiting), for labels and run info. */
  allRunIds: string[];
  multiRun: boolean;
  /** Run label per key (only when several runs are shown). */
  labels: Map<string, string>;
  /** Run colour per run id. */
  colors: Map<string, string>;
}

/**
 * The panes of a multi-run media card: its series filtered by the scope's
 * run view (hidden / pinned, see lib/run-view.tsx), limited to `maxRuns`
 * runs, with run labels and run colours.
 */
export function useMediaPanes<T extends { runId?: string; name: string }>(
  series: readonly T[],
  fallbackRunId: string,
  maxRuns: number,
): MediaPanes<T> {
  const allRunIds = useMemo(
    () => [...new Set(series.map((s) => s.runId ?? fallbackRunId))],
    [series, fallbackRunId],
  );
  useRunInfo(allRunIds);
  const runMetaVersion = useRunMetadataVersion();
  const visibleRuns = useVisibleRuns(allRunIds);
  const colors = useRunColors(allRunIds);
  return useMemo(() => {
    const order = new Map(visibleRuns.map((r, i) => [r, i]));
    const runOf = (s: T) => s.runId ?? fallbackRunId;
    const visible = series
      .filter((s) => order.has(runOf(s)))
      // Pinned runs first; a stable sort keeps each run's series in order.
      .sort((a, b) => order.get(runOf(a))! - order.get(runOf(b))!);
    const shown = limitRuns(visible, runOf, maxRuns);
    const runIds = shown.map(runOf);
    const multiRun = new Set(runIds).size > 1;
    const keys = shown.map((s) => seriesKey({ runId: runOf(s), name: s.name }));
    const labels = new Map<string, string>();
    if (multiRun) keys.forEach((k, i) => labels.set(k, shortRunLabel(runIds[i]!, allRunIds)));
    return { shown, keys, runIds, allRunIds, multiRun, labels, colors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, fallbackRunId, maxRuns, visibleRuns, allRunIds, colors, runMetaVersion]);
}

/** Names of the scalar metrics `runId` logs (slider key candidates). */
export function useScalarMetricNames(runId: string): string[] {
  const { data } = useSequences(runId);
  return useMemo(
    () => (data?.sequences ?? []).filter((s) => s.object_type === "scalar").map((s) => s.name).sort(),
    [data],
  );
}
