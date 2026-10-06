/**
 * /p/:projectId/compare — the project's comparisons. Each comparison is a
 * workspace (lib/workspace/doc.ts with a run set): the sidebar lists them,
 * the main pane renders the selected one with the same workspace view as the
 * run page (ComparisonView).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import SmartComparisonWizard from "../../components/SmartComparisonWizard";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { useRuns } from "../../api/hooks";
import { storageKeys } from "../../lib/storage";
import { useElementScrollRestore } from "../../lib/use-scroll-restore";
import { createComparison, deleteComparison } from "../../lib/workspace/comparisons";
import Sidebar from "./Sidebar";
import ComparisonView from "./ComparisonView";

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const runs = runsQ.data?.runs ?? [];
  const [searchParams, setSearchParams] = useSearchParams();
  const listQ = useQuery({
    queryKey: qk.comparisons(projectId ?? ""),
    queryFn: () => api.comparisons(projectId!),
    enabled: !!projectId,
  });
  const comparisons = useMemo(() => listQ.data?.comparisons ?? [], [listQ.data]);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: qk.comparisons(projectId ?? "") }), [qc, projectId]);

  const selectedId = searchParams.get("c") ?? "";

  // Auto-select: restore the last-viewed comparison, or fall back to the first.
  useEffect(() => {
    if (!projectId || selectedId || comparisons.length === 0) return;
    const lastId = sessionStorage.getItem(storageKeys.lastComparison(projectId));
    const target = lastId && comparisons.some((c) => c.id === lastId) ? lastId : comparisons[0]!.id;
    const params = new URLSearchParams(searchParams);
    params.set("c", target);
    setSearchParams(params, { replace: true });
  }, [projectId, selectedId, comparisons, searchParams, setSearchParams]);

  const selected = useMemo(() => comparisons.find((c) => c.id === selectedId) ?? null, [comparisons, selectedId]);

  const selectComparison = useCallback(
    (id: string) => {
      if (projectId) sessionStorage.setItem(storageKeys.lastComparison(projectId), id);
      const params = new URLSearchParams(searchParams);
      params.set("c", id);
      setSearchParams(params, { replace: true });
    },
    [projectId, searchParams, setSearchParams],
  );

  const handleCreate = useCallback(async () => {
    if (!projectId) return;
    const id = await createComparison(projectId, "New comparison", []);
    await refresh();
    selectComparison(id);
  }, [projectId, refresh, selectComparison]);

  const handleRename = useCallback(
    async (id: string, name: string) => {
      if (!projectId) return;
      await api.renameComparison(projectId, id, name);
      await refresh();
    },
    [projectId, refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!projectId) return;
      await deleteComparison(projectId, id);
      const lastKey = storageKeys.lastComparison(projectId);
      if (sessionStorage.getItem(lastKey) === id) sessionStorage.removeItem(lastKey);
      if (id === selectedId) {
        const params = new URLSearchParams(searchParams);
        params.delete("c");
        setSearchParams(params, { replace: true });
      }
      await refresh();
    },
    [projectId, selectedId, searchParams, setSearchParams, refresh],
  );

  // Only phones toggle the sidebar (it is always shown from md up).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  useElementScrollRestore(sidebarRef, `compare-sidebar:${projectId}`, comparisons.length > 0);

  if (!projectId) return null;

  return (
    <div>
      <h1 className="mono mb-4 text-xl font-semibold">Compare</h1>

      <div className="mb-3 md:hidden">
        <button type="button" onClick={() => setSidebarOpen((v) => !v)} className="btn text-xs" aria-expanded={sidebarOpen}>
          Comparisons ({comparisons.length}) {sidebarOpen ? "▲" : "▼"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <aside
          ref={sidebarRef}
          className={`card p-3 md:sticky md:top-[var(--header-h)] md:max-h-[calc(100vh-var(--header-h))] md:overflow-y-auto ${sidebarOpen ? "" : "hidden md:block"}`}
        >
          <Sidebar
            comparisons={comparisons}
            selectedId={selectedId}
            onSelect={(id) => {
              selectComparison(id);
              setSidebarOpen(false);
            }}
            onCreate={() => {
              void handleCreate();
              setSidebarOpen(false);
            }}
            onSmartCreate={() => setWizardOpen(true)}
            onRename={(id, name) => void handleRename(id, name)}
            onDelete={(id) => void handleDelete(id)}
          />
        </aside>
        <main className="min-w-0">
          {selected ? (
            <ComparisonView
              key={selected.id}
              projectId={projectId}
              comparison={selected}
              allProjectRuns={runs}
              onRename={(name) => void handleRename(selected.id, name)}
              onDelete={() => void handleDelete(selected.id)}
            />
          ) : (
            <div className="card p-6 text-sm text-fg-muted">
              {comparisons.length > 0 ? (
                <p>Pick a comparison from the list.</p>
              ) : (
                <>
                  <p className="mb-2 text-fg">No comparisons yet.</p>
                  <p>
                    <button type="button" className="text-accent hover:underline" onClick={() => void handleCreate()}>
                      Create one
                    </button>{" "}
                    — it starts with a copy of the current view&rsquo;s layout. Or select runs in the runs table and
                    click Compare.
                  </p>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <SmartComparisonWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        projectId={projectId}
        onCreated={(id) => {
          void refresh();
          selectComparison(id);
          setSidebarOpen(false);
        }}
      />
    </div>
  );
}
