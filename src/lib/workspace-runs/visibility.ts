/**
 * Which of the sidebar's runs the workspace's cards draw (pure). Grouped,
 * the `DEFAULT_VISIBLE` newest top-level groups are visible and so are
 * their runs; not grouped, the `DEFAULT_VISIBLE` newest runs. An explicit
 * eye wins: `g:<top-level group>` over the group's default, `r:<run id>`
 * over everything, so a new run shows up on its own while old ones drop
 * out.
 *
 * A group's eye shows its runs (◉ all, ○ none, ◐ some); clicking it sets
 * every run under it the other way.
 */

import type { Run } from "../../api/types.ts";
import { EMPTY_FILTER, type ChipNode, type FilterNode, type GroupNode } from "../run-filter.ts";
import { aggregates, groupByLabel, groupLineLabel, groupRunsNested, type RunGroupNode } from "../runs-table/group.ts";
import { setEyes, type RunState } from "./state.ts";

/** How many of the newest groups (runs) are visible by default. */
export const DEFAULT_VISIBLE = 10;

export type Eye = "on" | "off" | "mixed";

export const runKey = (id: string) => `r:${id}`;
/** A top-level group's eye key: `g:group:exp-44`. */
export const groupKey = (node: Pick<RunGroupNode, "by" | "label">) => `g:${groupByLabel(node.by)}:${node.label ?? "∅"}`;

interface Ranked {
  key: string;
  /** The entry's newest run (ISO time). */
  newest: string;
}

/** The visible keys among `entries`: an explicit eye, else among the newest `DEFAULT_VISIBLE`. */
export function visibleKeys(entries: readonly Ranked[], eyes: Readonly<Record<string, boolean>>): Set<string> {
  const ranked = [...entries].sort((a, b) => b.newest.localeCompare(a.newest) || (a.key < b.key ? -1 : 1));
  const out = new Set<string>();
  ranked.forEach((e, rank) => {
    if (eyes[e.key] ?? rank < DEFAULT_VISIBLE) out.add(e.key);
  });
  return out;
}

const newestOf = (runs: readonly Run[]) => runs.reduce((m, r) => (r.created_at > m ? r.created_at : m), "");

export interface Visibility {
  /** The visible run ids. */
  runs: Set<string>;
  /** `<shown> of <listed> <unit> shown`: groups with a visible run, or visible runs. */
  shown: number;
  listed: number;
  unit: "groups" | "runs";
}

/** `sorted`: the listed runs; `groups`: their groups (null: not grouped). */
export function resolveVisibility(
  sorted: readonly Run[],
  groups: readonly RunGroupNode[] | null,
  eyes: Readonly<Record<string, boolean>>,
): Visibility {
  if (!groups) {
    const vis = visibleKeys(sorted.map((r) => ({ key: runKey(r.id), newest: r.created_at })), eyes);
    const runs = new Set(sorted.filter((r) => vis.has(runKey(r.id))).map((r) => r.id));
    return { runs, shown: runs.size, listed: sorted.length, unit: "runs" };
  }
  const top = visibleKeys(groups.map((g) => ({ key: groupKey(g), newest: newestOf(g.runs) })), eyes);
  const byDefault = new Set<string>();
  for (const g of groups) if (top.has(groupKey(g))) for (const r of g.runs) byDefault.add(r.id);
  const runs = new Set(sorted.filter((r) => eyes[runKey(r.id)] ?? byDefault.has(r.id)).map((r) => r.id));
  return { runs, shown: groups.filter((g) => g.runs.some((r) => runs.has(r.id))).length, listed: groups.length, unit: "groups" };
}

/** A group's eye: its runs all visible, none, or some. */
export function groupEye(node: RunGroupNode, visible: ReadonlySet<string>): Eye {
  const on = node.runs.filter((r) => visible.has(r.id)).length;
  return on === 0 ? "off" : on === node.runs.length ? "on" : "mixed";
}

/**
 * A group's eye clicked: every run under it hidden (all visible) or shown
 * (otherwise). A top-level group keeps that as its own eye, its runs back
 * to following it; a nested group sets its runs' eyes.
 */
export function toggleGroupEye(s: RunState, node: RunGroupNode, visible: ReadonlySet<string>): RunState {
  const on = groupEye(node, visible) !== "on";
  const runKeys = node.runs.map((r) => runKey(r.id));
  if (node.depth === 0) return setEyes(setEyes(s, runKeys, null), [groupKey(node)], on);
  return setEyes(s, runKeys, on);
}

/** The header eye: every listed run visible, none, or some. */
export function allEye(sorted: readonly Pick<Run, "id">[], visible: ReadonlySet<string>): Eye {
  const on = sorted.filter((r) => visible.has(r.id)).length;
  return on === 0 ? "off" : on === sorted.length ? "on" : "mixed";
}

/**
 * The header eye clicked: every listed run hidden (all visible) or shown
 * (otherwise). Grouped, as every top-level group's eye (its runs back to
 * following it); not grouped, every run's.
 */
export function toggleAllEyes(
  s: RunState,
  sorted: readonly Run[],
  groups: readonly RunGroupNode[] | null,
  visible: ReadonlySet<string>,
): RunState {
  const on = allEye(sorted, visible) !== "on";
  const runKeys = sorted.map((r) => runKey(r.id));
  if (!groups) return setEyes(s, runKeys, on);
  return setEyes(setEyes(s, runKeys, null), groups.map(groupKey), on);
}

