/**
 * The workspace sidebar (pure): the project's non-archived runs matching
 * the search, as entries.
 *
 * Group by group: one entry per group (ordered by its newest run), each with
 * one row per name (upstream → downstream by lineage, ties by first run) and
 * that name's picked version, then one entry per ungrouped name (newest
 * first), last. Group by none: one entry per run, newest first.
 *
 * A group's lineage graph (`GET …/groups/{group}/graph`) supplies the edges;
 * until it loads the group has none (every name's newest version).
 */

import type { Run } from "../../api/types.ts";
import { nameKey, nameLabel, type GroupGraph, type GroupGraphRun } from "./graph.ts";
import { fits, latestPicks, nameOrder, resolvePicks, usedRuns, versionsOf, type GroupPicks } from "./picks.ts";
import { groupKey, runKey, ungroupedKey, type GroupBy, type RunState } from "./state.ts";
import { visibleKeys } from "./visibility.ts";

export type ListedRun = Pick<
  Run,
  "id" | "display_name" | "group" | "version" | "status" | "created_at" | "ended_at" | "archived"
>;

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
  newest: string;
  visible: boolean;
}

export interface RunEntry {
  kind: "run";
  key: string;
  run: ListedRun;
  newest: string;
  visible: boolean;
}

export interface SidebarList {
  groupBy: GroupBy;
  groups: GroupEntry[];
  ungrouped: UngroupedEntry[];
  runs: RunEntry[];
  /** `showing <visible> of <listed>` entries. */
  listed: number;
  visible: number;
}

/** Case-insensitive substring of the run's name, id or group. */
export function matchesSearch(run: Pick<Run, "id" | "display_name" | "group">, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [run.display_name, run.id, run.group].some((s) => s != null && s.toLowerCase().includes(q));
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
      used: pick ? usedRuns(graph, pick).map(runLabel) : [],
      eye: !hidden.includes(key),
    };
  });
}

/**
 * Build the sidebar. `graphs` are the fetched group graphs (missing: not
 * loaded yet).
 */
export function buildList(
  runs: readonly ListedRun[],
  state: RunState,
  graphs: ReadonlyMap<string, GroupGraph>,
): SidebarList {
  const listed = runs.filter((r) => !r.archived && matchesSearch(r, state.search)).sort(byNewest);

  if (state.groupBy === "none") {
    const entries = listed.map((run) => ({ kind: "run" as const, key: runKey(run.id), run, newest: run.created_at, visible: false }));
    const vis = visibleKeys(entries, state.eyes);
    for (const e of entries) e.visible = vis.has(e.key);
    return { groupBy: "none", groups: [], ungrouped: [], runs: entries, listed: entries.length, visible: vis.size };
  }

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
    const pick = stored && versions.some((v) => v.id === stored) ? stored : versions[0]!.id;
    return {
      kind: "ungrouped",
      key: ungroupedKey(name),
      name,
      label: nameLabel(graphRun(versions[0]!)),
      versions: versions.map((v) => ({ runId: v.id, label: versionLabel(v), fits: true, note: null })),
      pick,
      newest: versions[0]!.created_at,
      visible: false,
    };
  });

  const vis = visibleKeys([...groups, ...ungrouped], state.eyes);
  for (const g of groups) {
    g.visible = vis.has(g.key);
    const off = g.names.filter((n) => !n.eye).length;
    g.eye = !g.visible || (g.names.length > 0 && off === g.names.length) ? "off" : off > 0 ? "mixed" : "on";
  }
  for (const u of ungrouped) u.visible = vis.has(u.key);
  return {
    groupBy: "group",
    groups,
    ungrouped,
    runs: [],
    listed: groups.length + ungrouped.length,
    visible: vis.size,
  };
}

export interface CardRuns {
  /** The runs the cards draw, in sidebar order. */
  runIds: string[];
  /** Grouped runs' group (Group by group only): scalar cards draw one line per group. */
  groupOf: Map<string, string>;
}

/**
 * The runs given to the cards: with Group by group the picked, eye-on runs
 * of visible groups plus visible ungrouped names' picks; with Group by none
 * every visible run.
 */
export function runsForCards(list: SidebarList): CardRuns {
  const runIds: string[] = [];
  const groupOf = new Map<string, string>();
  if (list.groupBy === "none") {
    for (const e of list.runs) if (e.visible) runIds.push(e.run.id);
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
 * for both Group by modes; the search is cleared so they are listed.
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
  return { ...s, search: "", eyes, ungrouped };
}
