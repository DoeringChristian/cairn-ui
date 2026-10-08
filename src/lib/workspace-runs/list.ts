/**
 * The workspace sidebar (pure): the project's non-archived runs matching
 * the search and the filter (the runs table's), as entries.
 *
 * Group by group (`listMode` "group"): one entry per group (ordered by its
 * newest run), each with one row per name (upstream → downstream by
 * lineage, ties by first run) holding that name's picked run (or "not run
 * yet"), then one entry per ungrouped name (newest first), last. Other
 * group-by levels ("nested"): the runs table's nested groups of runs; the
 * cards aggregate by the top-level group. No levels ("flat"): one entry per
 * run, newest first.
 *
 * A group's lineage graph (`GET …/groups/{group}/graph`) supplies the edges;
 * until it loads the group has none (every name's newest version).
 */

import type { Run } from "../../api/types.ts";
import { EMPTY_FILTER, matchesFilter } from "../run-filter.ts";
import { groupRunsNested, type GroupBy, type RunGroupNode } from "../runs-table/group.ts";
import { compileRunSearch, matchesRunSearch } from "../runs-table/search.ts";
import { nameKey, nameLabel, type GroupGraph, type GroupGraphRun } from "./graph.ts";
import { fits, latestPicks, nameOrder, resolvePicks, usedRuns, versionsOf, type GroupPicks } from "./picks.ts";
import {
  clearEyes,
  groupKey,
  listMode,
  nodeKey,
  runKey,
  setEye,
  setEyes,
  ungroupedKey,
  type ListMode,
  type RunState,
} from "./state.ts";
import { visibleKeys } from "./visibility.ts";

export type ListedRun = Run;

export interface VersionOption {
  runId: string;
  /** `v2` (a short id for an unnamed run). */
  label: string;
  /** Fits the group's other picks (always true outside a group). */
  fits: boolean;
  /** Why not, muted: `on train v1`. */
  note: string | null;
}

export interface NameRow {
  /** Name key (graph.ts `nameKey`). */
  key: string;
  label: string;
  /** Newest first. */
  versions: VersionOption[];
  /** The picked run; null: "not run yet". */
  pick: string | null;
  /** The picked run (its name and version for the row). */
  run: GroupGraphRun | null;
  /** What the picked run used inside the group: `prepare v2`. */
  used: string[];
  /** The name's eye (off: left out of the group's lines). */
  eye: boolean;
}

export type Eye = "on" | "off" | "mixed";

export interface GroupEntry {
  kind: "group";
  key: string;
  group: string;
  custom: boolean;
  names: NameRow[];
  /** The resolved picks (name key → run id | null). */
  picks: GroupPicks;
  /** The group's graph over its listed runs (picks.ts works on it). */
  graph: GroupGraph;
  newest: string;
  visible: boolean;
  eye: Eye;
}

export interface UngroupedEntry {
  kind: "ungrouped";
  key: string;
  /** Name key. */
  name: string;
  label: string;
  versions: VersionOption[];
  pick: string;
  /** The picked run. */
  run: ListedRun;
  newest: string;
  visible: boolean;
}

export interface RunEntry {
  kind: "run";
  key: string;
  /** Unique among the listed rows (a run with several tags is listed under each). */
  rowKey: string;
  run: ListedRun;
  newest: string;
  visible: boolean;
  /** Nested: the keys of the groups it is listed under, outermost first. */
  path: string[];
  /** Nested: its top-level group's label (null: no value). */
  top: string | null;
}

/** A group of other group-by levels (lib/runs-table/group.ts `RunGroupNode`). */
export interface NodeEntry {
  kind: "node";
  key: string;
  /** The node id (unique in the tree): collapse state. */
  id: string;
  by: GroupBy;
  label: string | null;
  depth: number;
  count: number;
  newest: string;
  visible: boolean;
  eye: Eye;
  /** Sub-groups; null at the deepest level. */
  children: NodeEntry[] | null;
  /** The deepest level's runs ([] above it). */
  runs: RunEntry[];
}

export interface SidebarList {
  mode: ListMode;
  /** Group by group. */
  groups: GroupEntry[];
  ungrouped: UngroupedEntry[];
  /** The ungrouped block's eye. */
  ungroupedEye: Eye;
  /** Nested. */
  nodes: NodeEntry[];
  /** Flat. */
  runs: RunEntry[];
  /** `<visible> of <listed> <unit> shown`. */
  listed: number;
  visible: number;
  unit: "groups" | "runs";
}

