/**
 * A report cell's run sets (the cell's **Runs** button):
 *
 * ```
 * ┌ Run sets ──────────────────────────────────────────────┐
 * │ ● lr sweep        12 runs    [Edit] [✕]                │
 * │ ● baselines        2 runs    [Edit] [✕]                │
 * │ + Add run set        ⤓ Insert from workspace           │
 * └────────────────────────────────────────────────────────┘
 * ```
 *
 * Each row: the set's colour family dot, its name, how many runs it
 * resolves to now, **Edit** and **✕** (the last set cannot be removed).
 * **Edit** opens the set's name and the workspace's runs sidebar
 * (RunsSidebar: the shared runs table with eyes and its toolbar) over the
 * project's runs, scoped to the set: its filter, group-by, Latest only, sort
 * and eyes are the set's (lib/run-sets.ts); Status and Search only narrow
 * what the editor lists. **+ Add run set** adds a default set, **⤓ Insert
 * from workspace** a set copying the workspace view's run state (and, in a
 * cell without cards, the workspace layout's cards; lib/reports/insert-from-workspace.ts).
 * Read-only (view mode, share links): the list alone.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Run } from "../../api/types";
import { filterFieldsOf } from "../../lib/run-filter";
import { availableColumns } from "../../lib/runs-table/columns";
import { firstGroupOpen, type StatusFilter } from "../../lib/runs-table/model";
import {
  addRunSet,
  canRemoveRunSet,
  removeRunSet,
  renameRunSet,
  runSetFamilyColor,
  updateRunSet,
  type RunSet,
} from "../../lib/run-sets";
import { useRunColors } from "../../lib/run-view";
import { DEFAULT_RUN_STATE, type RunState } from "../../lib/workspace-runs/state";
import { resolveVisibility } from "../../lib/workspace-runs/visibility";
import { RunSwatch } from "../RunViewControls";
import { useRunsTable } from "../runs-table/use-runs-table";
import RunsSidebar, { type RunStateEdit } from "../workspace-runs/RunsSidebar";

interface Props {
  projectId: string;
  sets: readonly RunSet[];
  /** Each set's runs (null while loading). */
  resolved: string[][] | null;
  /** The project's runs the sets resolve over (lib/run-sets.ts `RUN_SET_POOL`). */
  pool: readonly Run[];
  /** Absent: read-only. */
  onChange?: (next: RunSet[]) => void;
  /** "⤓ Insert from workspace" (absent: read-only). */
  onInsertFromWorkspace?: () => Promise<void>;
  /** Extra controls in the header. */
  actions?: ReactNode;
}

const ROW_BTN =
  "inline-flex h-6 touch:h-10 items-center justify-center rounded border border-border bg-bg px-2 text-xs text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-muted";
const LINK_BTN = "text-xs text-fg-muted hover:text-accent disabled:opacity-40";

