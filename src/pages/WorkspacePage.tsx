/**
 * /p/:projectId/workspace — the project workspace: a runs sidebar
 * (components/workspace-runs/RunsSidebar.tsx) next to the same
 * `WorkspaceView` the run page renders, both bound to the project's current
 * view. The sidebar's run state (search, grouping, eyes, version picks) is
 * part of that view's document, so it saves like layout edits and switching
 * views switches it too.
 *
 * The cards get the picked, eye-on runs of visible groups plus visible
 * ungrouped runs (Group by group), or every visible run (Group by none).
 * With Group by group the page also provides the grouping
 * (lib/workspace-runs/grouping-context.ts): scalar cards draw one line per
 * group, ungrouped runs stay their own lines.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useRuns } from "../api/hooks";
import RunsSidebar, { type RunStateEdit } from "../components/workspace-runs/RunsSidebar";
import WorkspaceView from "../components/workspace/WorkspaceView";
import { useProjectId } from "../lib/project-context";
import { useElementScrollRestore } from "../lib/use-scroll-restore";
import type { GroupGraph } from "../lib/workspace-runs/graph";
import { WorkspaceGroupingContext, type WorkspaceGrouping } from "../lib/workspace-runs/grouping-context";
import { buildList, matchesSearch, runsForCards } from "../lib/workspace-runs/list";
import { ops } from "../lib/workspace/doc";
import { refKey, viewRef, type WorkspaceRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";
import { useWorkspace } from "../lib/workspace/use-workspace";

/** The project's runs the sidebar lists from (the runs route's cap). */
const RUNS_LIMIT = 1000;

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
  const state = doc.runState;
  const runsQ = useRuns({ project: projectId, archived: "false", limit: RUNS_LIMIT });
  const runs = useMemo(() => runsQ.data?.runs ?? [], [runsQ.data]);

  // Every listed group's lineage graph (until it loads, the group has no edges).
  const wanted = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of runs) {
      if (r.group != null && !r.archived && matchesSearch(r, state.search)) count.set(r.group, (count.get(r.group) ?? 0) + 1);
    }
    return [...count];
  }, [runs, state.search]);
  const graphQs = useQueries({
    queries: wanted.map(([group, n]) => ({
      // The listed run count in the key: a new run in the group refetches its graph.
      queryKey: [...qk.groupGraph(projectId, group), n],
      queryFn: () => api.groupGraph(projectId, group),
      staleTime: 30_000,
    })),
  });
  const fetchedKey = graphQs.map((q) => q.dataUpdatedAt).join("|");
  const graphs = useMemo(() => {
    const m = new Map<string, GroupGraph>();
    graphQs.forEach((q) => q.data && m.set(q.data.group, q.data));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedKey]);
  const list = useMemo(() => buildList(runs, state, graphs), [runs, state, graphs]);
  const cards = useMemo(() => runsForCards(list), [list]);
  // Group by group: scalar cards draw one line per group; Group by none: one per run.
  const grouping = useMemo<WorkspaceGrouping | null>(
    () => (state.groupBy === "group" ? { groupOf: cards.groupOf } : null),
    [state.groupBy, cards.groupOf],
  );

  const edit = useCallback<RunStateEdit>(
    (fn, label, mergeKey) => update(ops.updateRunState(fn), { label, mergeKey }),
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
          Runs (showing {list.visible} of {list.listed}) {sidebarOpen ? "▲" : "▼"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        <aside
          ref={sidebarRef}
          className={`card p-3 md:sticky md:top-[var(--header-h)] md:max-h-[calc(100vh-var(--header-h))] md:overflow-y-auto ${sidebarOpen ? "" : "hidden md:block"}`}
        >
          <RunsSidebar list={list} search={state.search} groupBy={state.groupBy} onEdit={edit} />
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
