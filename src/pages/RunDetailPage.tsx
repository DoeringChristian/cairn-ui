import { NavLink, Outlet, useParams } from "react-router-dom";
import { useRun, useStopRun } from "../api/hooks";
import type { Run } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import RunAlertBanners from "../components/alerts/RunAlertBanners";
import { formatDuration, formatRelative } from "../lib/format";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics & Media" },
  { id: "logs", label: "Logs" },
  { id: "source", label: "Source" },
  { id: "env", label: "Environment" },
];

export default function RunDetailPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const q = useRun(runId!);

  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  if (!q.data) return null;
  const run = q.data.run;

  if (!projectId) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">
          {run.display_name ?? run.id}
        </h1>
        <RunStatusBadge status={run.status} />
        {run.status === "running" && <StopButton run={run} />}
        {run.display_name ? (
          <span className="mono break-all text-xs text-fg-subtle">{run.id}</span>
        ) : null}
        <span className="ml-auto text-xs text-fg-muted">
          Started {formatRelative(run.created_at)} · Duration{" "}
          <span className="mono num">{formatDuration(run.created_at, run.ended_at)}</span>
        </span>
      </div>
      <RunAlertBanners projectId={projectId} runId={run.id} />
      <nav className="mb-6 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={t.id}
            end={t.id === "overview"}
            className={({ isActive }) =>
              [
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ run, params: q.data.params }} />
    </div>
  );
}

function StopButton({ run }: { run: Run }) {
  const stop = useStopRun(run.id);
  const requested = !!run.stop_requested || stop.isSuccess;
  return (
    <button
      type="button"
      className="btn px-2 py-0.5 text-xs"
      disabled={requested || stop.isPending}
      title="Ask the run to stop; it sees the request on its next heartbeat"
      onClick={() => {
        if (confirm(`Stop run ${run.display_name ?? run.id}?`)) stop.mutate();
      }}
    >
      {requested ? "stopping…" : "Stop"}
      {stop.isError && <span className="ml-1 text-status-failed">failed</span>}
    </button>
  );
}