/**
 * The Group by changed: what is visible stays visible. The default ("the
 * newest `DEFAULT_VISIBLE`") counts groups when grouped and runs when not,
 * and a top-level group's eye means nothing under another grouping, so
 * every listed run's eye is set from what is shown now and the group eyes
 * are dropped. Runs not listed keep their eyes.
 */
export function regroup(s: RunState, groupBy: RunState["groupBy"], listed: readonly Pick<Run, "id">[], visible: ReadonlySet<string>): RunState {
  const eyes: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(s.eyes)) if (!k.startsWith("g:")) eyes[k] = v;
  for (const r of listed) eyes[runKey(r.id)] = visible.has(r.id);
  return { ...s, groupBy, eyes };
}

/** A run's eye clicked. */
export const toggleRunEye = (s: RunState, run: Pick<Run, "id">, visible: ReadonlySet<string>): RunState =>
  setEyes(s, [runKey(run.id)], !visible.has(run.id));

export interface CardRuns {
  /** The visible runs, in table order. */
  runIds: string[];
  /**
   * Grouped: a run's innermost group line (`group: exp-44, jobType: train`,
   * lib/runs-table/group.ts `groupLineLabel`). Runs without a value are
   * never averaged: a run under a `(none)` at any level (`aggregates`) has
   * none and stays its own line.
   */
  groupOf: Map<string, string>;
}

/** The runs given to the cards and, grouped, the innermost group line each one aggregates into (none under a `(none)`). */
export function cardRuns(sorted: readonly Run[], groups: readonly RunGroupNode[] | null, visible: ReadonlySet<string>): CardRuns {
  const groupOf = new Map<string, string>();
  if (!groups) return { runIds: sorted.filter((r) => visible.has(r.id)).map((r) => r.id), groupOf };
  const runIds: string[] = [];
  const seen = new Set<string>();
  const walk = (ns: readonly RunGroupNode[]) => {
    for (const n of ns) {
      if (n.children) {
        walk(n.children);
        continue;
      }
      const line = aggregates(n) ? groupLineLabel(n.path) : null;
      for (const r of n.runs) {
        if (!visible.has(r.id) || seen.has(r.id)) continue;
        seen.add(r.id);
        runIds.push(r.id);
        if (line != null) groupOf.set(r.id, line);
      }
    }
  };
  walk(groups);
  return { runIds, groupOf };
}

/**
 * "Show in workspace" (the Runs page): exactly the ticked runs visible and
 * nothing else, grouped or not. Grouped, every top-level group's eye is off
 * and the ticked runs' own eyes on, so a group shows ◐ when it has other
 * runs and its aggregate line is over the ticked runs only. The status,
 * search, filter and latest only are cleared so every ticked run is
 * listed. `runs`: the runs the page lists from.
 */
export function showOnly(s: RunState, runs: readonly Run[], ticked: ReadonlySet<string>): RunState {
  const eyes: Record<string, boolean> = {};
  for (const r of runs) eyes[runKey(r.id)] = ticked.has(r.id);
  for (const g of groupRunsNested(runs, s.groupBy) ?? []) eyes[groupKey(g)] = false;
  return { ...s, status: "all", search: "", filter: EMPTY_FILTER, latestOnly: false, eyes };
}

const isGroupCondition = (n: FilterNode): boolean => n.kind === "chip" && n.field === "group" && n.op === "exact";

/**
 * The filter with the condition `group = <group>`: it replaces the root's
 * existing `group =` condition (a click picks one group), else it is added
 * (an OR root is kept whole, AND-ed with it).
 */
export function withGroupCondition(filter: GroupNode, group: string): GroupNode {
  const chip: ChipNode = { kind: "chip", field: "group", op: "exact", arg: group };
  if (filter.op === "or" && filter.children.length > 0) return { kind: "group", op: "and", children: [filter, chip] };
  const children: FilterNode[] = [];
  let placed = false;
  for (const n of filter.children) {
    if (!isGroupCondition(n)) children.push(n);
    else if (!placed) {
      children.push(chip);
      placed = true;
    }
  }
  if (!placed) children.push(chip);
  return { kind: "group", op: "and", children };
}

/**
 * A group's name clicked (the sidebar, a runs table group header, the run
 * page's group badge): the workspace filtered to the group, as the filter's
 * `group = <group>` condition. The eyes stay, except that the group's runs
 * hidden by them or by the newest-`DEFAULT_VISIBLE` default are shown: a
 * top-level group's off eye goes back to its default, then every still
 * hidden run gets its own eye on. `runs`: the runs the workspace lists from.
 */
export function filterToGroup(s: RunState, group: string, runs: readonly Run[]): RunState {
  const mine = runs.filter((r) => r.group === group && (s.status === "archived" ? r.archived : !r.archived));
  const groups = groupRunsNested(mine, s.groupBy);
  const offGroups = (groups ?? []).map(groupKey).filter((k) => s.eyes[k] === false);
  const eyes = setEyes(s, offGroups, null).eyes;
  const vis = resolveVisibility(mine, groups, eyes);
  const hidden = mine.filter((r) => !vis.runs.has(r.id)).map((r) => runKey(r.id));
  return setEyes({ ...s, filter: withGroupCondition(s.filter, group), eyes }, hidden, true);
}
