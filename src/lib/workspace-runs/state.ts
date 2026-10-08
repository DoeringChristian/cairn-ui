/**
 * The workspace's run state (pure): what the sidebar lists and which runs
 * the cards draw. Stored in the current view's document (lib/workspace/doc.ts
 * `runState`), so it saves like layout edits and switching views switches it
 * too; the run page ignores it.
 *
 * Search, filter and group-by are the runs table's (lib/runs-table/search.ts,
 * lib/run-filter.ts, lib/runs-table/group.ts). How the sidebar lists runs
 * follows the group-by levels (`listMode`): exactly `[group]` lists groups
 * with version picks, any other levels nest plain runs, none lists runs.
 *
 * Eyes are keyed by entry: `g:<group>` (a group), `u:<name key>` (an
 * ungrouped name), `k:<levels>:<node id>` (a group of other group-by
 * levels) and `r:<run id>` (a run). A group, ungrouped name or flat run
 * without an explicit eye is visible when it is among the newest
 * `DEFAULT_VISIBLE` listed entries (visibility.ts); nested groups and runs
 * inside a visible group are visible unless their eye is off.
 */

import { EMPTY_FILTER, parseFilter, type GroupNode } from "../run-filter.ts";
import { groupByLabel, isGroupBy, type GroupBy } from "../runs-table/group.ts";
import type { GroupPicks } from "./picks.ts";

/** How the sidebar lists runs: groups with version picks, nested groups of runs, or runs. */
export type ListMode = "group" | "nested" | "flat";

export function listMode(levels: readonly GroupBy[]): ListMode {
  if (levels.length === 0) return "flat";
  return levels.length === 1 && levels[0]!.source === "group" ? "group" : "nested";
}

/** A group's version picks: the lineage-consistent latest runs, or custom picks. */
export type GroupMode = "latest" | { picks: GroupPicks };

export interface RunState {
  /** The runs table's regex search. */
  search: string;
  /** The runs table's filter tree. */
  filter: GroupNode;
  /** The runs table's group-by levels. */
  groupBy: GroupBy[];
  /** Explicit eyes by entry key (`g:` / `u:` / `r:`), overriding the default. */
  eyes: Record<string, boolean>;
  /** Per group, the name keys whose eye is off (left out of the group's lines). */
  hiddenNames: Record<string, string[]>;
  /** Per group its mode; absent is `latest`. */
  groups: Record<string, GroupMode>;
  /** Ungrouped names' picked run (name key → run id); absent is the newest version. */
  ungrouped: Record<string, string>;
}

export const DEFAULT_RUN_STATE: RunState = Object.freeze({
  search: "",
  filter: EMPTY_FILTER,
  groupBy: [{ source: "group" }],
  eyes: {},
  hiddenNames: {},
  groups: {},
  ungrouped: {},
}) as RunState;

export const groupKey = (group: string) => `g:${group}`;
export const ungroupedKey = (name: string) => `u:${name}`;
export const runKey = (id: string) => `r:${id}`;
/** A nested group (`listMode` "nested"): its levels down to it and its node id (lib/runs-table/group.ts). */
export const nodeKey = (levels: readonly GroupBy[], depth: number, nodeId: string) =>
  `k:${levels.slice(0, depth + 1).map(groupByLabel).join(" › ")}:${nodeId}`;

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

function picksOf(v: unknown): GroupPicks | null {
  if (!isObj(v)) return null;
  const out: GroupPicks = {};
  for (const [k, id] of Object.entries(v)) if (typeof id === "string" || id === null) out[k] = id;
  return out;
}

