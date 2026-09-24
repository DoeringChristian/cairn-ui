import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { useRun } from "../api/hooks";
import RunStatusBadge from "../components/RunStatusBadge";
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
        {run.display_name ? (
          <span className="mono break-all text-xs text-fg-subtle">{run.id}</span>
        ) : null}
        {run.parent_run_id ? (
          <ForkedFrom
            projectId={projectId}
            parentId={run.parent_run_id}
            step={run.fork_step}
          />
        ) : null}
        <span className="ml-auto text-xs text-fg-muted">
          Started {formatRelative(run.created_at)} · Duration{" "}
          <span className="mono num">{formatDuration(run.created_at, run.ended_at)}</span>
        </span>
      </div>
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

/** "forked from <parent> @ step k", linking to the parent run. */
function ForkedFrom({
  projectId,
  parentId,
  step,
}: {
  projectId: string;
  parentId: string;
  step: number | null;
}) {
  // The parent may have been deleted since; the link then shows its id.
  const parent = useRun(parentId);
  const label = parent.data?.run.display_name ?? parentId.slice(0, 8);
  return (
    <span className="text-xs text-fg-muted">
      forked from{" "}
      <Link
        to={`/p/${projectId}/r/${parentId}`}
        className="mono text-accent hover:underline"
        title={parentId}
      >
        {label}
      </Link>
      {step != null ? (
        <>
          {" "}@ step <span className="mono num">{step}</span>
        </>
      ) : null}
    </span>
  );
}
