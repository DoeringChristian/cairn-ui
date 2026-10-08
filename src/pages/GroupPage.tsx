/**
 * /p/:projectId/g/:group — a run group's page (wandb's group workspace):
 * the Workspace tab (index) is the project workspace's runs sidebar and
 * cards restricted to the group's runs, with the group's own run state
 * (not grouped by default) and the project's current view as the layout;
 * the Runs tab (`runs`) is the Runs page's table over the group's runs.
 * The breadcrumb (`Projects › selections › exp-44`) and the group's
 * summary (`GroupSummary`: `group · 5 runs · last run 2h ago`) are in
 * ProjectLayout.
 */

import { useMemo } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { useRuns } from "../api/hooks";
import RunsWorkspace from "../components/workspace-runs/RunsWorkspace";
import { formatRelative } from "../lib/format";
import { refKey, viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";
import RunsTablePage from "./RunsTablePage";

const TABS = [
  { to: "", label: "Workspace", end: true },
  { to: "runs", label: "Runs", end: false },
];

/** The route's group (decoded by the router). */
function useGroup(): { projectId: string; group: string } | null {
  const { projectId, group } = useParams<{ projectId: string; group: string }>();
  return projectId && group != null ? { projectId, group } : null;
}

export default function GroupPage() {
  const g = useGroup();
  if (!g) return null;
  return (
    <div>
      <nav className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              [
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

/** The Workspace tab: the group's runs in the project's current view. */
export function GroupWorkspaceTab() {
  const g = useGroup();
  const current = useViews(g?.projectId ?? null).data?.current ?? null;
  const wsRef = useMemo(() => (g && current ? viewRef(g.projectId, current) : null), [g?.projectId, current]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g || !wsRef) return null;
  // Another view or group mounts fresh.
  return <RunsWorkspace key={`${refKey(wsRef)}|${g.group}`} wsRef={wsRef} group={g.group} />;
}

/** The Runs tab: the Runs page's table over the group's runs. */
export function GroupRunsTab() {
  const g = useGroup();
  if (!g) return null;
  return <RunsTablePage key={g.group} group={g.group} />;
}

/** `group · 5 runs · last run 2h ago` (archived runs not counted), beside the breadcrumb. */
export function GroupSummary({ projectId, group }: { projectId: string; group: string }) {
  const q = useRuns({ project: projectId, group, archived: "false", limit: 1000 });
  const runs = q.data?.runs;
  if (!runs) return null;
  const last = runs.reduce((m, r) => (r.created_at > m ? r.created_at : m), "");
  return (
    <span className="text-xs text-fg-muted" data-testid="group-summary">
      group · {runs.length} run{runs.length === 1 ? "" : "s"}
      {last ? ` · last run ${formatRelative(last)}` : ""}
    </span>
  );
}
