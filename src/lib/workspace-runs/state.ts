/**
 * The workspace view's run state (pure), shared by the workspace sidebar
 * and the Runs page (wandb: the Runs table belongs to the workspace view):
 * the runs table toolbar (status, search, filter, group-by, latest only,
 * sort), the eyes, which pick the runs the cards draw, the groups toggled
 * open or closed, and the Runs page's column setup (shown, pinned, ordered
 * columns, widths, computed columns). Stored in the current view's document
 * (lib/workspace/doc.ts `runState`), so it saves like layout edits and
 * switching views switches it too; the run page ignores it.
 *
 * Eyes are explicit overrides (visibility.ts): `g:<top-level group>` and
 * `r:<run id>`.
 */

import { EMPTY_FILTER, parseFilter, type GroupNode } from "../run-filter.ts";
import { parseColumnsState, parseComputedColumns, type ColumnsState, type ComputedColumn } from "../runs-table/columns.ts";
import { isGroupBy, type GroupBy } from "../runs-table/group.ts";
import { isStatusFilter, type StatusFilter } from "../runs-table/model.ts";
import { DEFAULT_SORT, type SortKey } from "../runs-table/sort.ts";

export interface RunState {
  status: StatusFilter;
  /** The runs table's regex search. */
  search: string;
  /** The runs table's filter tree. */
  filter: GroupNode;
  /** The runs table's group-by levels. */
  groupBy: GroupBy[];
  latestOnly: boolean;
  /** The runs table's sort keys. */
  sort: SortKey[];
  /** Explicit eyes by key (`g:` / `r:`), overriding the default. */
  eyes: Record<string, boolean>;
  /**
   * Group rows toggled away from their default (lib/runs-table/model.ts
   * `firstGroupOpen`: collapsed or expanded), by node id; cleared when the
   * group-by changes.
   */
  toggled: string[];
  /** The Runs page's columns: order, hidden, pinned, widths. */
  columns: ColumnsState;
  /** The Runs page's computed (expression) columns. */
  computed: ComputedColumn[];
}

export const DEFAULT_RUN_STATE: RunState = Object.freeze({
  status: "all",
  search: "",
  filter: EMPTY_FILTER,
  // Not grouped, as wandb's default workspace: one line per run.
  groupBy: [],
  latestOnly: false,
  sort: DEFAULT_SORT,
  eyes: {},
  toggled: [],
  // A literal, not `EMPTY_COLUMNS` (lib/expr and run-filter import each other: no top-level use of columns.ts).
  columns: { order: [], hidden: [], pinned: [], widths: {} },
  computed: [],
}) as RunState;

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

const isSortKey = (v: unknown): v is SortKey =>
  isObj(v) && typeof v.column === "string" && v.column !== "" && (v.direction === "asc" || v.direction === "desc");

/** Coerce a stored value (or nothing) into a valid run state; what does not parse takes its default. */
export function parseRunState(raw: unknown): RunState {
  const defaults = DEFAULT_RUN_STATE;
  if (!isObj(raw)) return defaults;
  const eyes: Record<string, boolean> = {};
  if (isObj(raw.eyes)) for (const [k, v] of Object.entries(raw.eyes)) if (typeof v === "boolean") eyes[k] = v;
  const sort = Array.isArray(raw.sort) ? raw.sort.filter(isSortKey).map((k) => ({ column: k.column, direction: k.direction })) : [];
  return {
    status: isStatusFilter(raw.status) ? raw.status : defaults.status,
    search: typeof raw.search === "string" ? raw.search : "",
    filter: parseFilter(raw.filter),
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy.filter(isGroupBy) : defaults.groupBy,
    latestOnly: raw.latestOnly === true,
    sort: sort.length > 0 ? sort : defaults.sort,
    eyes,
    toggled: Array.isArray(raw.toggled) ? [...new Set(raw.toggled.filter((t): t is string => typeof t === "string"))] : [],
    columns: parseColumnsState(raw.columns),
    computed: parseComputedColumns(raw.computed),
  };
}

// --- edits ------------------------------------------------------------------

export const setStatus = (s: RunState, status: StatusFilter): RunState => ({ ...s, status });
export const setSearch = (s: RunState, search: string): RunState => ({ ...s, search });
export const setFilter = (s: RunState, filter: GroupNode): RunState => ({ ...s, filter });
export const setGroupBy = (s: RunState, groupBy: GroupBy[]): RunState => ({ ...s, groupBy, toggled: [] });
export const setLatestOnly = (s: RunState, latestOnly: boolean): RunState => ({ ...s, latestOnly });
export const setSort = (s: RunState, sort: SortKey[]): RunState => ({ ...s, sort });
export const setColumns = (s: RunState, columns: ColumnsState): RunState => ({ ...s, columns });
export const setComputed = (s: RunState, computed: ComputedColumn[]): RunState => ({ ...s, computed });

/** A group row's open/closed toggled (away from its default, or back). */
export function toggleGroupOpen(s: RunState, id: string): RunState {
  const toggled = s.toggled.includes(id) ? s.toggled.filter((t) => t !== id) : [...s.toggled, id];
  return { ...s, toggled };
}

/** Explicit eyes for several keys (`on`), or back to their default (`null`). */
export function setEyes(s: RunState, keys: readonly string[], on: boolean | null): RunState {
  if (keys.length === 0) return s;
  const eyes = { ...s.eyes };
  for (const k of keys) {
    if (on === null) delete eyes[k];
    else eyes[k] = on;
  }
  return { ...s, eyes };
}
