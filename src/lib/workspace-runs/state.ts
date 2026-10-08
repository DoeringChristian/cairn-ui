/**
 * The workspace's run state (pure): the sidebar's runs table toolbar
 * (status, search, filter, group-by, latest only, sort, as on the Runs
 * page) and its eyes, which pick the runs the cards draw. Stored in the
 * current view's document (lib/workspace/doc.ts `runState`), so it saves
 * like layout edits and switching views switches it too; the run page
 * ignores it.
 *
 * The project workspace's state sits at the top level; each group page's
 * (`/p/:projectId/g/:group`) has the same shape under `groups[<group>]`,
 * not grouped by default (`DEFAULT_GROUP_RUN_STATE`).
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

/** A view's run state: the project workspace's, and each group page's by group. */
export interface ViewRunState extends RunState {
  groups: Record<string, RunState>;
}

export const DEFAULT_RUN_STATE: RunState = Object.freeze({
  status: "all",
  search: "",
  filter: EMPTY_FILTER,
  groupBy: [{ source: "group" }],
  latestOnly: false,
  sort: DEFAULT_SORT,
  eyes: {},
}) as RunState;

/** A group page's default: not grouped (one line per run). */
export const DEFAULT_GROUP_RUN_STATE: RunState = Object.freeze({ ...DEFAULT_RUN_STATE, groupBy: [] }) as RunState;

export const DEFAULT_VIEW_RUN_STATE: ViewRunState = Object.freeze({ ...DEFAULT_RUN_STATE, groups: {} }) as ViewRunState;

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

const isSortKey = (v: unknown): v is SortKey =>
  isObj(v) && typeof v.column === "string" && v.column !== "" && (v.direction === "asc" || v.direction === "desc");

/** Coerce a stored value (or nothing) into a valid run state; what does not parse takes its default (`defaults`). */
export function parseRunState(raw: unknown, defaults: RunState = DEFAULT_RUN_STATE): RunState {
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

/** A view's run state: the project's at the top level, the group pages' under `groups`. */
export function parseViewRunState(raw: unknown): ViewRunState {
  if (!isObj(raw)) return DEFAULT_VIEW_RUN_STATE;
  const groups: Record<string, RunState> = {};
  if (isObj(raw.groups)) for (const [g, v] of Object.entries(raw.groups)) if (isObj(v)) groups[g] = parseRunState(v, DEFAULT_GROUP_RUN_STATE);
  return { ...parseRunState(raw), groups };
}

/** The project workspace's part of a view's run state. */
export function projectRunState(v: ViewRunState): RunState {
  const { groups: _groups, ...own } = v;
  return own;
}

/** A group page's run state (its default when it has none yet). */
export const groupRunState = (v: ViewRunState, group: string): RunState => v.groups[group] ?? DEFAULT_GROUP_RUN_STATE;

/** An edit of the project workspace's run state, as an edit of the view's. */
export const editProject =
  (fn: (s: RunState) => RunState) =>
  (v: ViewRunState): ViewRunState => ({ ...fn(projectRunState(v)), groups: v.groups });

/** An edit of a group page's run state, as an edit of the view's. */
export const editGroup =
  (group: string, fn: (s: RunState) => RunState) =>
  (v: ViewRunState): ViewRunState => ({ ...v, groups: { ...v.groups, [group]: fn(groupRunState(v, group)) } });

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
