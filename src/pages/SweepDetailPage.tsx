import { lazy, Suspense, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useSweep, useSweepAction } from "../api/hooks";
import type { SweepAction, SweepDetail } from "../api/types";
import { formatRelative } from "../lib/format";
import { formatParamValue, isLogParam, rankTrials, searchedParams, trialParamKeys } from "../lib/sweeps";
import SweepStatusBadge from "../components/SweepStatusBadge";
import CopyId from "../components/CopyId";

const ParallelCoordsCard = lazy(() => import("../components/ParallelCoordsCard"));
const ScatterPlotCard = lazy(() => import("../components/ScatterPlotCard"));

/** The status changes a sweep in `status` accepts. */
function actionsFor(status: SweepDetail["status"]): SweepAction[] {
  if (status === "running") return ["pause", "cancel"];
  if (status === "paused") return ["resume", "cancel"];
  return [];
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="mono mt-0.5 break-all text-sm">{children}</dd>
    </div>
  );
}

/**
 * One sweep: its setup, the params-vs-metric charts over its runs (the
 * multi-run parallel-coordinates and scatter cards), and every trial.
 */
export default function SweepDetailPage() {
  const { projectId, sweepId } = useParams<{ projectId: string; sweepId: string }>();
  const q = useSweep(sweepId!);
  const action = useSweepAction(sweepId!, projectId!);
  const sweep = q.data;

  const searched = useMemo(() => (sweep ? searchedParams(sweep.space) : []), [sweep]);
  const paramKeys = useMemo(() => (sweep ? trialParamKeys(sweep.trials, searched) : []), [sweep, searched]);
  const ranked = useMemo(() => (sweep ? rankTrials(sweep.trials, sweep.goal) : []), [sweep]);
  const runIdsKey = sweep?.trials.map((t) => t.run_id ?? "").join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runIds = useMemo(() => sweep?.trials.flatMap((t) => (t.run_id ? [t.run_id] : [])) ?? [], [runIdsKey]);

  if (!projectId || !sweepId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError || !sweep) return <p className="text-status-failed">Error: {String(q.error)}</p>;

  const settingsKey = (card: string) => ({ runId: `sweep:${sweep.id}`, metricName: card });
  const metricColumn = sweep.metric ? [{ key: sweep.metric, source: "metric" as const }] : [];
  const firstParam = searched[0] ?? paramKeys[0];

  return (
    <div>
      <Link to={`/p/${projectId}/sweeps`} className="mb-2 inline-block text-xs text-fg-muted hover:text-fg">
        {"\u2039"} Sweeps
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">{sweep.name || sweep.id}</h1>
        <SweepStatusBadge status={sweep.status} />
        <CopyId id={sweep.id} />
        <div className="ml-auto flex gap-2">
          {actionsFor(sweep.status).map((a) => (
            <button
              key={a}
              type="button"
              disabled={action.isPending}
              onClick={() => action.mutate(a)}
              className={`btn text-xs ${a === "cancel" ? "text-status-failed" : ""}`}
            >
              {a[0]!.toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {action.isError && <p className="mb-2 text-sm text-status-failed">{String(action.error)}</p>}

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-bg-elevated p-4 md:grid-cols-4">
        <Fact label="Method">{sweep.method}</Fact>
        <Fact label="Metric">{sweep.metric ? `${sweep.metric} (${sweep.goal})` : "—"}</Fact>
        <Fact label="Best">
          {sweep.best?.value != null ? (
            <>
              {formatParamValue(sweep.best.value)}
              {sweep.best.run_id && (
                <Link to={`/p/${projectId}/r/${sweep.best.run_id}`} className="ml-2 text-accent hover:underline">
                  run
                </Link>
              )}
            </>
          ) : "—"}
        </Fact>
        <Fact label="Trials">
          {sweep.trial_count}
          {Object.keys(sweep.counts).length > 0 &&
            ` (${Object.entries(sweep.counts).map(([s, n]) => `${n} ${s}`).join(", ")})`}
        </Fact>
        <div className="col-span-2 md:col-span-4">
          <Fact label="Command">{sweep.command ?? "(in-process: cairn.sweep(...).run(fn))"}</Fact>
        </div>
        <div className="col-span-2 md:col-span-4">
          <Fact label="Agent">{`cairn agent ${sweep.id}`}</Fact>
        </div>
      </dl>

      {runIds.length > 0 && (
        <Suspense fallback={<div className="mb-6 h-64 motion-safe:animate-pulse rounded bg-bg-hover" />}>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-6">
            <ParallelCoordsCard
              runIds={runIds}
              settingsKey={settingsKey("__sweep_parallel")}
              defaults={{
                colSpan: 4,
                title: "Params → metric",
                columns: [
                  ...searched.map((key) => ({ key, source: "param" as const, log: isLogParam(sweep.space, key) })),
                  ...metricColumn,
                ],
              }}
            />
            <ScatterPlotCard
              runIds={runIds}
              settingsKey={settingsKey("__sweep_scatter")}
              defaults={{
                colSpan: 2,
                xAxis: firstParam ? { key: firstParam, source: "param" } : null,
                xLog: firstParam ? isLogParam(sweep.space, firstParam) : false,
                yAxis: sweep.metric ? { key: sweep.metric, source: "metric" } : null,
              }}
            />
          </div>
        </Suspense>
      )}

      <h2 className="mb-2 text-sm font-semibold text-fg-muted">
        Trials{sweep.metric ? `, best ${sweep.metric} first` : ""}
      </h2>
      {ranked.length === 0 ? (
        <p className="text-sm text-fg-muted">No trials yet. Start an agent to run some.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">Trial</th>
                <th className="px-3 py-2">Status</th>
                {sweep.metric && <th className="px-3 py-2 text-right">{sweep.metric}</th>}
                {paramKeys.map((k) => (
                  <th key={k} className="mono px-3 py-2 normal-case">{k}</th>
                ))}
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((t) => (
                <tr
                  key={t.id}
                  className={`border-t border-border-subtle hover:bg-bg-elevated ${t.id === sweep.best?.id ? "bg-accent/5" : ""}`}
                >
                  <td className="mono px-3 py-2 text-fg-muted">{t.id.slice(0, 8)}</td>
                  <td className="px-3 py-2"><SweepStatusBadge status={t.status} /></td>
                  {sweep.metric && (
                    <td className="mono num px-3 py-2 text-right">{t.value != null ? formatParamValue(t.value) : "—"}</td>
                  )}
                  {paramKeys.map((k) => (
                    <td key={k} className="mono num px-3 py-2">{formatParamValue(t.params[k])}</td>
                  ))}
                  <td className="px-3 py-2">
                    {t.run_id ? (
                      <Link to={`/p/${projectId}/r/${t.run_id}`} className="mono text-accent hover:underline">
                        {t.run_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">{"—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatRelative(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
