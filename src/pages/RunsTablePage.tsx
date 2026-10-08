import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteScroll } from "../lib/use-infinite-scroll";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useBulkRunMutation, useInfiniteRuns, useSetTags } from "../api/hooks";
import type { Run } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import { RunProgressLine, RunProgressPct } from "../components/RunProgress";
import { formatDuration, formatRelative, safeJsonParse } from "../lib/format";
import { formatValue } from "../lib/plot-utils/format";
import { showInWorkspace } from "../lib/workspace-runs/show-in-workspace";
import { downloadBlob } from "../lib/download";
import { api } from "../api/client";
import Popover from "../components/ui/Popover";
import BulkTagEditor from "../components/BulkTagEditor";
import ImportRunsDialog from "../components/ImportRunsDialog";
import CopyId from "../components/CopyId";
import TagInput from "../components/TagInput";
import { useWindowScrollRestore } from "../lib/use-scroll-restore";
import { useProjectTags } from "../lib/use-project-tags";
import {
  EMPTY_RUNS_FILTER,
  filterFieldsOf,
  isEmptyFilter,
  loadRunsFilter,
  saveRunsFilter,
  type RunsFilterState,
} from "../lib/run-filter.ts";
import {
  RunFilterControl,
  RunGroupControl,
  RunLatestOnlyToggle,
  RunSearchInput,
  RunStatusSelect,
} from "../components/RunFilterBar";
import { GroupHeader, groupWorkspacePath } from "../components/runs-table/RunsTableParts";
import RunsTable from "../components/runs-table/RunsTable";
import { useRunsTable } from "../components/runs-table/use-runs-table";
import { runRowName, sameGroup, toggleGroupSelection, type StatusFilter } from "../lib/runs-table/model.ts";
import { olderInSeries } from "../lib/run-series.ts";
import RunControls, { RunSwatch } from "../components/RunViewControls";
import {
  availableColumns,
  cellValue,
  columnKind,
  columnLabel,
  compileScalarExpr,
  isNumericColumn,
  layoutColumns,
  moveColumn,
  setBetter,
  setHidden,
  togglePinned,
  type Better,
  type ColumnsState,
  type ComputedColumn,
  clampColumnWidth,
  columnWidth,
  setWidth,
} from "../lib/runs-table/columns.ts";
import { removeSortKey, toggleSort, type SortKey } from "../lib/runs-table/sort.ts";
import { betterFor, deltaOf, formatDelta, relativeDelta, toneOf, type Tone } from "../lib/runs-table/delta.ts";
import { RunViewContext, useRunColors, type RunView } from "../lib/run-view";
import { useProjectRunView } from "../lib/run-view-store";
import { newId } from "../lib/reports/ids";
import "./runs-table.css";

const TONE_CLASS: Record<Tone, string> = {
  better: "text-status-completed",
  worse: "text-status-failed",
  same: "text-fg-subtle",
  neutral: "text-fg-subtle",
};

/** The project's persisted table view (filter, grouping, sort, columns), reloaded when the project changes. */
function useRunsFilterState(projectId: string | undefined) {
  const load = (pid: string | undefined) => (pid ? loadRunsFilter(localStorage, pid) : EMPTY_RUNS_FILTER);
  const [entry, setEntry] = useState(() => ({ projectId, state: load(projectId) }));
  let current = entry;
  if (entry.projectId !== projectId) {
    current = { projectId, state: load(projectId) };
    setEntry(current);
  }
  const update = useCallback((next: RunsFilterState) => {
    if (projectId) saveRunsFilter(localStorage, projectId, next);
    setEntry({ projectId, state: next });
  }, [projectId]);
  return [current.state, update] as const;
}

function formatCreated(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  } catch {
    return formatRelative(iso);
  }
}

