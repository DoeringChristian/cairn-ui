import { useMemo, useState } from "react";
import { useRunsDetails } from "../api/hooks";
import type { Run, RunDetailResponse } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import { formatDuration, safeJsonParse } from "../lib/format";
import { formatNum } from "../lib/plot-utils/types";
import { summaryRuleFor } from "../lib/metric-defs";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../lib/run-label";
import { computeCellStatuses, diffCellClassName, isNumericSeries, toNumeric } from "../lib/table-diff";

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

  // Build param diff table: key → { runId → value }
  const { paramKeys, paramMap, differingKeys } = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const rd of runData) {
      for (const p of rd.params) {
        let row = map.get(p.key);
        if (!row) {
          row = new Map();
          map.set(p.key, row);
        }
        row.set(rd.run.id, p.value);
      }
    }
    const keys = Array.from(map.keys()).sort();
    const differing = new Set<string>();
    for (const [key, row] of map) {
      const vals = Array.from(row.values());
      if (vals.length < compRunIds.length || vals.some((v) => v !== vals[0])) {
        differing.add(key);
      }
    }
    return { paramKeys: keys, paramMap: map, differingKeys: differing };
  }, [runData, compRunIds]);

  // Environment diff
  const envRows = useMemo(() => {
    const fields = ["python_version", "platform", "cuda_available", "cuda_version", "gpu_names"] as const;
    const rows: Array<{ key: string; values: Map<string, string>; differs: boolean }> = [];
    for (const field of fields) {
      const values = new Map<string, string>();
      for (const rd of runData) {
        const env = safeJsonParse<Record<string, unknown>>(rd.run.env_snapshot);
        let val = "—";
        if (env) {
          const raw = env[field];
          if (field === "gpu_names" && Array.isArray(raw)) {
            val = raw.length > 0 ? (raw as string[]).join(", ") : "—";
          } else if (field === "cuda_available") {
            val = raw ? `yes (${env.cuda_version ?? "?"})` : "no";
          } else if (raw != null) {
            val = String(raw);
          }
        }
        values.set(rd.run.id, val);
      }
      const vals = Array.from(values.values());
      rows.push({ key: field.replace(/_/g, " "), values, differs: vals.some((v) => v !== vals[0]) });
    }
    return rows;
  }, [runData]);

  if (loading) return <p className="text-fg-muted">Loading run details...</p>;
  if (runData.length === 0)
    return <p className="text-fg-muted">No runs in this comparison.</p>;

  const displayKeys = onlyDiffs
    ? paramKeys.filter((k) => differingKeys.has(k))
    : paramKeys;

  const displayEnvRows = onlyDiffs ? envRows.filter((r) => r.differs) : envRows;

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
      <MetricsSummarySection runData={runData} labels={labels} onlyDiffs={onlyDiffs} />

      {/* Parameter diff */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Parameters ({differingKeys.size} differ{differingKeys.size === 1 ? "s" : ""})
          </h3>
        </div>
        {displayKeys.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            {paramKeys.length === 0
              ? "No parameters logged."
              : "All parameters are identical across runs."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">Key</th>
                  {runData.map((rd) => (
                    <th key={rd.run.id} className="pb-1 pr-4 whitespace-nowrap">
                      {labels[rd.run.id] ?? shortRunId(rd.run.id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayKeys.map((key) => {
                  const row = paramMap.get(key)!;
                  const differs = differingKeys.has(key);
                  const rawValues = runData.map((rd) => row.get(rd.run.id) ?? null);
                  const numeric = isNumericSeries(rawValues);
                  const statuses = numeric
                    ? computeCellStatuses(rawValues.map(toNumeric))
                    : null;
                  return (
                    <tr
                      key={key}
                      className={`border-t border-border-subtle ${
                        differs ? "bg-accent/5" : ""
                      }`}
                    >
                      <td
                        className={`mono py-1 pr-4 sticky left-0 ${
                          differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                        }`}
                      >
                        {key}
                      </td>
                      {runData.map((rd, i) => {
                        const diffCls = statuses ? diffCellClassName(statuses[i]!) : "";
                        return (
                          <td
                            key={rd.run.id}
                            className={`mono py-1 pr-4 whitespace-nowrap text-fg-muted ${diffCls}`}
                          >
                            {row.get(rd.run.id) ?? "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Environment diff */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Environment
        </h3>
        {displayEnvRows.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            Environment is identical across runs.
          </p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">Field</th>
                {runData.map((rd) => (
                  <th key={rd.run.id} className="pb-1 pr-4 whitespace-nowrap">
                    {labels[rd.run.id] ?? shortRunId(rd.run.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayEnvRows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-t border-border-subtle ${
                    row.differs ? "bg-accent/5" : ""
                  }`}
                >
                  <td
                    className={`py-1 pr-4 text-fg-muted sticky left-0 ${
                      row.differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                    }`}
                  >
                    {row.key}
                  </td>
                  {runData.map((rd) => (
                    <td key={rd.run.id} className="mono py-1 pr-4 text-fg-muted whitespace-nowrap">
                      {row.values.get(rd.run.id) ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary metrics section
// ---------------------------------------------------------------------------

interface MetricsSummaryProps {
  runData: RunDetailResponse[];
  labels: Record<string, string>;
  onlyDiffs: boolean;
}

/**
 * Each run's final metric values side by side (columns = runs, rows =
 * metrics): the same values the runs table shows (`run.values`: a scalar's
 * last point, a `define_metric(summary=...)` rule's value, or an explicit
 * `run.summary(...)` key).
 *
 * Cells are coloured green for the best run and red for the worst. A metric
 * whose rule is "min" counts lower as better; any other metric counts higher
 * as better. `system.*` sampler metrics are hidden. Obeys the overview's
 * "only show differences" toggle.
 */
function MetricsSummarySection({ runData, labels, onlyDiffs }: MetricsSummaryProps) {
  const [filter, setFilter] = useState("");
  const runIds = runData.map((rd) => rd.run.id);

  // metricName → runId → value, plus whether lower is better (a "min" rule in any run).
  const { rows, lowerBetter, differing } = useMemo(() => {
    const map = new Map<string, Map<string, number | string | boolean | null>>();
    const lower = new Set<string>();
    for (const rd of runData) {
      for (const [name, v] of Object.entries(rd.run.values ?? {})) {
        if (name.startsWith("system.")) continue;
        let row = map.get(name);
        if (!row) { row = new Map(); map.set(name, row); }
        row.set(rd.run.id, v);
        if (summaryRuleFor(name, rd.metric_defs) === "min") lower.add(name);
      }
    }
    const diff = new Set<string>();
    for (const [name, row] of map) {
      const vals = runData.map((rd) => row.get(rd.run.id));
      if (vals.some((v) => v == null) || vals.some((v) => v !== vals[0])) diff.add(name);
    }
    return { rows: map, lowerBetter: lower, differing: diff };
  }, [runData]);

  const q = filter.trim().toLowerCase();
  const displayNames = Array.from(rows.keys())
    .sort()
    .filter((name) => (onlyDiffs ? differing.has(name) : true))
    .filter((name) => (q ? name.toLowerCase().includes(q) : true));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Metrics ({differing.size} differ{differing.size === 1 ? "s" : ""})
        </h3>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter metrics..."
          className="input w-40 text-xs"
        />
      </div>
      {displayNames.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          {rows.size === 0
            ? "No metrics logged."
            : onlyDiffs
              ? "All metrics are identical across runs."
              : "No matching metrics."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">Metric</th>
                {runData.map((rd) => (
                  <th key={rd.run.id} className="pb-1 pr-4 whitespace-nowrap">
                    {labels[rd.run.id] ?? shortRunId(rd.run.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayNames.map((name) => {
                const row = rows.get(name)!;
                const differs = differing.has(name);
                const vals = runIds.map((rid) => row.get(rid) ?? null);
                const numeric = isNumericSeries(vals);
                const statuses = numeric ? computeCellStatuses(vals.map(toNumeric)) : null;
                const lower = lowerBetter.has(name);
                return (
                  <tr
                    key={name}
                    className={`border-t border-border-subtle ${differs ? "bg-accent/5" : ""}`}
                  >
                    <td
                      className={`mono py-1 pr-4 sticky left-0 ${
                        differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                      }`}
                    >
                      {name}
                      {lower && (
                        <span className="ml-1.5 text-[10px] text-fg-subtle" title='define_metric(summary="min"): lower is better'>
                          ↓
                        </span>
                      )}
                    </td>
                    {runData.map((rd, i) => {
                      const v = vals[i];
                      const diffCls = statuses && v != null ? diffCellClassName(statuses[i]!, lower) : "";
                      return (
                        <td
                          key={rd.run.id}
                          className={`mono py-1 pr-4 whitespace-nowrap tabular-nums text-fg-muted ${diffCls}`}
                        >
                          {v == null ? "—" : typeof v === "number" ? formatNum(v) : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
