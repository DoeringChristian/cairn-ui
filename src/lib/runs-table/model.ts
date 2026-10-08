/**
 * The runs table's row model (pure), shared by the Runs page and the
 * workspace sidebar (components/runs-table/use-runs-table.ts): the status
 * filter, "Latest only", the filter + search, pinned-first, the collapsed
 * groups and the Name cell's name.
 */

import type { Run, RunStatus } from "../../api/types.ts";
import { matchesFilter, type GroupNode } from "../run-filter.ts";
import type { RunGroupNode } from "./group.ts";
import { matchesRunSearch, type RunSearch } from "./search.ts";

/** The status filter: a status, every non-archived run ("all"), or the archived runs. */
export type StatusFilter = "all" | "archived" | RunStatus;

export const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "running" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
  { value: "crashed", label: "crashed" },
  { value: "killed", label: "killed" },
  { value: "stopped", label: "stopped" },
  { value: "archived", label: "archived" },
];

export function isStatusFilter(v: unknown): v is StatusFilter {
  return STATUS_OPTIONS.some((o) => o.value === v);
}

export interface LatestRuns {
  /** The newest run of every series (group, display name). */
  latestIds: Set<string>;
  /** The newest run of series with several runs (highlighted). */
  latestByName: Set<string>;
}

/** Whether `a` is newer than `b` in one series: the higher version when both have one, else created_at. */
function newer(a: Run, b: Run): boolean {
  if (a.version != null && b.version != null && a.version !== b.version) return a.version > b.version;
  return a.created_at > b.created_at;
}

/**
 * The newest run per series ("Latest only", and the highlight). A series is
 * (group, display name): versions are numbered per (project, group, name),
 * so `train` in two groups are two series.
 */
export function latestRuns(runs: readonly Run[]): LatestRuns {
  const bySeries = new Map<string, Run>();
  const counts = new Map<string, number>();
  for (const r of runs) {
    const key = JSON.stringify([r.group ?? null, r.display_name ?? r.id]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const existing = bySeries.get(key);
    if (!existing || newer(r, existing)) bySeries.set(key, r);
  }
  const latestByName = new Set<string>();
  const latestIds = new Set<string>();
  for (const [key, best] of bySeries) {
    latestIds.add(best.id);
    if ((counts.get(key) ?? 0) > 1) latestByName.add(best.id);
  }
  return { latestIds, latestByName };
}

export interface RowFilters {
  status: StatusFilter;
  search: RunSearch;
  filter: GroupNode;
  latestOnly: boolean;
}

/** The runs the table lists: status (archived only under "archived"), latest only, filter, search. */
export function filterRuns(runs: readonly Run[], f: RowFilters, latestIds: ReadonlySet<string>): Run[] {
  return runs.filter((r) => {
    if (f.latestOnly && !latestIds.has(r.id)) return false;
    if (f.status === "archived") {
      if (!r.archived) return false;
    } else if (r.archived) {
      return false;
    } else if (f.status !== "all" && r.status !== f.status) {
      return false;
    }
    if (!matchesFilter(r, f.filter)) return false;
    return matchesRunSearch(r, f.search);
  });
}

/**
 * `filterRuns`, but the `kept` runs (the workspace sidebar's pinned runs)
 * are listed whatever the filters; in `runs` order.
 */
export function filterRunsKeeping(
  runs: readonly Run[],
  f: RowFilters,
  latestIds: ReadonlySet<string>,
  kept: readonly string[],
): Run[] {
  if (kept.length === 0) return filterRuns(runs, f, latestIds);
  const keep = new Set(kept);
  const pass = new Set(filterRuns(runs, f, latestIds).map((r) => r.id));
  return runs.filter((r) => pass.has(r.id) || keep.has(r.id));
}

/** Pinned runs first, both parts in their sorted order. */
export function pinnedFirst(sorted: Run[], pinned: readonly string[]): Run[] {
  if (pinned.length === 0) return sorted;
  const set = new Set(pinned);
  return [...sorted.filter((r) => set.has(r.id)), ...sorted.filter((r) => !set.has(r.id))];
}

/**
 * Which groups are collapsed: `defaultCollapsed` (per node and its index
 * among its siblings), flipped for the `toggled` ones.
 */
export function collapsedGroups(
  groups: readonly RunGroupNode[] | null,
  toggled: ReadonlySet<string>,
  defaultCollapsed: (node: RunGroupNode, index: number) => boolean,
): Set<string> {
  const out = new Set<string>();
  const walk = (ns: readonly RunGroupNode[]) =>
    ns.forEach((n, i) => {
      if (defaultCollapsed(n, i) !== toggled.has(n.id)) out.add(n.id);
      if (n.children) walk(n.children);
    });
  if (groups) walk(groups);
  return out;
}

/** Every run in the same (non-null) group: the group needs no saying on each row (a group page). */
export function sameGroup(runs: readonly Pick<Run, "group">[]): boolean {
  const g = runs[0]?.group;
  return g != null && runs.every((r) => r.group === g);
}

/**
 * The Name cell's name: not grouped, a grouped run reads `exp-44 · train`
 * (its version follows); grouped (the group header says it), without a
 * group, or when every listed run is in one group (pass `grouped ||
 * sameGroup(listed)`), just the name.
 */
export function runRowName(run: Pick<Run, "id" | "display_name" | "group">, grouped: boolean): string {
  const name = run.display_name ?? run.id;
  return !grouped && run.group != null ? `${run.group} · ${name}` : name;
}
