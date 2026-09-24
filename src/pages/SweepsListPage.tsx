import { Link, useParams } from "react-router-dom";
import { useSweeps } from "../api/hooks";
import type { Sweep } from "../api/types";
import { formatRelative } from "../lib/format";
import { formatParamValue } from "../lib/sweeps";
import SweepStatusBadge from "../components/SweepStatusBadge";

function trialCounts(s: Sweep): string {
  const parts = Object.entries(s.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `${n} ${status}`);
  return parts.length > 0 ? parts.join(" · ") : "no trials";
}

function bestLabel(s: Sweep): string {
  if (!s.best || s.best.value == null) return "—";
  return formatParamValue(s.best.value);
}

/** The project's sweeps, newest first. Created with `cairn sweep create` or `cairn.sweep(...)`. */
export default function SweepsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useSweeps(projectId!);

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  const sweeps = q.data?.sweeps ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">{projectId} / sweeps</h1>
        <p className="text-sm text-fg-muted">
          {sweeps.length} sweep{sweeps.length === 1 ? "" : "s"}
        </p>
      </div>

      {sweeps.length === 0 ? (
        <div className="text-sm text-fg-muted">
          <p>No sweeps in this project yet. Create one from a sweep.yaml and run an agent:</p>
          <pre className="mono mt-2 overflow-x-auto rounded border border-border bg-bg-elevated p-3 text-xs text-fg">
            {"cairn sweep create sweep.yaml\ncairn agent <sweep_id>"}
          </pre>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {sweeps.map((s) => (
              <li key={s.id} className="rounded-lg border border-border bg-bg-elevated p-3">
                <div className="flex items-center gap-2">
                  <Link to={`/p/${projectId}/sweeps/${s.id}`} className="mono flex-1 truncate text-accent hover:underline">
                    {s.name || s.id}
                  </Link>
                  <SweepStatusBadge status={s.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span>{s.method}</span>
                  <span>{trialCounts(s)}</span>
                  {s.metric && <span className="mono">best {s.metric} {bestLabel(s)}</span>}
                  <span>{formatRelative(s.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Sweep</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Metric</th>
                  <th className="px-3 py-2 text-right">Best</th>
                  <th className="px-3 py-2">Trials</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {sweeps.map((s) => (
                  <tr key={s.id} className="border-t border-border-subtle hover:bg-bg-elevated">
                    <td className="px-3 py-2">
                      <Link to={`/p/${projectId}/sweeps/${s.id}`} className="mono text-accent hover:underline">
                        {s.name || s.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2"><SweepStatusBadge status={s.status} /></td>
                    <td className="px-3 py-2 text-fg-muted">{s.method}</td>
                    <td className="mono px-3 py-2 text-fg-muted">
                      {s.metric ? `${s.metric} (${s.goal === "maximize" ? "max" : "min"})` : "—"}
                    </td>
                    <td className="mono num px-3 py-2 text-right">{bestLabel(s)}</td>
                    <td className="px-3 py-2 text-fg-muted">{trialCounts(s)}</td>
                    <td className="px-3 py-2 text-fg-muted">{formatRelative(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
