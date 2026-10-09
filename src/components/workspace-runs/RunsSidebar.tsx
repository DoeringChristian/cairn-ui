/**
 * The workspace's runs sidebar: the Runs page's table with the Name
 * column only and an eye in place of each checkbox (in the Name cell). Above it the runs table's toolbar minus Columns
 * (Status, Search, Filter, Group, Latest only) plus the sort, then
 * `3 of 4 groups shown`.
 *
 * The rows come from `useRunsTable` (RunsWorkspace), the eyes from
 * lib/workspace-runs/visibility.ts; the header eye shows or hides every
 * listed run. Every toolbar or eye edit is a run-state edit (`onEdit`),
 * saved into the current view; collapsed groups are kept for the session. Pinned runs (the
 * project run view's) are listed first whatever the filters, with a pin
 * toggle on row hover. Hovering a row or a group header highlights its
 * line(s) in the charts (grouped: the innermost group's line), and a hovered line lights its row
 * (lib/workspace-runs/hover.ts). A group's name filters the workspace to
 * the group (visibility.ts `filterToGroup`).
 */

import type { Run } from "../../api/types";
import {
  RunFilterControl,
  RunGroupControl,
  RunLatestOnlyToggle,
  RunSearchInput,
  RunStatusSelect,
} from "../RunFilterBar";
import CopyId from "../CopyId";
import RunViewControls, { type RunViewToggle } from "../RunViewControls";

/** The run view toggles a sidebar row offers (its eye is the workspace's own). */
const SIDEBAR_TOGGLES: readonly RunViewToggle[] = ["pin", "baseline"];
import RunsTable from "../runs-table/RunsTable";
import type { useRunsTable } from "../runs-table/use-runs-table";
import { columnKind, columnLabel } from "../../lib/runs-table/columns";
import { groupLineLabel, type RunGroupNode } from "../../lib/runs-table/group";
import { sameGroup } from "../../lib/runs-table/model";
import { DEFAULT_SORT, initialDirection, type SortKey } from "../../lib/runs-table/sort";
import type { RunViewContextValue } from "../../lib/run-view";
import { targetOfRun, useRunHover } from "../../lib/workspace-runs/hover";
import { setFilter, setLatestOnly, setSearch, setSort, setStatus, type RunState } from "../../lib/workspace-runs/state";
import { allEye, filterToGroup, groupEye, regroup, toggleAllEyes, toggleGroupEye, toggleRunEye, type Visibility } from "../../lib/workspace-runs/visibility";
import "../../pages/runs-table.css";

export type RunStateEdit = (fn: (s: RunState) => RunState, label: string, mergeKey?: string) => void;

interface Props {
  projectId: string;
  state: RunState;
  table: ReturnType<typeof useRunsTable>;
  visibility: Visibility;
  /** Filterable fields and group-by param keys (the runs table's). */
  fields: string[];
  paramKeys: string[];
  /** The columns the runs can be sorted by (the runs table's). */
  sortColumns: string[];
  /** The colours the cards draw the visible runs in. */
  colors: ReadonlyMap<string, string>;
  /** Grouped: each drawn run's innermost group line (its line is the group's); null: one line per run. */
  groupOf: ReadonlyMap<string, string> | null;
  /** The innermost groups' colours (lib/run-color.ts `groupLineColors`). */
  groupColors: ReadonlyMap<string, string>;
  /** The project run view: its pinned runs (a pin toggle per row); absent: none. */
  runView?: RunViewContextValue;
  /** The run links' history state (the workspace's: the run page's "← Workspace"). */
  runLinkState?: unknown;
  /** Every run the sidebar lists from (a group's name filters to its runs). */
  runs: readonly Run[];
  onEdit: RunStateEdit;
}

const runName = (r: Run) => r.display_name ?? r.id;

/** A sort column's label in the sort control: `created`, `name`, a metric or param key. */
const sortLabel = (col: string) => (columnKind(col).kind === "builtin" ? columnLabel(col, []).toLowerCase() : columnLabel(col, []));

