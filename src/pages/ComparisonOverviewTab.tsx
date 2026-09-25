import { useMemo, useState } from "react";
import { useRunsDetails } from "../api/hooks";
import type { Run, RunDetailResponse } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import EnvDiffTable from "../components/run-compare/EnvDiffTable";
import MetricsSummaryTable from "../components/run-compare/MetricsSummaryTable";
import ParamsDiffTable from "../components/run-compare/ParamsDiffTable";
import { formatDuration, safeJsonParse } from "../lib/format";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../lib/run-label";
import { useRunColors } from "../lib/run-view";

interface Props {
  compRunIds: string[];
}

export default function ComparisonOverviewTab({ compRunIds }: Props) {
  const [onlyDiffs, setOnlyDiffs] = useState(true);

  const queries = useRunsDetails(compRunIds);

  const loading = queries.some((q) => q.isLoading);
  const runData = useMemo(
    () =>
      queries
        .map((q) => q.data)
        .filter((d): d is RunDetailResponse => d != null),
    [queries],
  );

  // Recompute labels when the run metadata cache is seeded (api/hooks.ts).
  const metaVersion = useRunMetadataVersion();
  const labels = useMemo(
    () => disambiguateRunLabels(compRunIds),
    [compRunIds, metaVersion],
  );

  const colors = useRunColors(compRunIds);
  const [metricFilter, setMetricFilter] = useState("");

  if (loading) return <p className="text-fg-muted">Loading run details...</p>;
  if (runData.length === 0)
    return <p className="text-fg-muted">No runs in this comparison.</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* Global control bar */}
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={onlyDiffs}
            onChange={(e) => setOnlyDiffs(e.target.checked)}
          />
          Only show differences
        </label>
      </div>

      {/* Run summary cards */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Runs ({compRunIds.length})
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runData.map((rd) => (
            <RunSummaryCard
              key={rd.run.id}
              run={rd.run}
              label={labels[rd.run.id] ?? shortRunId(rd.run.id)}
            />
          ))}
        </div>
      </section>

      {/* Final metric values per run, red/green by which is better. */}
      <MetricsSummaryTable
        runs={runData}
        labels={labels}
        colors={colors}
        onlyDiffs={onlyDiffs}
        filter={metricFilter}
        actions={
          <input
            type="text"
            value={metricFilter}
            onChange={(e) => setMetricFilter(e.target.value)}
            placeholder="Filter metrics..."
            className="input w-40 text-xs"
          />
        }
      />

      <ParamsDiffTable runs={runData} labels={labels} colors={colors} onlyDiffs={onlyDiffs} />

      <EnvDiffTable runs={runData} labels={labels} colors={colors} onlyDiffs={onlyDiffs} />

    </div>
  );
}

function RunSummaryCard({ run, label }: { run: Run; label: string }) {
  const tags = safeJsonParse<string[]>(run.tags) ?? [];
  return (
    <div className="card p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="mono font-semibold truncate">{label}</span>
        <RunStatusBadge status={run.status} />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-muted">Branch</dt>
        <dd className="mono text-fg truncate">{run.git_branch ?? "—"}</dd>
        <dt className="text-fg-muted">Commit</dt>
        <dd className="mono text-fg">{run.git_sha?.slice(0, 10) ?? "—"}</dd>
        <dt className="text-fg-muted">Duration</dt>
        <dd className="mono text-fg">{formatDuration(run.created_at, run.ended_at)}</dd>
        {tags.length > 0 && (
          <>
            <dt className="text-fg-muted">Tags</dt>
            <dd className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="mono rounded border border-border-subtle px-1 py-0 text-[10px] text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