export default function RunSetsPanel({ projectId, sets, resolved, pool, onChange, onInsertFromWorkspace, actions }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [inserting, setInserting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  // The cards' colours: each set its own family with several sets, else the usual id colours.
  const all = useMemo(() => [...new Set((resolved ?? []).flat())], [resolved]);
  const colors = useRunColors(all);

  if (editing !== null && onChange && editing < sets.length) {
    return (
      <RunSetEditor
        projectId={projectId}
        set={sets[editing]!}
        pool={pool}
        colors={colors}
        onChange={(fn) => onChange(updateRunSet(sets, editing, fn))}
        onRename={(name) => onChange(renameRunSet(sets, editing, name))}
        onDone={() => setEditing(null)}
      />
    );
  }

  const insert = async () => {
    if (!onInsertFromWorkspace) return;
    setInserting(true);
    setInsertError(null);
    try {
      await onInsertFromWorkspace();
    } catch (e) {
      setInsertError(e instanceof Error ? e.message : String(e));
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="card flex flex-col gap-2 p-3" data-testid="run-sets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-fg-muted">Run sets</span>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {sets.length === 0 && <p className="text-xs text-fg-subtle">No run sets: this cell shows no runs.</p>}
      <ul className="flex flex-col">
        {sets.map((set, i) => {
          const n = resolved?.[i]?.length;
          return (
            <li key={i} className="flex min-w-0 items-center gap-2 border-t border-border-subtle py-1.5 first:border-t-0" data-run-set={set.name}>
              <RunSwatch color={runSetFamilyColor(i)} />
              <span className="mono min-w-0 flex-1 truncate text-sm text-fg" title={set.name}>
                {set.name}
              </span>
              <span className="mono num shrink-0 text-xs text-fg-muted">
                {n == null ? "…" : `${n} run${n === 1 ? "" : "s"}`}
              </span>
              {onChange && (
                <>
                  <button type="button" className={ROW_BTN} onClick={() => setEditing(i)} aria-label={`Edit ${set.name}`}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={ROW_BTN}
                    onClick={() => onChange(removeRunSet(sets, i))}
                    disabled={!canRemoveRunSet(sets)}
                    aria-label={`Remove ${set.name}`}
                    title={canRemoveRunSet(sets) ? "Remove this run set" : "The last run set cannot be removed"}
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {onChange && (
        <div className="flex flex-wrap items-center gap-4 border-t border-border-subtle pt-2">
          <button type="button" className={LINK_BTN} onClick={() => onChange(addRunSet(sets))}>
            + Add run set
          </button>
          {onInsertFromWorkspace && (
            <button
              type="button"
              className={LINK_BTN}
              onClick={() => void insert()}
              disabled={inserting}
              title="Add a run set copying the workspace's filter, grouping, Latest only, sort and eyes"
            >
              {inserting ? "Inserting…" : "⤓ Insert from workspace"}
            </button>
          )}
          {insertError && <span className="text-xs text-status-failed">{insertError}</span>}
        </div>
      )}
    </div>
  );
}

const NO_COMPUTED: never[] = [];
const NO_PINS: string[] = [];
const NO_GROUP_COLORS = new Map<string, string>();

/** **Edit**: the set's name and the runs sidebar scoped to it. */
function RunSetEditor({
  projectId,
  set,
  pool,
  colors,
  onChange,
  onRename,
  onDone,
}: {
  projectId: string;
  set: RunSet;
  pool: readonly Run[];
  colors: ReadonlyMap<string, string>;
  onChange: (fn: (s: RunSet) => RunSet) => void;
  onRename: (name: string) => void;
  onDone: () => void;
}) {
  // Status and Search only narrow the list: a run set has neither.
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const state: RunState = { ...DEFAULT_RUN_STATE, status, search, filter: set.filter, groupBy: set.groupBy, latestOnly: set.latestOnly, sort: set.sort, eyes: set.eyes };

  const filterFields = useMemo(() => filterFieldsOf(pool), [pool]);
  const paramKeys = useMemo(
    () => filterFields.filter((f) => f.startsWith("params.")).map((f) => f.slice("params.".length)),
    [filterFields],
  );
  const sortColumns = useMemo(() => availableColumns(pool, NO_COMPUTED).filter((c) => c !== "tags"), [pool]);
  const query = { runs: pool, filter: set.filter, latestOnly: set.latestOnly, groupBy: set.groupBy, sort: set.sort, computed: NO_COMPUTED, pinned: NO_PINS };
  // The set's runs (lib/run-sets.ts `resolveRunSet`: what the cards draw) and the runs listed here.
  const full = useRunsTable({ ...query, status: "all", search: "" });
  const table = useRunsTable({ ...query, status, search, defaultCollapsed: firstGroupOpen });
  const visibility = useMemo(() => resolveVisibility(full.sorted, full.groups, set.eyes), [full.sorted, full.groups, set.eyes]);

  const edit: RunStateEdit = (fn) => {
    const next = fn(state);
    if (next.status !== status) setStatus(next.status);
    if (next.search !== search) setSearch(next.search);
    if (next.filter !== state.filter || next.groupBy !== state.groupBy || next.latestOnly !== state.latestOnly || next.sort !== state.sort || next.eyes !== state.eyes) {
      onChange((s) => ({ ...s, filter: next.filter, groupBy: next.groupBy, latestOnly: next.latestOnly, sort: next.sort, eyes: next.eyes }));
    }
  };

  return (
    <div className="card flex flex-col" data-testid="run-set-editor">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <button type="button" className={LINK_BTN} onClick={onDone}>
          ← Run sets
        </button>
        <label className="ml-2 flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-muted">
          Name
          <input
            className="input min-w-0 flex-1 py-1 text-sm"
            value={set.name}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Run set name"
          />
        </label>
      </div>
      <RunsSidebar
        projectId={projectId}
        state={state}
        table={table}
        visibility={visibility}
        fields={filterFields}
        paramKeys={paramKeys}
        sortColumns={sortColumns}
        colors={colors}
        groupOf={null}
        groupColors={NO_GROUP_COLORS}
        runs={pool}
        onEdit={edit}
      />
    </div>
  );
}