/** `Sort: created ↓`: the column (the runs table's sortable keys) and a direction flip. */
function RunSortControl({ columns, sort, onChange }: { columns: string[]; sort: SortKey[]; onChange: (next: SortKey[]) => void }) {
  const key = sort[0] ?? DEFAULT_SORT[0]!;
  const options = columns.includes(key.column) ? columns : [key.column, ...columns];
  const desc = key.direction === "desc";
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
      <label className="flex min-w-0 items-center gap-1">
        Sort:
        <select
          className="input min-w-0 max-w-[8rem] py-1 text-xs"
          value={key.column}
          onChange={(e) => onChange([{ column: e.target.value, direction: initialDirection(e.target.value) }])}
          aria-label="Sort runs by"
        >
          {options.map((c) => (
            <option key={c} value={c}>
              {sortLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn px-1.5 py-0.5 text-xs"
        onClick={() => onChange([{ ...key, direction: desc ? "asc" : "desc" }])}
        aria-label={desc ? "Sorted descending: sort ascending" : "Sorted ascending: sort descending"}
        title={desc ? "Descending" : "Ascending"}
      >
        {desc ? "↓" : "↑"}
      </button>
    </span>
  );
}

export default function RunsSidebar({
  projectId,
  state,
  table,
  visibility,
  fields,
  paramKeys,
  sortColumns,
  colors,
  groupOf,
  groupColors,
  runView,
  runLinkState,
  runs,
  onEdit,
}: Props) {
  const visible = visibility.runs;
  const hover = useRunHover();
  const target = hover.target;
  const grouped = state.groupBy.length > 0;
  /** An innermost group header's line (outer groups have none). */
  const groupLine = (n: RunGroupNode) => (n.children === null ? groupLineLabel(n.path) : null);
  return (
    <div className="flex flex-col" data-testid="runs-sidebar">
      <div className="flex flex-col gap-1.5 px-3 pb-2 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Runs</h2>
        <div className="flex items-center gap-2">
          <RunStatusSelect value={state.status} onChange={(v) => onEdit((s) => setStatus(s, v), "Filter runs by status")} />
          <label className="flex min-w-0 flex-1 items-center gap-1 text-xs text-fg-muted">
            Search
            <RunSearchInput
              className="w-0 min-w-0 flex-1"
              value={state.search}
              error={table.runSearch.error}
              onChange={(v) => onEdit((s) => setSearch(s, v), "Search runs", "search")}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunFilterControl fields={fields} filter={state.filter} onChange={(f) => onEdit((s) => setFilter(s, f), "Filter runs")} />
          <RunGroupControl
            className="min-w-0 max-w-[12rem]"
            paramKeys={paramKeys}
            levels={state.groupBy}
            onChange={(levels) => onEdit((s) => regroup(s, levels, table.sorted, visible), "Group runs")}
          />
          <RunLatestOnlyToggle value={state.latestOnly} onChange={(v) => onEdit((s) => setLatestOnly(s, v), "Latest only")} />
          <RunSortControl columns={sortColumns} sort={state.sort} onChange={(sort) => onEdit((s) => setSort(s, sort), "Sort runs")} />
        </div>
        <p className="text-xs text-fg-muted" data-testid="runs-showing">
          {visibility.shown} of {visibility.listed} {visibility.unit} shown
        </p>
      </div>
      {table.sorted.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-fg-subtle">No runs match the filters.</p>
      ) : (
        <div className="runs-table border-t border-border">
          <RunsTable
            projectId={projectId}
            rows={table.rows}
            collapsed={table.collapsed}
            onToggleGroup={table.toggleGroup}
            grouped={grouped || sameGroup(table.sorted)}
            latestByName={table.latestByName}
            colorOf={(r) => (visible.has(r.id) ? colors.get(r.id) : null)}
            groupColors={groupColors}
            groupHidden={(n) => groupEye(n, visible) === "off"}
            listed={table.sorted.length}
            hidden={(r) => !visible.has(r.id)}
            lead={{
              kind: "eye",
              runEye: (r) => visible.has(r.id),
              groupEye: (n) => groupEye(n, visible),
              onRun: (r) => onEdit((s) => toggleRunEye(s, r, visible), `Toggle ${runName(r)}`),
              onGroup: (n) => onEdit((s) => toggleGroupEye(s, n, visible), `Toggle ${n.label ?? "(none)"}`),
              all: allEye(table.sorted, visible),
              onAll: () => onEdit((s) => toggleAllEyes(s, table.sorted, table.groups, visible), "Toggle every run"),
            }}
            groupName={(g) => ({ onClick: () => onEdit((s) => filterToGroup(s, g, runs), `Filter to ${g}`) })}
            runLinkState={runLinkState}
            nameExtras={
              runView
                ? (r) => (
                    <>
                      {/* As the Runs page's Name cell: set toggles stay, and on hover the copyable id
                          and every toggle overlay the end of the cell (no layout shift). The eye
                          is the sidebar's own, so the run view's "hide" toggle is left out. */}
                      <span className="ml-auto shrink-0">
                        <RunViewControls runId={r.id} view={runView.view} onChange={runView.set} toggles={SIDEBAR_TOGGLES} show="active" />
                      </span>
                      <span className="absolute inset-y-0 right-0 hidden items-center gap-1 bg-bg-elevated pl-2 group-hover/row:flex touch:flex">
                        <CopyId id={r.id} className="text-xs" />
                        <RunViewControls runId={r.id} view={runView.view} onChange={runView.set} toggles={SIDEBAR_TOGGLES} show="all" />
                      </span>
                    </>
                  )
                : undefined
            }
            hover={
              hover.active
                ? {
                    runHot: (r) => target?.runId === r.id,
                    groupHot: (n) => grouped && target?.group != null && groupLine(n) === target.group,
                    onRun: (r) => hover.set(r ? targetOfRun(r.id, groupOf) : null),
                    onGroup: (n) => {
                      const g = n ? groupLine(n) : null;
                      hover.set(g != null && groupOf ? { group: g } : null);
                    },
                  }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
