/**
 * The workspace's run state (pure): the sidebar's runs table toolbar
 * (status, search, filter, group-by, latest only, sort, as on the Runs
 * page) and its eyes, which pick the runs the cards draw. Stored in the
 * current view's document (lib/workspace/doc.ts `runState`), so it saves
 * like layout edits and switching views switches it too; the run page
 * ignores it.
 *
 * Eyes are explicit overrides (visibility.ts): `g:<top-level group>` and
 * `r:<run id>`.
 */

import { EMPTY_FILTER, parseFilter, type GroupNode } from "../run-filter.ts";
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
  };
}

// --- edits ------------------------------------------------------------------

export const setStatus = (s: RunState, status: StatusFilter): RunState => ({ ...s, status });
export const setSearch = (s: RunState, search: string): RunState => ({ ...s, search });
export const setFilter = (s: RunState, filter: GroupNode): RunState => ({ ...s, filter });
export const setGroupBy = (s: RunState, groupBy: GroupBy[]): RunState => ({ ...s, groupBy });
export const setLatestOnly = (s: RunState, latestOnly: boolean): RunState => ({ ...s, latestOnly });
export const setSort = (s: RunState, sort: SortKey[]): RunState => ({ ...s, sort });

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
