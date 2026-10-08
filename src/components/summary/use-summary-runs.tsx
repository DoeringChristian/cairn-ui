/**
 * What the Summary cards (ScalarsCard, ConfigCard) share: the shown runs'
 * details as table runs, the workspace grouping, and each unit's label and
 * colour dot (the charts' colours: a run's, or its group's).
 */

import { useContext, useMemo } from "react";
import { useRunsDetails } from "../../api/hooks";
import type { RunDetailResponse } from "../../api/types";
import { disambiguateRunLabels, useRunMetadataVersion } from "../../lib/run-label";
import { useRunColors, useVisibleRuns } from "../../lib/run-view";
import { tableRunOf, type TableRun, type Unit } from "../../lib/summary-tables";
import { WorkspaceGroupingContext } from "../../lib/workspace-runs/grouping-context";

export interface SummaryRuns {
  /** The shown runs, in order. */
  runIds: string[];
  runs: TableRun[];
  loading: boolean;
  /** The workspace's grouping (run → innermost group line), null when not grouped. */
  groupOf: ReadonlyMap<string, string> | null;
  labelOf: (u: Unit) => string;
  colorOf: (u: Unit) => string | undefined;
}

export function useSummaryRuns(allRunIds: readonly string[]): SummaryRuns {
  const runIds = useVisibleRuns(allRunIds);
  const colors = useRunColors(runIds);
  const grouping = useContext(WorkspaceGroupingContext);
  const queries = useRunsDetails(runIds);
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const runs = useMemo(
    () => queries.map((q) => q.data).filter((d): d is RunDetailResponse => d != null).map(tableRunOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey, runIds.join("|")],
  );
  const metaVersion = useRunMetadataVersion();
  const labels = useMemo(
    () => disambiguateRunLabels(runIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), metaVersion],
  );
  return {
    runIds,
    runs,
    loading: queries.some((q) => q.isLoading),
    groupOf: grouping?.groupOf ?? null,
    labelOf: (u) => (u.kind === "group" ? u.group : (labels[u.runId] ?? u.runId.slice(0, 6))),
    colorOf: (u) => (u.kind === "group" ? grouping?.colorOf.get(u.group) : colors.get(u.runId)),
  };
}

/** A unit's colour dot and label. */
export function UnitLabel({ label, color }: { label: string; color: string | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? "transparent" }} />
      {label}
    </span>
  );
}

/** An empty (`—`) or mixed cell. */
export function EmptyCell({ mixed }: { mixed?: boolean }) {
  return mixed ? (
    <span className="italic text-fg-subtle" title="The group's runs differ">
      mixed
    </span>
  ) : (
    <span className="text-fg-subtle">—</span>
  );
}
