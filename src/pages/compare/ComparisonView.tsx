/**
 * One comparison: a header (name, delete), the Overview / Metrics & Media /
 * Source tabs. Metrics & Media is the run-set editor (the only
 * comparison-specific part) above the same `WorkspaceView` the run page
 * renders, bound to this comparison's document and runs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ComparisonOverviewTab from "../ComparisonOverviewTab";
import ComparisonSourceTab from "../ComparisonSourceTab";
import RunSetEditor, { DEFAULT_QUERY_SELECTOR } from "../../components/comparison/RunSetEditor";
import RunSelectorBadge from "../../components/RunSelectorBadge";
import WorkspaceView from "../../components/workspace/WorkspaceView";
import { useRunSelectorResolution } from "../../api/hooks";
import type { ComparisonSummary, Run } from "../../api/types";
import { describeRunSelector } from "../../lib/run-selector";
import { RunViewContext, type RunView } from "../../lib/run-view";
import { ops } from "../../lib/workspace/doc";
import type { WorkspaceRef } from "../../lib/workspace/ref";
import { useWorkspace } from "../../lib/workspace/use-workspace";

const COMPARISON_TABS = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics & Media" },
  { id: "source", label: "Source" },
];

interface Props {
  projectId: string;
  comparison: ComparisonSummary;
  allProjectRuns: Run[];
  onRename: (name: string) => void;
  onDelete: () => void;
}

export default function ComparisonView({ projectId, comparison, allProjectRuns, onRename, onDelete }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "metrics";
  const setTab = useCallback(
    (t: string) => {
      const p = new URLSearchParams(searchParams);
      p.set("tab", t);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const wsRef = useMemo<WorkspaceRef>(() => ({ kind: "comparison", projectId, id: comparison.id }), [projectId, comparison.id]);
  const { doc, update, readOnly } = useWorkspace(wsRef);
  const runs = doc.runs;
  const selector = runs?.selector ?? undefined;
  const resolution = useRunSelectorResolution(projectId, selector);
  const [selectorRefreshing, setSelectorRefreshing] = useState(false);
  const runIds = useMemo(
    () => (selector?.kind === "query" ? resolution.runIds : (runs?.ids ?? [])),
    [selector, resolution.runIds, runs?.ids],
  );

  // The comparison's run view (hidden, pinned, baseline) lives in its document.
  const runView = useMemo(
    () => ({
      view: runs?.view ?? { hidden: [], pinned: [], baseline: null },
      set: readOnly ? undefined : (next: RunView) => update(ops.setRuns({ view: next }), { label: "Change run view" }),
    }),
    [runs?.view, update, readOnly],
  );

  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(comparison.name);
  useEffect(() => {
    if (!editingName) setDraft(comparison.name);
  }, [comparison.name, editingName]);
  const commitName = () => {
    const t = draft.trim();
    if (t && t !== comparison.name) onRename(t);
    setEditingName(false);
  };

  return (
    <div className="flex flex-col gap-4" data-comparison={comparison.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingName(false);
              }
            }}
            className="input min-w-0 flex-1 text-lg font-semibold"
          />
        ) : (
          <h2 className="min-w-0 cursor-text break-words text-lg font-semibold" title="Click to rename" onClick={() => setEditingName(true)}>
            {comparison.name}
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {selector?.kind === "query" && (
            <RunSelectorBadge
              title={describeRunSelector(selector)}
              count={resolution.runIds.length}
              isRefreshing={selectorRefreshing || resolution.isFetching}
              onRefresh={() => {
                setSelectorRefreshing(true);
                void resolution.refresh().finally(() => setSelectorRefreshing(false));
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${comparison.name}"?`)) onDelete();
            }}
            className="btn text-xs"
          >
            Delete
          </button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {COMPARISON_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <RunViewContext.Provider value={runView}>
        {tab === "overview" && <ComparisonOverviewTab compRunIds={runIds} />}
        {tab === "metrics" && (
          <>
            <RunSetEditor
              title="Runs in comparison"
              runIds={runIds}
              allProjectRuns={allProjectRuns}
              selector={selector}
              editable={!readOnly}
              onToggleMode={() => {
                if (selector?.kind === "query") {
                  // Back to a static list: keep the runs currently matched.
                  update(ops.setRuns({ selector: null, ids: runIds }), { label: "Use static runs" });
                  return;
                }
                update(ops.setRuns({ selector: { ...DEFAULT_QUERY_SELECTOR } }), { label: "Use a run selector" });
              }}
              onSelectorChange={(next) => update(ops.setRuns({ selector: next }), { label: "Change run selector" })}
              onAddRun={(id) => update(ops.addRuns([id]), { label: "Add run" })}
              onRemoveRun={(id) => update(ops.removeRun(id), { label: "Remove run" })}
            />
            <WorkspaceView wsRef={wsRef} runIds={runIds} reportLabel={`comparison “${comparison.name}”`} />
          </>
        )}
        {tab === "source" && <ComparisonSourceTab compRunIds={runIds} />}
      </RunViewContext.Provider>
    </div>
  );
}
