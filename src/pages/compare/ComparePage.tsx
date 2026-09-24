import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import SmartComparisonWizard from "../../components/SmartComparisonWizard";
import {
  addRunsToComparison,
  comparisonRunIds,
  createComparison,
  deleteComparison,
  rebuildCardsFromRuns,
  removeCardFromComparison,
  removeRunFromComparison,
  renameComparison,
  reorderComparisonCards,
  setComparisonRunSelector,
  syncComparisonsFromServer,
  updateComparison,
  useComparisons,
  type SmartFilters,
} from "../../lib/comparisons";
import { cardFromSpec, type AddCardSelection } from "../../lib/reports";
import { storageKeys } from "../../lib/storage";
import { useElementScrollRestore } from "../../lib/use-scroll-restore";
import { useRuns } from "../../api/hooks";
import { api } from "../../api/client";
import Sidebar from "./Sidebar";
import TemplateSidebar from "./TemplateSidebar";
import ComparisonView from "./ComparisonView";

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const runs = runsQ.data?.runs ?? [];
  const allProjectRunIds = useMemo(() => runs.map((r) => r.id), [runs]);

  // Run label cache is seeded centrally in `useRuns` (api/hooks.ts).
  const [searchParams, setSearchParams] = useSearchParams();
  const { comparisons, refresh } = useComparisons(projectId ?? "");

  // Sync with server on mount.
  useEffect(() => {
    if (!projectId) return;
    syncComparisonsFromServer(projectId).then(refresh);
  }, [projectId, refresh]);

  // Transient "restored N of M cards" feedback for a template apply. Two
  // sources: RunsTablePage's "From template" hands it over via router state
  // (it navigates here right after applying); the sidebar's own "New
  // comparison from template" sets it directly (see applyBanner below).
  const location = useLocation();
  const [applyBanner, setApplyBanner] = useState<string | null>(
    (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback ?? null,
  );
  useEffect(() => {
    const feedback = (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback;
    if (!feedback) return;
    setApplyBanner(feedback);
    // Clear the router state so a refresh/back-navigation doesn't re-show it.
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const selectedId = searchParams.get("c") ?? "";

  // Auto-select: restore last-viewed comparison, or fall back to first.
  useEffect(() => {
    if (!projectId) return;
    if (selectedId) return;
    if (comparisons.length === 0) return;
    const lastKey = storageKeys.lastComparison(projectId);
    const lastId = sessionStorage.getItem(lastKey);
    const target = (lastId && comparisons.find((c) => c.id === lastId))
      ? lastId
      : comparisons[0]!.id;
    const params = new URLSearchParams(searchParams);
    params.set("c", target);
    setSearchParams(params, { replace: true });
  }, [projectId, selectedId, comparisons, searchParams, setSearchParams]);

  const selected = useMemo(
    () => comparisons.find((c) => c.id === selectedId) ?? null,
    [comparisons, selectedId],
  );

  const selectComparison = useCallback(
    (id: string) => {
      if (projectId) sessionStorage.setItem(storageKeys.lastComparison(projectId), id);
      const params = new URLSearchParams(searchParams);
      params.set("c", id);
      setSearchParams(params, { replace: true });
    },
    [projectId, searchParams, setSearchParams],
  );

  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("c");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleCreate = useCallback(() => {
    if (!projectId) return;
    const cmp = createComparison(projectId, "New comparison");
    refresh();
    selectComparison(cmp.id);
  }, [projectId, refresh, selectComparison]);

  const handleRename = useCallback(
    (id: string, name: string) => {
      if (!projectId) return;
      renameComparison(projectId, id, name);
      refresh();
    },
    [projectId, refresh],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!projectId) return;
      deleteComparison(projectId, id);
      const lastKey = storageKeys.lastComparison(projectId);
      if (sessionStorage.getItem(lastKey) === id) sessionStorage.removeItem(lastKey);
      if (id === selectedId) clearSelection();
      refresh();
    },
    [projectId, selectedId, clearSelection, refresh],
  );

  const handleRemoveCard = useCallback(
    (comparisonId: string, cardId: string) => {
      if (!projectId) return;
      removeCardFromComparison(projectId, comparisonId, cardId);
      refresh();
    },
    [projectId, refresh],
  );

  // Id of the just-added card, so the section below can auto-open its
  // settings and scroll it into view once. Transient — never persisted, so
  // a reload never re-opens a card's settings.
  const [autoFocusCardId, setAutoFocusCardId] = useState<string | null>(null);

  const handleAddCard = useCallback(
    (comparisonId: string, sel: AddCardSelection) => {
      if (!projectId) return;
      const card = cardFromSpec(sel);
      updateComparison(projectId, comparisonId, (c) => ({ ...c, cards: [...c.cards, card] }));
      refresh();
      setAutoFocusCardId(card.id);
    },
    [projectId, refresh],
  );

  // Clear the auto-focus flag right after it's been handed to the card grid
  // for one render — CardShell/cards only read it on mount, so clearing it
  // here doesn't undo the auto-open/scroll, and it keeps the flag from
  // lingering (e.g. across an unrelated re-render of the same comparison).
  useEffect(() => {
    if (autoFocusCardId == null) return;
    setAutoFocusCardId(null);
  }, [autoFocusCardId]);

  const handleRefreshSmartFilters = useCallback(
    async (comparisonId: string, smartFilters: SmartFilters) => {
      if (!projectId) return;
      // We need to re-run the filter. Fetch all runs + their params.
      const runsRes = await api.runs({ project: projectId, limit: 500 });
      const allRuns = runsRes.runs;
      const runDetails = await Promise.all(allRuns.map((r) => api.run(r.id)));

      // Build param map
      const runParamMap = new Map<string, Map<string, string>>();
      runDetails.forEach((detail, idx) => {
        const run = allRuns[idx]!;
        const pmap = new Map<string, string>();
        for (const p of detail.params ?? []) {
          pmap.set(p.key, p.value);
        }
        runParamMap.set(run.id, pmap);
      });

      // Apply filters
      let matched = allRuns.filter((run) => {
        const pmap = runParamMap.get(run.id);
        if (!pmap) return false;
        return smartFilters.filters.every((f) => {
          const val = pmap.get(f.key);
          if (val == null) return false;
          if (f.mode === "regex") {
            if (!f.regex) return true;
            try { return new RegExp(f.regex).test(val); } catch { return false; }
          }
          if (f.values.length === 0) return true;
          return f.values.includes(val);
        });
      });

      if (smartFilters.strategy === "latest") {
        const groups = new Map<string, typeof matched>();
        for (const run of matched) {
          const pmap = runParamMap.get(run.id);
          const comboKey = smartFilters.filters.map((f) => pmap?.get(f.key) ?? "").join("||");
          const arr = groups.get(comboKey) ?? [];
          arr.push(run);
          groups.set(comboKey, arr);
        }
        matched = [];
        for (const arr of groups.values()) {
          arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
          matched.push(arr[0]!);
        }
      }

      matched.sort((a, b) => b.created_at.localeCompare(a.created_at));

      // Replace all cards with ones grown from the matched runs.
      const cards = await rebuildCardsFromRuns(matched.map((r) => r.id));
      updateComparison(projectId, comparisonId, (c) => ({ ...c, cards }));
      refresh();
    },
    [projectId, refresh],
  );

  /**
   * Regrow a `runSelector`-bound comparison's cards from its resolved run
   * set — `runIds` arrives already resolved (ComparisonView refreshes the
   * selector), so this only rebuilds and persists.
   */
  const handleRefreshRunSelector = useCallback(
    async (comparisonId: string, runIds: string[]) => {
      if (!projectId) return;
      const cards = await rebuildCardsFromRuns(runIds);
      updateComparison(projectId, comparisonId, (c) => ({ ...c, cards, runIds }));
      refresh();
    },
    [projectId, refresh],
  );

  const compRunIds = useMemo(() => (selected ? comparisonRunIds(selected) : []), [selected]);

  const runInfoMap = useMemo(() => {
    const m = new Map<string, { displayName?: string; projectId?: string }>();
    for (const r of runs) {
      m.set(r.id, { displayName: r.display_name || undefined, projectId: r.project_id });
    }
    return m;
  }, [runs]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  useElementScrollRestore(sidebarRef, `compare-sidebar:${projectId}`, comparisons.length > 0);

  const handleWizardCreated = useCallback(
    (comparisonId: string) => {
      refresh();
      selectComparison(comparisonId);
    },
    [refresh, selectComparison],
  );

  if (!projectId) return null;

  return (
    <div>
      <h1 className="mono mb-4 text-xl font-semibold">
        Compare
      </h1>

      {applyBanner && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg">
          <span>{applyBanner}</span>
          <button
            type="button"
            onClick={() => setApplyBanner(null)}
            className="shrink-0 text-fg-subtle hover:text-fg"
            aria-label="Dismiss"
          >
            {"×"}
          </button>
        </div>
      )}

      {/* Mobile sidebar toggle */}
      <div className="mb-3 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="btn text-xs"
          aria-expanded={sidebarOpen}
        >
          Comparisons ({comparisons.length}) {sidebarOpen ? "\u25B2" : "\u25BC"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        <aside
          ref={sidebarRef}
          className={`card p-3 md:sticky md:top-[41px] md:max-h-[calc(100vh-41px)] md:overflow-y-auto ${sidebarOpen ? "" : "hidden md:block"}`}
        >
          <Sidebar
            comparisons={comparisons}
            selectedId={selectedId}
            onSelect={selectComparison}
            onCreate={handleCreate}
            onSmartCreate={() => setWizardOpen(true)}
            onRename={handleRename}
            onDelete={handleDelete}
          />
          <TemplateSidebar
            projectId={projectId}
            currentRunIds={compRunIds}
            allRunIds={allProjectRunIds}
            runInfo={runInfoMap}
            onApplied={(result, name) => {
              if (!result.comparisonId) {
                setApplyBanner(`"${name}" has no cards matching the selected run(s) — no comparison created.`);
                return;
              }
              refresh();
              selectComparison(result.comparisonId);
              setApplyBanner(
                result.matchedCount === result.totalCount
                  ? `Applied "${name}" — all ${result.totalCount} card(s) restored.`
                  : `Applied "${name}" — restored ${result.matchedCount} of ${result.totalCount} card(s).`,
              );
            }}
          />
        </aside>
        <main>
          {selected ? (
            <ComparisonView
              comparison={selected}
              allProjectRuns={runs}
              allProjectRunIds={allProjectRunIds}
              projectId={projectId}
              autoFocusCardId={autoFocusCardId}
              onRename={(name) => handleRename(selected.id, name)}
              onDelete={() => handleDelete(selected.id)}
              onRemoveCard={(cardId) => handleRemoveCard(selected.id, cardId)}
              onAddCard={(sel) => handleAddCard(selected.id, sel)}
              onAddRuns={(runIds) => {
                addRunsToComparison(projectId, selected.id, runIds);
                refresh();
              }}
              onRemoveRun={(runId) => {
                removeRunFromComparison(projectId, selected.id, runId);
                refresh();
              }}
              onRefreshSmartFilters={handleRefreshSmartFilters}
              onRefreshRunSelector={handleRefreshRunSelector}
              onSetRunSelector={(sel) => {
                setComparisonRunSelector(projectId, selected.id, sel);
                refresh();
              }}
              onReorderCards={(fromId, toId) => {
                reorderComparisonCards(projectId, selected.id, fromId, toId);
                refresh();
              }}
            />
          ) : (
            <EmptyMainPane
              hasAny={comparisons.length > 0}
              onCreate={handleCreate}
            />
          )}
        </main>
      </div>

      <SmartComparisonWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        projectId={projectId}
        onCreated={handleWizardCreated}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Empty state
// -----------------------------------------------------------------------------

function EmptyMainPane({
  hasAny,
  onCreate,
}: {
  hasAny: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="card p-6 text-sm text-fg-muted">
      {hasAny ? (
        <p>Select a comparison on the left to view its cards.</p>
      ) : (
        <>
          <p className="mb-2 text-fg">No comparisons yet.</p>
          <p>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={onCreate}
            >
              Create one
            </button>{" "}
            to start collecting scalar cards across runs.
          </p>
        </>
      )}
    </div>
  );
}