/** The Runs page (`/p/:projectId`). */
export default function RunsTablePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const q = useInfiniteRuns({ project: projectId, include: ["params", "stats"] });
  const { bulkDelete, bulkArchive, bulkStop } = useBulkRunMutation();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState<string>("");
  const [filterState, setFilterState] = useRunsFilterState(projectId);
  const runViewCtl = useProjectRunView(projectId);
  const runView = runViewCtl.view;
  const setRunView = runViewCtl.set!;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const tagBtnRef = useRef<HTMLButtonElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showLatestOnly, setShowLatestOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addingTagFor, setAddingTagFor] = useState<string | null>(null);
  const [menuColumn, setMenuColumn] = useState<string | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [newTagValue, setNewTagValue] = useState("");

  const runs = useMemo(() => {
    const all = q.data?.pages.flatMap((p) => p.runs) ?? [];
    // Deduplicate: pages can overlap when new runs are inserted between fetches.
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [q.data]);
  const serverTotal = q.data?.pages[0]?.total ?? 0;

  // Auto-load next page when sentinel enters viewport.
  const sentinelRef = useInfiniteScroll({
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    fetchNextPage: q.fetchNextPage,
  });
  const allTags = useProjectTags(runs);

  // Filters and groups apply to the loaded runs, so while either is active
  // load every page: a filter over the first 100 runs silently hides matches.
  const needsAllRuns = !isEmptyFilter(filterState.filter) || filterState.groupBy.length > 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    if (needsAllRuns && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [needsAllRuns, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filterFields = useMemo(() => filterFieldsOf(runs), [runs]);
  const paramKeys = useMemo(
    () => filterFields.filter((f) => f.startsWith("params.")).map((f) => f.slice("params.".length)),
    [filterFields],
  );

  const onStartAddTag = useCallback((runId: string) => {
    setAddingTagFor(runId);
    setNewTagValue("");
  }, []);

  const onCancelAddTag = useCallback(() => {
    setAddingTagFor(null);
    setNewTagValue("");
  }, []);

  const onBulkDelete = useCallback(async () => {
    if (!confirm(`Delete ${selected.size} run(s)? This cannot be undone.`)) return;
    const ids = [...selected];
    await bulkDelete(ids);
    // Table data can be paginated/filtered, so it isn't a safe "keep" set —
    // only sweep the ids we know were just deleted.
    setSelected(new Set());
  }, [selected, bulkDelete]);

  const selectedRunning = useMemo(
    () => runs.filter((r) => selected.has(r.id) && r.status === "running").map((r) => r.id),
    [runs, selected],
  );

  const onBulkStop = useCallback(async () => {
    if (!confirm(`Stop ${selectedRunning.length} running run(s)?`)) return;
    await bulkStop(selectedRunning);
    setSelected(new Set());
  }, [selectedRunning, bulkStop]);

  const onBulkArchive = useCallback(async () => {
    await bulkArchive([...selected], true);
    setSelected(new Set());
  }, [selected, bulkArchive]);

  const onBulkUnarchive = useCallback(async () => {
    await bulkArchive([...selected], false);
    setSelected(new Set());
  }, [selected, bulkArchive]);

  const onArchiveOldVersions = useCallback(async () => {
    // Every run but the newest of its series (group, name): a group is a namespace.
    const toArchive = olderInSeries(runs.filter((r) => !r.archived)).map((r) => r.id);
    if (toArchive.length === 0) { alert("No old versions to archive."); return; }
    if (!confirm(`Archive ${toArchive.length} old run(s)?`)) return;
    await bulkArchive(toArchive, true);
  }, [runs, bulkArchive]);

  const onDeleteOldVersions = useCallback(async () => {
    // Every run but the newest of its series (group, name): a group is a namespace.
    const toDelete = olderInSeries(runs.filter((r) => !r.archived)).map((r) => r.id);
    if (toDelete.length === 0) { alert("No old versions to delete."); return; }
    if (!confirm(`Delete ${toDelete.length} old run(s)? This cannot be undone.`)) return;
    await bulkDelete(toDelete);
  }, [runs, bulkDelete]);

  // Run label cache is seeded centrally in `useInfiniteRuns` (api/hooks.ts).

  const { sort, columns, computed, groupBy } = filterState;
  const setColumns = (next: ColumnsState) => setFilterState({ ...filterState, columns: next });
  // The width of the column being dragged, live; persisted once on release.
  const [dragWidth, setDragWidth] = useState<{ column: string; width: number } | null>(null);
  const widthOf = (col: string) => (dragWidth?.column === col ? dragWidth.width : columnWidth(columns, col));
  const setSort = (next: SortKey[]) => setFilterState({ ...filterState, sort: next });
  const setComputed = (next: ComputedColumn[]) => setFilterState({ ...filterState, computed: next });

  // The baseline may be filtered out of the table; deltas still compare against it.
  const baselineRun = useMemo(
    () => (runView.baseline ? runs.find((r) => r.id === runView.baseline) : undefined),
    [runs, runView.baseline],
  );

  const { runSearch, latestByName, filtered, computedValues, sorted, collapsed, toggleGroup, rows } = useRunsTable({
    runs,
    status: statusFilter,
    search,
    filter: filterState.filter,
    latestOnly: showLatestOnly,
    groupBy,
    sort,
    computed,
    pinned: runView.pinned,
    baseline: baselineRun,
  });

  // Metric and param columns are the UNION across the loaded runs, not the
  // intersection: a run that crashed before logging `val.acc` should show a
  // blank cell, not delete the column for every other run.
  const available = useMemo(() => availableColumns(filtered, computed), [filtered, computed]);
  const layout = useMemo(() => layoutColumns(available, columns), [available, columns]);
  const shownColumns = useMemo(() => [...layout.frozen, ...layout.scroll], [layout]);

  const colors = useRunColors(useMemo(() => sorted.map((r) => r.id), [sorted]));

  const betterByColumn = useMemo(() => {
    const out = new Map<string, Better | null>();
    for (const col of shownColumns) {
      if (!isNumericColumn(col) || col === "duration") continue;
      const { kind, key } = columnKind(col);
      const own = columns.better[col] ?? (kind === "computed" ? computed.find((c) => c.id === key)?.better : undefined);
      // Config params are inputs, not results: deltas only once the user says which way is better.
      if (kind === "param" && !own) continue;
      out.set(col, betterFor(col, own, baselineRun, filtered));
    }
    return out;
  }, [shownColumns, columns.better, computed, baselineRun, filtered]);

  // The rows in on-screen order (expanded groups only, a run listed once),
  // which is what a shift-click range spans.
  const displayOrder = useMemo(() => {
    const seen = new Set<string>();
    const out: Run[] = [];
    for (const row of rows) {
      if (row.kind !== "run" || seen.has(row.run.id)) continue;
      seen.add(row.run.id);
      out.push(row.run);
    }
    return out;
  }, [rows]);

  const lastSelectedId = useRef<string | null>(null);

  // Build a stable ID→index lookup, recomputed only when the order changes.
  const sortedIdToIdx = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < displayOrder.length; i++) map.set(displayOrder[i]!.id, i);
    return map;
  }, [displayOrder]);

  const toggleRow = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey && lastSelectedId.current !== null) {
        const lastIdx = sortedIdToIdx.get(lastSelectedId.current);
        const curIdx = sortedIdToIdx.get(id);
        if (lastIdx != null && curIdx != null) {
          const lo = Math.min(lastIdx, curIdx);
          const hi = Math.max(lastIdx, curIdx);
          setSelected((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i++) next.add(displayOrder[i]!.id);
            return next;
          });
          lastSelectedId.current = id;
          return;
        }
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastSelectedId.current = id;
    },
    [displayOrder, sortedIdToIdx],
  );

  const selectAllVisible = () => {
    setSelected(new Set(sorted.map((r) => r.id)));
  };
  const selectNone = () => setSelected(new Set());

  const allVisibleSelected =
    sorted.length > 0 && sorted.every((r) => selected.has(r.id));
  const someVisibleSelected = sorted.some((r) => selected.has(r.id));
  const grouped = groupBy.length > 0;
  // Names drop the `group ·` prefix when grouped or every listed run is in one group (e.g. filtered to one group).
  const plainNames = grouped || sameGroup(sorted);

  const onHeaderCheckbox = () => {
    if (allVisibleSelected) selectNone();
    else selectAllVisible();
  };

  const selectedCount = selected.size;

  const onExport = useCallback(async () => {
    if (selected.size === 0) return;
    setExporting(true);
    try {
      const blob = await api.exportRuns(Array.from(selected));
      downloadBlob(blob, `cairn_export_${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) {
      alert(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  }, [selected]);

  const onShowInWorkspace = async () => {
    // Exactly the ticked runs visible in the project workspace (the current view).
    await showInWorkspace(projectId!, new Set(selected));
    navigate(`/p/${projectId}/workspace`);
  };

  useWindowScrollRestore(
    `runs:${projectId ?? ""}`,
    !q.isLoading && !!q.data,
  );

  const selectionActions: {
    label: string;
    onClick: (anchor: HTMLElement | null) => void;
    disabled: boolean;
    danger?: boolean;
  }[] = [
    {
      label: exporting ? "Exporting..." : "Export",
      onClick: onExport,
      disabled: selectedCount === 0 || exporting,
    },
    { label: "Stop", onClick: onBulkStop, disabled: selectedRunning.length === 0 },
    { label: "Archive", onClick: onBulkArchive, disabled: selectedCount === 0 },
    { label: "Unarchive", onClick: onBulkUnarchive, disabled: selectedCount === 0 },
    { label: "Delete", onClick: onBulkDelete, disabled: selectedCount === 0, danger: true },
  ];

  const runControls = (r: Run) => (
    <RunControls
      runId={r.id}
      view={runView}
      onChange={setRunView}
    />
  );

  const renderMobileRun = (r: Run, key: string, depth: number) => {
    const isSelected = selected.has(r.id);
    const hidden = runView.hidden.includes(r.id);
    return (
      <li
        key={key}
        style={depth > 0 ? { marginLeft: depth * 12 } : undefined}
        className={`rounded-lg border border-border bg-bg-elevated p-3 ${
          isSelected ? "border-accent/50 bg-accent/5" : ""
        } ${latestByName.has(r.id) ? "border-l-2 border-l-accent" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              aria-label={`select run ${r.display_name ?? r.id}`}
              checked={isSelected}
              onChange={(e) => toggleRow(r.id, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
            />
          </div>
          <RunSwatch color={colors.get(r.id)} />
          <Link
            to={`/p/${projectId}/r/${r.id}`}
            className={`mono min-h-[44px] min-w-0 flex-1 truncate leading-[44px] text-accent hover:underline ${hidden ? "opacity-50" : ""}`}
          >
            {runRowName(r, plainNames)}
          </Link>
          {runControls(r)}
          <RunStatusBadge status={r.status} archived={r.archived} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>{formatCreated(r.created_at)}</span>
          <span className="mono num">
            dur: {formatDuration(r.created_at, r.ended_at)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <RunTagCell
            run={r}
            variant="mobile"
            allTags={allTags}
            addingTagFor={addingTagFor}
            onStartAdd={onStartAddTag}
            onCancelAdd={onCancelAddTag}
            newTagValue={newTagValue}
            setNewTagValue={setNewTagValue}
          />
        </div>
      </li>
    );
  };

  /** After the Name cell's version: the baseline badge and the run view toggles. */
  const nameExtras = (r: Run): ReactNode => (
    <>
      {runView.baseline === r.id && (
        <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-medium text-accent">baseline</span>
      )}
      <span className="ml-auto shrink-0">
        <RunControls runId={r.id} view={runView} onChange={setRunView} show="active" />
      </span>
      {/* On hover, every toggle overlays the end of the cell (no layout shift). */}
      <span className="absolute inset-y-0 right-0 hidden items-center gap-1 bg-bg-elevated pl-2 group-hover/row:flex touch:flex">
        <CopyId id={r.id} className="text-xs" />
        <RunControls runId={r.id} view={runView} onChange={setRunView} show="all" />
      </span>
    </>
  );

  const renderCell = (r: Run, col: string): ReactNode => {
    const { kind, key } = columnKind(col);
    if (kind === "builtin") {
      switch (key) {
        case "status":
          return (
            <span className="dim">
              <span className="inline-flex items-center">
                <RunStatusBadge status={r.status} archived={r.archived} />
                <RunProgressPct status={r.status} progress={r.progress} />
              </span>
              <RunProgressLine status={r.status} progress={r.progress} />
            </span>
          );
        case "created_at":
          return <span className="dim whitespace-nowrap text-fg-muted">{formatCreated(r.created_at)}</span>;
        case "duration":
          return <span className="dim mono num whitespace-nowrap text-fg-muted">{formatDuration(r.created_at, r.ended_at)}</span>;
        case "tags":
          return (
            <span className="dim flex items-center gap-1 whitespace-nowrap">
              <RunTagCell
                run={r}
                variant="desktop"
                allTags={allTags}
                addingTagFor={addingTagFor}
                onStartAdd={onStartAddTag}
                onCancelAdd={onCancelAddTag}
                newTagValue={newTagValue}
                setNewTagValue={setNewTagValue}
              />
            </span>
          );
      }
    }
    const v = cellValue(r, col, computedValues);
    let delta: ReactNode = null;
    if (baselineRun && baselineRun.id !== r.id && betterByColumn.has(col)) {
      const base = cellValue(baselineRun, col, computedValues);
      const d = deltaOf(v, base);
      if (d !== null) {
        const rel = relativeDelta(d, base);
        delta = (
          <span
            className={`ml-1.5 text-[10px] ${TONE_CLASS[toneOf(d, betterByColumn.get(col) ?? null)]}`}
            title={`vs baseline${rel !== null ? ` (${rel > 0 ? "+" : ""}${(rel * 100).toFixed(1)}%)` : ""}`}
          >
            {formatDelta(d)}
          </span>
        );
      }
    }
    return (
      <span className="dim whitespace-nowrap">
        <span className="text-fg-muted">{formatValue(v, { empty: "" })}</span>
        {delta}
      </span>
    );
  };

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;

  return (
    <RunViewContext.Provider value={runViewCtl}>
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">{projectId} / runs</h1>
        <p className="text-sm text-fg-muted">
          {sorted.length} of {serverTotal} run{serverTotal === 1 ? "" : "s"}
        </p>
      </div>


      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RunStatusSelect value={statusFilter} onChange={setStatusFilter} />
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          Search
          <RunSearchInput value={search} error={runSearch.error} onChange={setSearch} />
        </label>
        <RunFilterControl
          fields={filterFields}
          filter={filterState.filter}
          onChange={(filter) => setFilterState({ ...filterState, filter })}
        />
        <RunGroupControl
          paramKeys={paramKeys}
          levels={filterState.groupBy}
          onChange={(groupBy) => setFilterState({ ...filterState, groupBy })}
        />
        <RunLatestOnlyToggle value={showLatestOnly} onChange={setShowLatestOnly} />
        <button
          ref={columnsBtnRef}
          type="button"
          className="btn px-2 py-1 text-xs"
          onClick={() => setColumnsOpen((v) => !v)}
          aria-expanded={columnsOpen}
        >
          <i className="fa-solid fa-table-columns mr-1 text-[10px]" aria-hidden="true" />
          Columns{computed.length > 0 ? ` (+${computed.length} ƒ)` : ""}
        </button>
        {sort.length > 1 && (
          <span className="flex items-center gap-1 text-[11px] text-fg-subtle" title="Shift-click a header to add a sort key">
            Sort:
            {sort.map((k) => (
              <span key={k.column} className="mono inline-flex items-center gap-0.5 rounded border border-border-subtle px-1">
                {columnLabel(k.column, computed)} {k.direction === "asc" ? "↑" : "↓"}
                <button type="button" className="hover:text-status-failed" aria-label={`Remove sort by ${k.column}`} onClick={() => setSort(removeSortKey(sort, k.column))}>
                  {"×"}
                </button>
              </span>
            ))}
          </span>
        )}
        <RunViewSummary view={runView} onChange={setRunView} runs={runs} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onArchiveOldVersions}>Archive old</button>
          <button type="button" className="btn px-2 py-1 text-xs text-status-failed" onClick={onDeleteOldVersions}>Delete old</button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => setImportOpen(true)}
          >
            Import
          </button>
        </div>
      </div>

      <div
        className={`sticky top-[var(--header-h)] z-20 mb-3 flex items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/10 backdrop-blur-sm px-3 py-2 text-sm transition-opacity ${selectedCount > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden={selectedCount === 0}
      >
        <span className="min-w-0 truncate text-fg">
          {selectedCount}
          <span className="hidden md:inline"> run{selectedCount === 1 ? "" : "s"}</span> selected
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn px-2 py-1 text-xs touch:min-h-[40px]"
            onClick={() => {
              setMoreOpen(false);
              selectNone();
            }}
          >
            Clear
          </button>
          <button
            ref={tagBtnRef}
            type="button"
            className="btn px-2 py-1 text-xs touch:min-h-[40px]"
            onClick={() => setTagPopoverOpen((v) => !v)}
            disabled={selectedCount === 0}
          >
            Tag
          </button>
          <button
            type="button"
            className="btn gap-1 px-2 py-1 text-xs touch:min-h-[40px]"
            onClick={() => void onShowInWorkspace()}
            disabled={selectedCount === 0}
          >
            Show in workspace
          </button>
          {/* Secondary actions sit inline from md up and behind "More" below it. */}
          <div className="hidden items-center gap-2 md:flex">
            {selectionActions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`btn px-2 py-1 text-xs${a.danger ? " text-status-failed" : ""}`}
                onClick={(e) => a.onClick(e.currentTarget)}
                disabled={a.disabled}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="relative md:hidden">
            <button
              ref={moreBtnRef}
              type="button"
              className="btn px-2 py-1 text-xs touch:min-h-[40px]"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              disabled={selectedCount === 0}
            >
              More
            </button>
            {moreOpen && selectedCount > 0 && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMoreOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 flex w-48 flex-col rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
                >
                  {selectionActions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      role="menuitem"
                      className={`min-h-[40px] px-3 text-left text-sm hover:bg-bg-hover disabled:opacity-50 ${a.danger ? "text-status-failed" : "text-fg"}`}
                      onClick={() => {
                        setMoreOpen(false);
                        a.onClick(moreBtnRef.current);
                      }}
                      disabled={a.disabled}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <BulkTagEditor
        open={tagPopoverOpen}
        onClose={() => setTagPopoverOpen(false)}
        anchorRef={tagBtnRef}
        selectedRunIds={selected}
        runs={runs}
      />

      {sorted.length === 0 ? (
        <p className="text-fg-muted">No runs match the filters.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((row) =>
              row.kind === "group" ? (
                <li key={row.node.id} style={{ marginLeft: row.node.depth * 12 }}>
                  <GroupHeader
                    by={row.node.by}
                    label={row.node.label}
                    count={row.node.runs.length}
                    collapsed={collapsed.has(row.node.id)}
                    onToggle={() => toggleGroup(row.node.id)}
                    name={row.node.by.source === "group" && row.node.label != null ? { to: groupWorkspacePath(projectId, row.node.label) } : null}
                  />
                </li>
              ) : (
                renderMobileRun(row.run, row.key, row.depth)
              ),
            )}
          </ul>
          {/* overflow-x-auto, not -hidden: metric and param columns are
              unbounded in number and must stay reachable. The checkbox,
              Name and pinned columns stay frozen on the left. */}
          <div className="runs-table hidden overflow-x-auto overflow-y-hidden rounded-lg border border-border md:block">
            <RunsTable
              projectId={projectId}
              rows={rows}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
              grouped={plainNames}
              latestByName={latestByName}
              colorOf={(r) => colors.get(r.id)}
              hidden={(r) => runView.hidden.includes(r.id)}
              lead={{
                kind: "check",
                selected,
                onToggle: toggleRow,
                all: allVisibleSelected ? "all" : someVisibleSelected ? "some" : "none",
                onToggleAll: onHeaderCheckbox,
                onToggleGroup: (node) => setSelected((prev) => toggleGroupSelection(node.runs, prev)),
              }}
              nameExtras={nameExtras}
              columns={{
                frozen: layout.frozen,
                scroll: layout.scroll,
                widthOf,
                cell: renderCell,
                header: (col, frozen, style) => {
                  const sortIdx = sort.findIndex((k) => k.column === col);
                  return (
                    <ColumnTh
                      key={col}
                      column={col}
                      label={columnLabel(col, computed)}
                      title={col}
                      sortKey={sortIdx >= 0 ? sort[sortIdx]! : null}
                      sortRank={sort.length > 1 && sortIdx >= 0 ? sortIdx + 1 : null}
                      numeric={isNumericColumn(col)}
                      pinned={layout.frozen.indexOf(col) > 0}
                      frozen={frozen}
                      style={style}
                      onResize={(width, final) => {
                        if (!final) setDragWidth({ column: col, width: clampColumnWidth(width) });
                        else {
                          setDragWidth(null);
                          setColumns(setWidth(columns, col, width));
                        }
                      }}
                      onResetWidth={() => setColumns(setWidth(columns, col, null))}
                      onSort={(additive) => setSort(toggleSort(sort, col, additive))}
                      onMenu={(anchor) => {
                        menuAnchorRef.current = anchor;
                        setMenuColumn((c) => (c === col ? null : col));
                      }}
                      onDropColumn={(dragged) => {
                        if (dragged === col || dragged === "name" || col === "name") return;
                        const draggedPinned = columns.pinned.includes(dragged);
                        if (draggedPinned !== columns.pinned.includes(col)) return;
                        setColumns(moveColumn(columns, layout.scroll, dragged, col));
                      }}
                    />
                  );
                },
              }}
            />
          </div>
        </>
      )}
      <Popover
        open={menuColumn !== null}
        onClose={() => setMenuColumn(null)}
        anchorRef={menuAnchorRef}
        title={menuColumn ? columnLabel(menuColumn, computed) : ""}
        titleAnchored
        width={240}
        align="start"
        role="menu"
        bodyClassName="p-1"
      >
        {menuColumn && (
          <ColumnMenu
            column={menuColumn}
            columns={columns}
            sort={sort}
            computed={computed}
            better={isNumericColumn(menuColumn) && menuColumn !== "duration" ? (betterByColumn.get(menuColumn) ?? null) : undefined}
            onColumns={setColumns}
            onSort={setSort}
            onComputed={setComputed}
            onMove={(d) => {
              const list = columns.pinned.includes(menuColumn) ? layout.frozen.slice(1) : layout.scroll;
              const i = list.indexOf(menuColumn);
              if (d < 0) {
                if (i <= 0) return;
                setColumns(moveColumn(columns, layout.scroll, menuColumn, list[i - 1]!));
              } else {
                if (i < 0 || i >= list.length - 1) return;
                setColumns(moveColumn(columns, layout.scroll, menuColumn, list[i + 2] ?? null));
              }
            }}
            onClose={() => setMenuColumn(null)}
          />
        )}
      </Popover>
      <Popover open={columnsOpen} onClose={() => setColumnsOpen(false)} anchorRef={columnsBtnRef} title="Columns" titleAnchored width={360} align="start" bodyClassName="p-3">
        <ColumnManager
          available={available}
          columns={columns}
          computed={computed}
          onColumns={setColumns}
          onComputed={setComputed}
        />
      </Popover>
      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />
      {q.isFetchingNextPage && (
        <p className="py-4 text-center text-sm text-fg-muted">Loading more runs...</p>
      )}
      <ImportRunsDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
    </RunViewContext.Provider>
  );
}

// Per-row tag editing. Each instance owns a `useSetTags` mutation scoped to
// its own run, so tag edits invalidate that run's detail cache in addition
// to the runs list/infinite queries.
function RunTagCell({
  run,
  variant,
  allTags,
  addingTagFor,
  onStartAdd,
  onCancelAdd,
  newTagValue,
  setNewTagValue,
}: {
  run: Run;
  variant: "mobile" | "desktop";
  allTags: string[];
  addingTagFor: string | null;
  onStartAdd: (runId: string) => void;
  onCancelAdd: () => void;
  newTagValue: string;
  setNewTagValue: (v: string) => void;
}) {
  const setTags = useSetTags(run.id);
  const tags = safeJsonParse<string[]>(run.tags) ?? [];

  const removeTag = (tag: string) => {
    setTags.mutate(tags.filter((t) => t !== tag));
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    setTags.mutate([...tags, trimmed], { onSuccess: onCancelAdd });
  };

  const removeBtnClass =
    variant === "desktop"
      ? "text-fg-subtle hover:text-status-failed can-hover:opacity-0 can-hover:group-hover/tag:opacity-100 transition-opacity -mr-0.5"
      : "text-fg-subtle hover:text-status-failed -mr-0.5 touch:-my-2 touch:inline-flex touch:h-8 touch:min-w-8 touch:items-center touch:justify-center";

  const onRemoveClick = (e: React.MouseEvent, tag: string) => {
    if (variant === "desktop") e.stopPropagation();
    removeTag(tag);
  };
  const onAddClick = (e: React.MouseEvent) => {
    if (variant === "desktop") e.stopPropagation();
    onStartAdd(run.id);
  };

  return (
    <>
      {tags.map((t) => (
        <span
          key={t}
          className="group/tag mono inline-flex items-center gap-0.5 rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-fg-muted"
        >
          {t}
          <button
            type="button"
            className={removeBtnClass}
            onClick={(e) => onRemoveClick(e, t)}
            title={variant === "desktop" ? `Remove tag "${t}"` : undefined}
            aria-label={`Remove tag "${t}"`}
          >
            {"×"}
          </button>
        </span>
      ))}
      {addingTagFor === run.id ? (
        <TagInput
          className="w-20"
          value={newTagValue}
          onChange={setNewTagValue}
          onCommit={addTag}
          onCancel={onCancelAdd}
          suggestions={allTags}
          exclude={tags}
          autoFocus
          placeholder="tag..."
        />
      ) : (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded border border-dashed border-border-subtle px-1 py-0.5 text-xs text-fg-subtle hover:text-fg hover:border-border touch:min-h-8 touch:min-w-8"
          onClick={onAddClick}
          title="Add tag"
        >
          +
        </button>
      )}
    </>
  );
}

/** A compact summary of the project run view with a reset, shown only when something is set. */
function RunViewSummary({ view, onChange, runs }: { view: RunView; onChange: (next: RunView) => void; runs: Run[] }) {
  if (view.hidden.length === 0 && view.pinned.length === 0 && !view.baseline) return null;
  const baseline = view.baseline ? runs.find((r) => r.id === view.baseline) : undefined;
  const parts = [
    view.hidden.length > 0 ? `${view.hidden.length} hidden` : null,
    view.pinned.length > 0 ? `${view.pinned.length} pinned` : null,
    view.baseline ? `baseline ${baseline?.display_name ?? view.baseline}` : null,
  ].filter(Boolean);
  return (
    <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
      <span className="mono truncate">{parts.join(" · ")}</span>
      <button
        type="button"
        className="rounded px-1 hover:text-fg"
        onClick={() => onChange({ hidden: [], pinned: [], baseline: null })}
        title="Show all runs, unpin all, clear the baseline"
      >
        reset
      </button>
    </span>
  );
}

const COLUMN_DRAG_TYPE = "application/x-cairn-column";

function ColumnTh({
  column,
  label,
  title,
  sortKey,
  sortRank,
  numeric,
  pinned,
  frozen,
  style,
  onSort,
  onMenu,
  onDropColumn,
  onResize,
  onResetWidth,
}: {
  column: string;
  label: string;
  title: string;
  sortKey: SortKey | null;
  sortRank: number | null;
  numeric: boolean;
  pinned: boolean;
  frozen: { className: string; style: React.CSSProperties } | null;
  style?: React.CSSProperties;
  onSort: (additive: boolean) => void;
  onMenu: (anchor: HTMLElement) => void;
  onDropColumn: (dragged: string) => void;
  /** A width dragged to (`final` on release). */
  onResize: (width: number, final: boolean) => void;
  onResetWidth: () => void;
}) {
  const [over, setOver] = useState(false);
  const thRef = useRef<HTMLTableCellElement>(null);
  const resizing = useRef(false);
  const startResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    const th = thRef.current;
    if (!th || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width;
    const at = (ev: PointerEvent) => w0 + ev.clientX - x0;
    const move = (ev: PointerEvent) => onResize(at(ev), false);
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      resizing.current = false;
      onResize(at(ev), true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const arrow = sortKey ? (sortKey.direction === "asc" ? "↑" : "↓") : "";
  return (
    <th
      className={`group/th relative cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:text-fg ${numeric ? "mono" : ""} ${
        frozen?.className ?? ""
      } ${over ? "outline outline-1 -outline-offset-1 outline-accent" : ""}`}
      ref={thRef}
      style={frozen?.style ?? style}
      title={`${title}\nClick to sort, shift-click to add a sort key, drag to reorder, drag the right edge to resize`}
      onClick={(e) => onSort(e.shiftKey)}
      aria-sort={sortKey ? (sortKey.direction === "asc" ? "ascending" : "descending") : "none"}
      draggable={column !== "name"}
      onDragStart={(e) => {
        if (resizing.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(COLUMN_DRAG_TYPE, column);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const dragged = e.dataTransfer.getData(COLUMN_DRAG_TYPE);
        if (dragged) onDropColumn(dragged);
      }}
    >
      <span className="flex min-w-0 items-center gap-1">
        {pinned && <i className="fa-solid fa-thumbtack text-[9px] text-fg-subtle" aria-hidden="true" />}
        <span className="truncate">{label}</span>
        {arrow && (
          <span className="shrink-0 text-fg">
            {arrow}
            {sortRank !== null && <sup className="text-[9px]">{sortRank}</sup>}
          </span>
        )}
        <button
          type="button"
          className="ml-auto shrink-0 rounded px-1 text-fg-subtle hover:bg-bg-hover hover:text-fg can-hover:opacity-0 can-hover:group-hover/th:opacity-100 focus-visible:opacity-100"
          aria-label={`Column options for ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onMenu(e.currentTarget);
          }}
        >
          <i className="fa-solid fa-ellipsis-vertical text-[10px]" aria-hidden="true" />
        </button>
      </span>
      {/* Resize handle on the right edge; double-click resets the width. */}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        title="Drag to resize, double-click to reset"
        className="col-resize absolute inset-y-0 -right-1 z-[3] w-2 cursor-col-resize touch-none touch:-right-2 touch:w-4"
        draggable={false}
        onPointerDown={startResize}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onResetWidth();
        }}
      />
    </th>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-bg-hover disabled:opacity-40 touch:min-h-10";

function ColumnMenu({
  column,
  columns,
  sort,
  computed,
  better,
  onColumns,
  onSort,
  onComputed,
  onMove,
  onClose,
}: {
  column: string;
  columns: ColumnsState;
  sort: SortKey[];
  computed: ComputedColumn[];
  /** The column's resolved better direction; undefined when deltas don't apply. */
  better: Better | null | undefined;
  onColumns: (next: ColumnsState) => void;
  onSort: (next: SortKey[]) => void;
  onComputed: (next: ComputedColumn[]) => void;
  onMove: (dir: -1 | 1) => void;
  onClose: () => void;
}) {
  const { kind, key } = columnKind(column);
  const def = kind === "computed" ? computed.find((c) => c.id === key) : undefined;
  const [editing, setEditing] = useState(false);
  const inSort = sort.some((k) => k.column === column);
  const pinned = columns.pinned.includes(column);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const own = columns.better[column] ?? def?.better;
  const setOwnBetter = (b: Better | null) => {
    if (def) onComputed(computed.map((c) => (c.id === def.id ? { ...c, better: b ?? undefined } : c)));
    else onColumns(setBetter(columns, column, b));
  };
  if (editing && def) {
    return (
      <ComputedForm
        initial={def}
        onSubmit={(next) => {
          onComputed(computed.map((c) => (c.id === def.id ? { ...next, id: def.id } : c)));
          onClose();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="flex flex-col" role="none">
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onSort([{ column, direction: "asc" }]))}>
        <i className="fa-solid fa-arrow-up-short-wide w-3" aria-hidden="true" /> Sort ascending
      </button>
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onSort([{ column, direction: "desc" }]))}>
        <i className="fa-solid fa-arrow-down-wide-short w-3" aria-hidden="true" /> Sort descending
      </button>
      {!inSort ? (
        <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onSort(toggleSort(sort, column, true)))}>
          <i className="fa-solid fa-plus w-3" aria-hidden="true" /> Add to sort
        </button>
      ) : (
        <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onSort(removeSortKey(sort, column)))}>
          <i className="fa-solid fa-xmark w-3" aria-hidden="true" /> Remove from sort
        </button>
      )}
      <div className="my-1 border-t border-border-subtle" />
      {column !== "name" && (
        <>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onColumns(togglePinned(columns, column)))}>
            <i className="fa-solid fa-thumbtack w-3" aria-hidden="true" /> {pinned ? "Unpin" : "Pin (freeze left)"}
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onMove(-1))}>
            <i className="fa-solid fa-arrow-left w-3" aria-hidden="true" /> Move left
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onMove(1))}>
            <i className="fa-solid fa-arrow-right w-3" aria-hidden="true" /> Move right
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onColumns(setHidden(columns, column, true)))}>
            <i className="fa-solid fa-eye-slash w-3" aria-hidden="true" /> Hide column
          </button>
        </>
      )}
      {better !== undefined && (
        <>
          <div className="my-1 border-t border-border-subtle" />
          <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-fg-muted">
            <span className="mr-auto">Better</span>
            {([null, "lower", "higher"] as const).map((b) => (
              <button
                key={b ?? "auto"}
                type="button"
                aria-pressed={(own ?? null) === b}
                className={`rounded border px-1.5 py-0.5 ${(own ?? null) === b ? "border-accent bg-accent/10 text-fg" : "border-border hover:text-fg"}`}
                onClick={() => setOwnBetter(b)}
                title={b === null ? `From the metric's summary rule${better && !own ? ` (${better})` : ""}` : `${b} is better`}
              >
                {b ?? "auto"}
              </button>
            ))}
          </div>
        </>
      )}
      {def && (
        <>
          <div className="my-1 border-t border-border-subtle" />
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => setEditing(true)}>
            <i className="fa-solid fa-pen w-3" aria-hidden="true" /> Edit expression
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${MENU_ITEM} text-status-failed`}
            onClick={act(() => onComputed(computed.filter((c) => c.id !== def.id)))}
          >
            <i className="fa-solid fa-trash w-3" aria-hidden="true" /> Remove column
          </button>
        </>
      )}
    </div>
  );
}

function ComputedForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: ComputedColumn;
  onSubmit: (c: Omit<ComputedColumn, "id">) => void;
  onCancel?: () => void;
}) {
  const [expr, setExpr] = useState(initial?.expr ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [better, setBetterDraft] = useState<Better | "">(initial?.better ?? "");
  const error = expr.trim() ? compileScalarExpr(expr.trim()).error : null;
  return (
    <form
      className="flex flex-col gap-1.5 p-1 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (!expr.trim() || error) return;
        onSubmit({
          expr: expr.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(better ? { better } : {}),
        });
        if (!initial) {
          setExpr("");
          setName("");
          setBetterDraft("");
        }
      }}
    >
      <input
        className={`input mono text-xs ${error ? "border-status-failed" : ""}`}
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        placeholder="min(val.loss)"
        aria-label="Column expression"
        autoFocus={!!initial}
      />
      {error && <p className="text-[10px] text-status-failed">{error}</p>}
      <div className="flex flex-col gap-1">
        <input
          className="input w-full text-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Column name"
        />
        <select
          className="input w-full py-1 text-xs"
          value={better}
          onChange={(e) => setBetterDraft(e.target.value as Better | "")}
          aria-label="Better"
          title="Which way is better, for deltas against the baseline"
        >
          <option value="">better: none</option>
          <option value="lower">lower is better</option>
          <option value="higher">higher is better</option>
        </select>
      </div>
      <div className="flex justify-end gap-1">
        {onCancel && (
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={onCancel}>Cancel</button>
        )}
        <button type="submit" className="btn px-2 py-0.5 text-xs" disabled={!expr.trim() || !!error}>
          {initial ? "Save" : "Add column"}
        </button>
      </div>
    </form>
  );
}

/** Show/hide and pin every column, and add computed expression columns. */
function ColumnManager({
  available,
  columns,
  computed,
  onColumns,
  onComputed,
}: {
  available: string[];
  columns: ColumnsState;
  computed: ComputedColumn[];
  onColumns: (next: ColumnsState) => void;
  onComputed: (next: ComputedColumn[], columns?: ColumnsState) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = available.filter((c) => c !== "name" && (!q || columnLabel(c, computed).toLowerCase().includes(q) || c.toLowerCase().includes(q)));
  const hidden = new Set(columns.hidden);
  const allShown = list.every((c) => !hidden.has(c));
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <input
          className="input min-w-0 flex-1 text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search columns"
          aria-label="Search columns"
        />
        <button
          type="button"
          className="text-[11px] text-fg-subtle hover:text-fg"
          onClick={() => {
            let next = columns;
            for (const c of list) next = setHidden(next, c, allShown);
            onColumns(next);
          }}
        >
          {allShown ? "Hide all" : "Show all"}
        </button>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {list.map((c) => {
          const isPinned = columns.pinned.includes(c);
          return (
            <li key={c} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-bg-hover">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={!hidden.has(c)}
                  onChange={(e) => onColumns(setHidden(columns, c, !e.target.checked))}
                />
                <span className="mono truncate" title={c}>{columnLabel(c, computed)}</span>
                <span className="shrink-0 text-[10px] text-fg-subtle">{columnKind(c).kind === "builtin" ? "" : columnKind(c).kind}</span>
              </label>
              <button
                type="button"
                className={`shrink-0 px-1 ${isPinned ? "text-accent" : "text-fg-subtle hover:text-fg"}`}
                aria-pressed={isPinned}
                aria-label={isPinned ? `Unpin ${c}` : `Pin ${c}`}
                title={isPinned ? "Unpin" : "Pin (freeze left)"}
                onClick={() => onColumns(togglePinned(columns, c))}
              >
                <i className="fa-solid fa-thumbtack text-[10px]" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border-subtle pt-2">
        <p className="mb-1 text-[11px] text-fg-muted">
          Computed column: a scalar expression over <span className="mono">min|max|mean|first|last(metric)</span>,{" "}
          <span className="mono">config.&lt;key&gt;</span>, <span className="mono">summary.&lt;key&gt;</span>.
        </p>
        <ComputedForm onSubmit={(c) => onComputed([...computed, { ...c, id: newId() }])} />
      </div>
    </div>
  );
}