/** Coerce a stored value (or nothing) into a valid run state. */
export function parseRunState(raw: unknown): RunState {
  if (!isObj(raw)) return DEFAULT_RUN_STATE;
  const eyes: Record<string, boolean> = {};
  if (isObj(raw.eyes)) for (const [k, v] of Object.entries(raw.eyes)) if (typeof v === "boolean") eyes[k] = v;
  const hiddenNames: Record<string, string[]> = {};
  if (isObj(raw.hiddenNames)) {
    for (const [g, v] of Object.entries(raw.hiddenNames)) {
      const names = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
      if (names.length) hiddenNames[g] = names;
    }
  }
  const groups: Record<string, GroupMode> = {};
  if (isObj(raw.groups)) {
    for (const [g, v] of Object.entries(raw.groups)) {
      const picks = isObj(v) ? picksOf(v.picks) : null;
      if (picks) groups[g] = { picks };
    }
  }
  const ungrouped: Record<string, string> = {};
  if (isObj(raw.ungrouped)) for (const [k, v] of Object.entries(raw.ungrouped)) if (typeof v === "string") ungrouped[k] = v;
  return {
    search: typeof raw.search === "string" ? raw.search : "",
    filter: parseFilter(raw.filter),
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy.filter(isGroupBy) : DEFAULT_RUN_STATE.groupBy,
    eyes,
    hiddenNames,
    groups,
    ungrouped,
  };
}

// --- edits ------------------------------------------------------------------

export const setSearch = (s: RunState, search: string): RunState => ({ ...s, search });
export const setFilter = (s: RunState, filter: GroupNode): RunState => ({ ...s, filter });
export const setGroupBy = (s: RunState, groupBy: GroupBy[]): RunState => ({ ...s, groupBy });

/** An explicit eye for an entry. */
export const setEye = (s: RunState, key: string, on: boolean): RunState => ({ ...s, eyes: { ...s.eyes, [key]: on } });

/** Explicit eyes for several entries. */
export const setEyes = (s: RunState, keys: readonly string[], on: boolean): RunState =>
  keys.length === 0 ? s : { ...s, eyes: { ...s.eyes, ...Object.fromEntries(keys.map((k) => [k, on])) } };

/** Entries back to their default eye. */
export function clearEyes(s: RunState, keys: readonly string[]): RunState {
  if (!keys.some((k) => k in s.eyes)) return s;
  const eyes = { ...s.eyes };
  for (const k of keys) delete eyes[k];
  return { ...s, eyes };
}

/** Name rows of `group` hidden (true) or shown again. */
export function setNamesHidden(s: RunState, group: string, names: readonly string[], hidden: boolean): RunState {
  const cur = s.hiddenNames[group] ?? [];
  const next = hidden ? [...new Set([...cur, ...names])] : cur.filter((n) => !names.includes(n));
  const hiddenNames = { ...s.hiddenNames };
  if (next.length) hiddenNames[group] = next;
  else delete hiddenNames[group];
  return { ...s, hiddenNames };
}

/**
 * A group's eye clicked. `eye` is what it shows: on → hide the group; off →
 * show it (with every name again when all were off); mixed → every name on.
 */
export function toggleGroupEye(s: RunState, group: string, eye: "on" | "off" | "mixed", names: readonly string[]): RunState {
  if (eye === "on") return setEye(s, groupKey(group), false);
  const all = setNamesHidden(s, group, names, false);
  if (eye === "mixed") return all;
  const allHidden = names.length > 0 && names.every((n) => (s.hiddenNames[group] ?? []).includes(n));
  return setEye(allHidden ? all : s, groupKey(group), true);
}

/** A name row's eye clicked; turning one on in a hidden group shows the group too. */
export function toggleNameEye(s: RunState, group: string, name: string, groupVisible: boolean): RunState {
  const hidden = (s.hiddenNames[group] ?? []).includes(name);
  if (!groupVisible) {
    return setEye(setNamesHidden(s, group, [name], false), groupKey(group), true);
  }
  return setNamesHidden(s, group, [name], !hidden);
}

/** Back to the group's latest runs. */
export function setGroupLatest(s: RunState, group: string): RunState {
  if (!(group in s.groups)) return s;
  const groups = { ...s.groups };
  delete groups[group];
  return { ...s, groups };
}

export const setGroupPicks = (s: RunState, group: string, picks: GroupPicks): RunState => ({
  ...s,
  groups: { ...s.groups, [group]: { picks } },
});

export const pickUngrouped = (s: RunState, name: string, runId: string): RunState => ({
  ...s,
  ungrouped: { ...s.ungrouped, [name]: runId },
});
