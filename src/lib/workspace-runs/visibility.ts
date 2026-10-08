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
import { EMPTY_FILTER } from "../run-filter.ts";
import { groupByLabel, groupRunsNested, type RunGroupNode } from "../runs-table/group.ts";
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

/** A run's eye clicked. */
export const toggleRunEye = (s: RunState, run: Pick<Run, "id">, visible: ReadonlySet<string>): RunState =>
  setEyes(s, [runKey(run.id)], !visible.has(run.id));

export interface CardRuns {
  /** The visible runs, in table order. */
  runIds: string[];
  /** Grouped: a run's top-level group (runs without a value are left out: their own lines). */
  groupOf: Map<string, string>;
}

/** The runs given to the cards and, grouped, the group each one aggregates into. */
export function cardRuns(sorted: readonly Run[], groups: readonly RunGroupNode[] | null, visible: ReadonlySet<string>): CardRuns {
  const groupOf = new Map<string, string>();
  if (!groups) return { runIds: sorted.filter((r) => visible.has(r.id)).map((r) => r.id), groupOf };
  const runIds: string[] = [];
  const seen = new Set<string>();
  const walk = (ns: readonly RunGroupNode[], top: string | null) => {
    for (const n of ns) {
      const label = n.depth === 0 ? n.label : top;
      if (n.children) {
        walk(n.children, label);
        continue;
      }
      for (const r of n.runs) {
        if (!visible.has(r.id) || seen.has(r.id)) continue;
        seen.add(r.id);
        runIds.push(r.id);
        if (label != null) groupOf.set(r.id, label);
      }
    }
  };
  walk(groups, null);
  return { runIds, groupOf };
}

/**
 * "Show in workspace" (the Runs page): only the ticked runs' groups visible
 * (grouped; runs without a group value only where ticked), or only the
 * ticked runs (not grouped); every other eye off. The status, search,
 * filter and latest only are cleared so they are listed. `runs`: the
 * project's runs.
 */
export function showOnly(s: RunState, runs: readonly Run[], ticked: ReadonlySet<string>): RunState {
  const eyes: Record<string, boolean> = {};
  const groups = groupRunsNested(runs, s.groupBy);
  if (!groups) for (const r of runs) eyes[runKey(r.id)] = ticked.has(r.id);
  for (const g of groups ?? []) {
    const any = g.runs.some((r) => ticked.has(r.id));
    eyes[groupKey(g)] = any;
    if (g.label == null) for (const r of g.runs) eyes[runKey(r.id)] = ticked.has(r.id);
  }
  return { ...s, status: "all", search: "", filter: EMPTY_FILTER, latestOnly: false, eyes };
}