/** The runs the sidebar lists: not archived, matching the search and the filter, newest first. */
export function listedRuns(runs: readonly ListedRun[], state: Pick<RunState, "search" | "filter">): ListedRun[] {
  const search = compileRunSearch(state.search);
  return runs
    .filter((r) => !r.archived && matchesRunSearch(r, search) && matchesFilter(r, state.filter))
    .sort(byNewest);
}

const byNewest = (a: ListedRun, b: ListedRun) =>
  b.created_at.localeCompare(a.created_at) || (b.version ?? -1) - (a.version ?? -1) || (a.id < b.id ? -1 : 1);

/** A listed run as a graph run: named when it has a version (graph.ts `nameKey`). */
export function graphRun(r: ListedRun, fetched?: GroupGraphRun): GroupGraphRun {
  return {
    id: r.id,
    name: fetched ? fetched.name : r.version != null ? r.display_name : null,
    display_name: r.display_name,
    version: r.version,
    status: r.status,
    created_at: r.created_at,
    ended_at: r.ended_at,
  };
}

/** The group's graph over its listed runs: the fetched graph's edges between them. */
export function groupGraphOf(group: string, runs: readonly ListedRun[], fetched: GroupGraph | undefined): GroupGraph {
  const fetchedRuns = new Map((fetched?.runs ?? []).map((r) => [r.id, r]));
  const ids = new Set(runs.map((r) => r.id));
  return {
    group,
    runs: runs.map((r) => graphRun(r, fetchedRuns.get(r.id))),
    edges: (fetched?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

const versionLabel = (r: Pick<GroupGraphRun, "id" | "version">) => (r.version != null ? `v${r.version}` : r.id.slice(0, 6));
/** `train v1`. */
export const runLabel = (r: GroupGraphRun) => `${nameLabel(r)}${r.version != null ? ` v${r.version}` : ""}`;

function nameRows(graph: GroupGraph, picks: GroupPicks, hidden: readonly string[]): NameRow[] {
  const byId = new Map(graph.runs.map((r) => [r.id, r]));
  return nameOrder(graph).map((key) => {
    const versions = versionsOf(graph, key);
    const pick = picks[key] ?? null;
    return {
      key,
      label: nameLabel(versions[0]!),
      versions: versions.map((v) => {
        const ok = v.id === pick || fits(graph, picks, key, v.id);
        let note: string | null = null;
        if (!ok) {
          const used = usedRuns(graph, v.id);
          if (used.length) note = `on ${used.map(runLabel).join(", ")}`;
          else {
            const users = Object.values(picks)
              .filter((p): p is string => p != null && !fits(graph, { [nameKey(byId.get(p)!)]: p }, key, v.id))
              .map((p) => runLabel(byId.get(p)!));
            note = users.length ? `not used by ${users.join(", ")}` : null;
          }
        }
        return { runId: v.id, label: versionLabel(v), fits: ok, note };
      }),
      pick,
      run: pick ? byId.get(pick)! : null,
      used: pick ? usedRuns(graph, pick).map(runLabel) : [],
      eye: !hidden.includes(key),
    };
  });
}

const eyeOf = (visible: boolean, on: number, total: number): Eye =>
  !visible || (total > 0 && on === 0) ? "off" : on < total ? "mixed" : "on";

/**
 * Build the sidebar. `graphs` are the fetched group graphs (missing: not
 * loaded yet).
 */
export function buildList(
  runs: readonly ListedRun[],
  state: RunState,
  graphs: ReadonlyMap<string, GroupGraph>,
): SidebarList {
  const listed = listedRuns(runs, state);
  const mode = listMode(state.groupBy);
  const empty = { groups: [], ungrouped: [], ungroupedEye: "off" as Eye, nodes: [], runs: [] };
  if (mode === "flat") {
    const entries = listed.map((run) => runEntry(run, run.id, [], null));
    const vis = visibleKeys(entries, state.eyes);
    for (const e of entries) e.visible = vis.has(e.key);
    return { ...empty, mode, runs: entries, listed: entries.length, visible: vis.size, unit: "runs" };
  }
  if (mode === "nested") {
    const nodes = nestedEntries(listed, state);
    return { ...empty, mode, nodes, listed: nodes.length, visible: nodes.filter((n) => n.visible).length, unit: "groups" };
  }
  return groupedList(listed, state, graphs);
}

const runEntry = (run: ListedRun, rowKey: string, path: string[], top: string | null): RunEntry => ({
  kind: "run",
  key: runKey(run.id),
  rowKey,
  run,
  newest: run.created_at,
  visible: false,
  path,
  top,
});

function nestedEntries(listed: readonly ListedRun[], state: RunState): NodeEntry[] {
  const levels = state.groupBy;
  const build = (n: RunGroupNode, path: string[], top: string | null): NodeEntry => {
    const key = nodeKey(levels, n.depth, n.id);
    const inner = [...path, key];
    return {
      kind: "node",
      key,
      id: n.id,
      by: n.by,
      label: n.label,
      depth: n.depth,
      count: n.runs.length,
      newest: n.runs[0]!.created_at,
      visible: false,
      eye: "off",
      children: n.children ? n.children.map((c) => build(c, inner, top)) : null,
      runs: n.children ? [] : n.runs.map((r) => runEntry(r, `${n.id}:${r.id}`, inner, top)),
    };
  };
  const nodes = (groupRunsNested(listed, levels) ?? []).map((n) => build(n, [], n.label));
  const top = visibleKeys(nodes, state.eyes);
  // Visibility top-down; a group's eye from its runs.
  const settle = (n: NodeEntry, parentVisible: boolean): RunEntry[] => {
    n.visible = n.depth === 0 ? top.has(n.key) : parentVisible && (state.eyes[n.key] ?? true);
    const under = n.children ? n.children.flatMap((c) => settle(c, n.visible)) : n.runs;
    for (const r of n.runs) r.visible = n.visible && (state.eyes[r.key] ?? true);
    n.eye = eyeOf(n.visible, under.filter((r) => r.visible).length, under.length);
    return under;
  };
  for (const n of nodes) settle(n, true);
  return nodes;
}

/** Every run row under a nested group. */
export function runsUnder(n: NodeEntry): RunEntry[] {
  return n.children ? n.children.flatMap(runsUnder) : n.runs;
}

function nodesUnder(n: NodeEntry): NodeEntry[] {
  return (n.children ?? []).flatMap((c) => [c, ...nodesUnder(c)]);
}

/**
 * A nested group's eye clicked: on → hide it; mixed → every group and run
 * under it back on; off → show it (and everything under it again when no
 * run under it would show).
 */
export function toggleNodeEye(s: RunState, n: NodeEntry): RunState {
  if (n.eye === "on") return setEye(s, n.key, false);
  const inner = [...nodesUnder(n).map((c) => c.key), ...runsUnder(n).map((r) => r.key)];
  if (n.eye === "mixed") return clearEyes(s, inner);
  const shown = setEye(s, n.key, true);
  return n.visible || runsUnder(n).every((r) => s.eyes[r.key] === false) ? clearEyes(shown, inner) : shown;
}

/** A nested run's eye clicked; turning one on shows the groups it is under. */
export function toggleRunEye(s: RunState, e: RunEntry): RunState {
  if (e.visible) return setEye(s, e.key, false);
  return setEyes(setEye(s, e.key, true), e.path, true);
}

function groupedList(listed: readonly ListedRun[], state: RunState, graphs: ReadonlyMap<string, GroupGraph>): SidebarList {
  const byGroup = new Map<string, ListedRun[]>();
  const loose: ListedRun[] = [];
  for (const r of listed) {
    if (r.group == null) {
      loose.push(r);
      continue;
    }
    let list = byGroup.get(r.group);
    if (!list) byGroup.set(r.group, (list = []));
    list.push(r);
  }

  const groups: GroupEntry[] = [...byGroup].map(([group, members]) => {
    const graph = groupGraphOf(group, members, graphs.get(group));
    const mode = state.groups[group];
    const picks = mode && mode !== "latest" ? resolvePicks(graph, mode.picks) : latestPicks(graph);
    const names = nameRows(graph, picks, state.hiddenNames[group] ?? []);
    return {
      kind: "group",
      key: groupKey(group),
      group,
      custom: !!mode && mode !== "latest",
      names,
      picks,
      graph,
      newest: members[0]!.created_at,
      visible: false,
      eye: "off",
    };
  });

  const byName = new Map<string, ListedRun[]>();
  for (const r of loose) {
    const k = nameKey(graphRun(r));
    let list = byName.get(k);
    if (!list) byName.set(k, (list = []));
    list.push(r);
  }
  const ungrouped: UngroupedEntry[] = [...byName].map(([name, versions]) => {
    const stored = state.ungrouped[name];
    const run = versions.find((v) => v.id === stored) ?? versions[0]!;
    return {
      kind: "ungrouped",
      key: ungroupedKey(name),
      name,
      label: nameLabel(graphRun(versions[0]!)),
      versions: versions.map((v) => ({ runId: v.id, label: versionLabel(v), fits: true, note: null })),
      pick: run.id,
      run,
      newest: versions[0]!.created_at,
      visible: false,
    };
  });

  const vis = visibleKeys([...groups, ...ungrouped], state.eyes);
  for (const g of groups) {
    g.visible = vis.has(g.key);
    g.eye = eyeOf(g.visible, g.names.filter((n) => n.eye).length, g.names.length);
  }
  for (const u of ungrouped) u.visible = vis.has(u.key);
  const looseOn = ungrouped.filter((u) => u.visible).length;
  return {
    mode: "group",
    groups,
    ungrouped,
    ungroupedEye: eyeOf(true, looseOn, ungrouped.length),
    nodes: [],
    runs: [],
    listed: groups.length + (ungrouped.length > 0 ? 1 : 0),
    visible: groups.filter((g) => g.visible).length + (looseOn > 0 ? 1 : 0),
    unit: "groups",
  };
}

export interface CardRuns {
  /** The runs the cards draw, in sidebar order. */
  runIds: string[];
  /** Grouped runs' (top-level) group: scalar cards draw one line per group. */
  groupOf: Map<string, string>;
}

/**
 * The runs given to the cards: with Group by group the picked, eye-on runs
 * of visible groups plus visible ungrouped names' picks; nested, every
 * visible run, grouped by its top-level group (a run listed under several,
 * by tags, goes with the first); flat, every visible run.
 */
export function runsForCards(list: SidebarList): CardRuns {
  const runIds: string[] = [];
  const groupOf = new Map<string, string>();
  if (list.mode === "flat") {
    for (const e of list.runs) if (e.visible) runIds.push(e.run.id);
    return { runIds, groupOf };
  }
  if (list.mode === "nested") {
    const seen = new Set<string>();
    for (const e of list.nodes.flatMap(runsUnder)) {
      if (!e.visible || seen.has(e.run.id)) continue;
      seen.add(e.run.id);
      runIds.push(e.run.id);
      if (e.top != null) groupOf.set(e.run.id, e.top);
    }
    return { runIds, groupOf };
  }
  for (const g of list.groups) {
    if (!g.visible) continue;
    for (const n of g.names) {
      if (!n.eye || n.pick == null) continue;
      runIds.push(n.pick);
      groupOf.set(n.pick, g.group);
    }
  }
  for (const u of list.ungrouped) if (u.visible) runIds.push(u.pick);
  return { runIds, groupOf };
}

/**
 * "Show in workspace" (the runs table): only the ticked runs' groups and
 * ticked ungrouped runs (their name, at the newest ticked version) visible,
 * for every Group by; the search and the filter are cleared so they are
 * listed.
 * `runs` are the project's runs, so every other entry gets an explicit eye
 * off.
 */
export function showOnly(s: RunState, runs: readonly ListedRun[], ticked: ReadonlySet<string>): RunState {
  const eyes: Record<string, boolean> = {};
  const ungrouped = { ...s.ungrouped };
  for (const r of [...runs].filter((r) => !r.archived).sort(byNewest)) {
    const on = ticked.has(r.id);
    eyes[runKey(r.id)] = on;
    const key = r.group != null ? groupKey(r.group) : ungroupedKey(nameKey(graphRun(r)));
    if (on && !eyes[key] && r.group == null) ungrouped[nameKey(graphRun(r))] = r.id;
    eyes[key] = (eyes[key] ?? false) || on;
  }
  return { ...s, search: "", filter: EMPTY_FILTER, eyes, ungrouped };
}
