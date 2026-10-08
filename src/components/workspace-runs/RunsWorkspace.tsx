/**
 * A runs workspace: the runs sidebar (RunsSidebar.tsx, the Runs page's
 * table with the Name column and eyes) next to the same `WorkspaceView`
 * the run page renders, both bound to the project's current view, over
 * the project's runs. The run state is part of the view's document, so it
 * saves like layout edits and switching views switches it too. A group's
 * name filters the workspace to it (visibility.ts `filterToGroup`).
 *
 * The cards get the visible runs (lib/workspace-runs/visibility.ts). When
 * grouped the page also provides the grouping
 * (lib/workspace-runs/grouping-context.ts): scalar cards draw one line per
 * innermost group (`group: exp-44, jobType: train`). A run
 * hover store (lib/workspace-runs/hover.ts) links sidebar rows and chart
 * lines. A run opened from the sidebar shows a "← Workspace" link back
 * (lib/run-nav.ts); the sidebar's collapsed groups and scroll are kept for
 * the session, the run state is the view's.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useRuns } from "../../api/hooks";
import RunsSidebar, { type RunStateEdit } from "./RunsSidebar";
import { useRunsTable } from "../runs-table/use-runs-table";
import WorkspaceView from "../workspace/WorkspaceView";
import { useElementScrollRestore } from "../../lib/use-scroll-restore";
import { WorkspaceGroupingContext, type WorkspaceGrouping } from "../../lib/workspace-runs/grouping-context";
import { RunHoverContext, RunHoverStore } from "../../lib/workspace-runs/hover";
import { cardRuns, resolveVisibility } from "../../lib/workspace-runs/visibility";
import { filterFieldsOf } from "../../lib/run-filter";
import { availableColumns } from "../../lib/runs-table/columns";
import { innermostLineOf } from "../../lib/runs-table/group";
import { firstGroupOpen } from "../../lib/runs-table/model";
import { useRunColors } from "../../lib/run-view";
import { groupLineColors } from "../../lib/run-color";
import { useProjectRunView } from "../../lib/run-view-store";
import { FROM_WORKSPACE } from "../../lib/run-nav";
import { ops } from "../../lib/workspace/doc";
import type { WorkspaceRef } from "../../lib/workspace/ref";
import { useWorkspace } from "../../lib/workspace/use-workspace";

/** The runs the sidebar lists from (the runs route's cap). */
const RUNS_LIMIT = 1000;
const NO_COMPUTED: never[] = [];

export default function RunsWorkspace({ wsRef }: { wsRef: WorkspaceRef }) {
  const projectId = wsRef.projectId;
  const { doc, update } = useWorkspace(wsRef);
  const state = doc.runState;
  // Archived too (Status › archived); params and stats: the filter and group-by read them (as in the runs table).
  const runsQ = useRuns({
    project: projectId,
    limit: RUNS_LIMIT,
    include: ["params", "stats"],
  });
  const runs = useMemo(() => runsQ.data?.runs ?? [], [runsQ.data]);
  const runView = useProjectRunView(projectId);

  const filterFields = useMemo(() => filterFieldsOf(runs), [runs]);
  const paramKeys = useMemo(
    () => filterFields.filter((f) => f.startsWith("params.")).map((f) => f.slice("params.".length)),
    [filterFields],
  );
  const sortColumns = useMemo(() => availableColumns(runs, NO_COMPUTED).filter((c) => c !== "tags"), [runs]);

  const table = useRunsTable({
    runs,
    status: state.status,
    search: state.search,
    filter: state.filter,
    latestOnly: state.latestOnly,
    groupBy: state.groupBy,
    sort: state.sort,
    computed: NO_COMPUTED,
    pinned: runView.view.pinned,
    pinnedAlwaysListed: true,
    defaultCollapsed: firstGroupOpen,
    collapsedKey: `workspace:${projectId}`,
  });
  const visibility = useMemo(() => resolveVisibility(table.sorted, table.groups, state.eyes), [table.sorted, table.groups, state.eyes]);
  const cards = useMemo(() => cardRuns(table.sorted, table.groups, visibility.runs), [table.sorted, table.groups, visibility.runs]);
  // Grouped: scalar cards draw one line per innermost group; not grouped: one per run.
  const grouped = state.groupBy.length > 0;
  const groupColors = useMemo(
    () => groupLineColors(table.groups ? [...new Set(innermostLineOf(table.groups).values())] : []),
    [table.groups],
  );
  const grouping = useMemo<WorkspaceGrouping | null>(
    () => (grouped ? { groupOf: cards.groupOf, colorOf: groupColors } : null),
    [grouped, cards.groupOf, groupColors],
  );
  const colors = useRunColors(cards.runIds);
  const [hover] = useState(() => new RunHoverStore());

  const edit = useCallback<RunStateEdit>(
    (fn, label, mergeKey) => update(ops.updateRunState(fn), { label, mergeKey }),
    [update],
  );

  // Only phones toggle the sidebar (it is always shown from md up).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  useElementScrollRestore(sidebarRef, `workspace-sidebar:${projectId}`, runs.length > 0);

  return (
    <RunHoverContext.Provider value={hover}>
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
              sortColumns={sortColumns}
              colors={colors}
              groupOf={grouping ? cards.groupOf : null}
              groupColors={groupColors}
              runView={runView}
              runLinkState={FROM_WORKSPACE}
              runs={runs}
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
    </RunHoverContext.Provider>
  );
}
