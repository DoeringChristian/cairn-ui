/**
 * /p/:projectId/workspace — the project workspace: a runs sidebar
 * (components/workspace-runs/RunsSidebar.tsx, the Runs page's table with
 * the Name column and eyes) next to the same `WorkspaceView` the run page
 * renders, both bound to the project's current view. The sidebar's run
 * state (status, search, filter, grouping, latest only, eyes) is part of
 * that view's document, so it saves like layout edits and switching views
 * switches it too.
 *
 * The cards get the visible runs (lib/workspace-runs/visibility.ts). When
 * grouped the page also provides the grouping
 * (lib/workspace-runs/grouping-context.ts): scalar cards draw one line per
 * top-level group, runs without a group value stay their own lines.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useRuns } from "../api/hooks";
import RunsSidebar, { type RunStateEdit } from "../components/workspace-runs/RunsSidebar";
import { useRunsTable } from "../components/runs-table/use-runs-table";
import WorkspaceView from "../components/workspace/WorkspaceView";
import { useProjectId } from "../lib/project-context";
import { useElementScrollRestore } from "../lib/use-scroll-restore";
import { WorkspaceGroupingContext, type WorkspaceGrouping } from "../lib/workspace-runs/grouping-context";
import { cardRuns, resolveVisibility } from "../lib/workspace-runs/visibility";
import { filterFieldsOf } from "../lib/run-filter";
import type { RunGroupNode } from "../lib/runs-table/group";
import { editProject, projectRunState } from "../lib/workspace-runs/state";
import { useRunColors } from "../lib/run-view";
import { ops } from "../lib/workspace/doc";
import { refKey, viewRef, type WorkspaceRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";
import { useWorkspace } from "../lib/workspace/use-workspace";

/** The project's runs the sidebar lists from (the runs route's cap). */
const RUNS_LIMIT = 1000;
const NO_COMPUTED: never[] = [];
const NO_PINNED: string[] = [];
/** The first top-level group and the no-value group start open, the other top-level groups collapsed. */
const firstGroupOpen = (n: RunGroupNode, i: number) => n.depth === 0 && i > 0 && n.label != null;

export default function WorkspacePage() {
  const projectId = useProjectId();
  const current = useViews(projectId).data?.current ?? null;
  const wsRef = useMemo(() => (projectId && current ? viewRef(projectId, current) : null), [projectId, current]);
  if (!wsRef) return null;
  // Switching views is navigation: the new view mounts fresh.
  return <Workspace key={refKey(wsRef)} wsRef={wsRef} />;
}

function Workspace({ wsRef }: { wsRef: WorkspaceRef }) {
  const projectId = wsRef.projectId;
  const { doc, update } = useWorkspace(wsRef);
  const state = useMemo(() => projectRunState(doc.runState), [doc.runState]);
  // Archived too (Status › archived); params and stats: the filter and group-by read them (as in the runs table).
  const runsQ = useRuns({ project: projectId, limit: RUNS_LIMIT, include: ["params", "stats"] });
  const runs = useMemo(() => runsQ.data?.runs ?? [], [runsQ.data]);

  const filterFields = useMemo(() => filterFieldsOf(runs), [runs]);
  const paramKeys = useMemo(
    () => filterFields.filter((f) => f.startsWith("params.")).map((f) => f.slice("params.".length)),
    [filterFields],
  );

  const table = useRunsTable({
    runs,
    status: state.status,
    search: state.search,
    filter: state.filter,
    latestOnly: state.latestOnly,
    groupBy: state.groupBy,
    sort: state.sort,
    computed: NO_COMPUTED,
    pinned: NO_PINNED,
    defaultCollapsed: firstGroupOpen,
  });
  const visibility = useMemo(() => resolveVisibility(table.sorted, table.groups, state.eyes), [table.sorted, table.groups, state.eyes]);
  const cards = useMemo(() => cardRuns(table.sorted, table.groups, visibility.runs), [table.sorted, table.groups, visibility.runs]);
  // Grouped: scalar cards draw one line per (top-level) group; not grouped: one per run.
  const grouped = state.groupBy.length > 0;
  const grouping = useMemo<WorkspaceGrouping | null>(() => (grouped ? { groupOf: cards.groupOf } : null), [grouped, cards.groupOf]);
  const colors = useRunColors(cards.runIds);

  const edit = useCallback<RunStateEdit>(
    (fn, label, mergeKey) => update(ops.updateRunState(editProject(fn)), { label, mergeKey }),
    [update],
  );

  // Only phones toggle the sidebar (it is always shown from md up).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  useElementScrollRestore(sidebarRef, `workspace-sidebar:${projectId}`, runs.length > 0);

  return (
    <div>
      <div className="mb-3 md:hidden">
        <button type="button" onClick={() => setSidebarOpen((v) => !v)} className="btn text-xs" aria-expanded={sidebarOpen}>
          Runs ({visibility.shown} of {visibility.listed} {visibility.unit} shown) {sidebarOpen ? "▲" : "▼"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        <aside
          ref={sidebarRef}
          className={`card overflow-hidden md:sticky md:top-[var(--header-h)] md:max-h-[calc(100vh-var(--header-h))] md:overflow-y-auto ${sidebarOpen ? "" : "hidden md:block"}`}
        >
          <RunsSidebar
            projectId={projectId}
            state={state}
            table={table}
            visibility={visibility}
            fields={filterFields}
            paramKeys={paramKeys}
            colors={colors}
            onEdit={edit}
          />
        </aside>
        <main className="min-w-0">
          <WorkspaceGroupingContext.Provider value={grouping}>
            <WorkspaceView wsRef={wsRef} runIds={cards.runIds} reportLabel="workspace" />
          </WorkspaceGroupingContext.Provider>
        </main>
      </div>
    </div>
  );
}
