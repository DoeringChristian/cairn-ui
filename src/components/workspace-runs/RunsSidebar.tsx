/**
 * The workspace page's runs sidebar: the Runs page's table with the Name
 * column only and an eye column in place of the checkboxes. Above it the
 * runs table's toolbar minus Columns (Status, Search, Filter, Group, Latest
 * only), then `3 of 4 groups shown`.
 *
 * The rows come from `useRunsTable` (WorkspacePage), the eyes from
 * lib/workspace-runs/visibility.ts. Every toolbar or eye edit is a run-state
 * edit (`onEdit`), saved into the current view; collapsing is page-local.
 */

import type { Run } from "../../api/types";
import {
  RunFilterControl,
  RunGroupControl,
  RunLatestOnlyToggle,
  RunSearchInput,
  RunStatusSelect,
} from "../RunFilterBar";
import RunsTable from "../runs-table/RunsTable";
import type { useRunsTable } from "../runs-table/use-runs-table";
import { setFilter, setGroupBy, setLatestOnly, setSearch, setStatus, type RunState } from "../../lib/workspace-runs/state";
import { groupEye, toggleGroupEye, toggleRunEye, type Visibility } from "../../lib/workspace-runs/visibility";
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
  /** The colours the cards draw the visible runs in. */
  colors: ReadonlyMap<string, string>;
  onEdit: RunStateEdit;
}

const runName = (r: Run) => r.display_name ?? r.id;

export default function RunsSidebar({ projectId, state, table, visibility, fields, paramKeys, colors, onEdit }: Props) {
  const visible = visibility.runs;
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
            onChange={(levels) => onEdit((s) => setGroupBy(s, levels), "Group runs")}
          />
          <RunLatestOnlyToggle value={state.latestOnly} onChange={(v) => onEdit((s) => setLatestOnly(s, v), "Latest only")} />
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
            grouped={state.groupBy.length > 0}
            latestByName={table.latestByName}
            colorOf={(r) => (visible.has(r.id) ? colors.get(r.id) : null)}
            hidden={(r) => !visible.has(r.id)}
            lead={{
              kind: "eye",
              runEye: (r) => visible.has(r.id),
              groupEye: (n) => groupEye(n, visible),
              onRun: (r) => onEdit((s) => toggleRunEye(s, r, visible), `Toggle ${runName(r)}`),
              onGroup: (n) => onEdit((s) => toggleGroupEye(s, n, visible), `Toggle ${n.label ?? "(none)"}`),
            }}
          />
        </div>
      )}
    </div>
  );
}
