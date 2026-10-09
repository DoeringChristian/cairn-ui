/**
 * The runs table's row model (pure), shared by the Runs page and the
 * workspace sidebar (components/runs-table/use-runs-table.ts): the status
 * filter, the filter (with "Latest versions only") + search, pinned-first, the collapsed
 * groups and the Name cell's name.
 */

import type { Run, RunStatus } from "../../api/types.ts";
import { isEmptyRunsFilter, matchesFilter, type RunsFilter } from "../run-filter.ts";
import { DEFAULT_SORT, type SortKey } from "./sort.ts";
import type { RunGroupNode } from "./group.ts";
import { matchesRunSearch, type RunSearch } from "./search.ts";
import { bySeries, newerInSeries } from "../run-series.ts";

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
  /** The newest run of every series (group, job type, display name). */
  latestIds: Set<string>;
  /** The newest run of series with several runs (highlighted). */
  latestByName: Set<string>;
}

/**
 * The newest run per series ("Latest versions only", the eye menu's "Show
 * latest only", and the highlight). A series is
 * (group, job type, display name) (lib/run-series.ts): versions are numbered
 * per (project, group, job_type, name), so `train` in two groups, or under
 * two job types, are two series.
 */
export function latestRuns(runs: readonly Run[]): LatestRuns {
  const latestByName = new Set<string>();
  const latestIds = new Set<string>();
  for (const list of bySeries(runs).values()) {
    const best = list.reduce((b, r) => (newerInSeries(r, b) ? r : b));
    latestIds.add(best.id);
    if (list.length > 1) latestByName.add(best.id);
  }
  return { latestIds, latestByName };
}

export interface RowFilters {
  status: StatusFilter;
  search: RunSearch;
  filter: RunsFilter;
}

/** The runs the table lists: status (archived only under "archived"), the filter (latest versions only, the tree), search. */
export function filterRuns(runs: readonly Run[], f: RowFilters, latestIds: ReadonlySet<string>): Run[] {
  return runs.filter((r) => {
    if (f.filter.latestOnly && !latestIds.has(r.id)) return false;
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
/**
 * Whether the Runs page must load every page of runs: anything that picks
 * or orders rows from the whole project (filter incl. "Latest versions
 * only", grouping, search, status, a sort other than the server's newest-first) is wrong over
 * just the first pages: it silently hides matches, or puts rows from the
 * first 100 at the top. Only the default view pages lazily.
 */
export function needsEveryRun(q: {
  filter: RunsFilter;
  groupBy: readonly unknown[];
  search: string;
  status: StatusFilter;
  sort: readonly SortKey[];
}): boolean {
  const defaultSort =
    q.sort.length === 0 ||
    (q.sort.length === 1 && q.sort[0]!.column === DEFAULT_SORT[0]!.column && q.sort[0]!.direction === DEFAULT_SORT[0]!.direction);
  return !isEmptyRunsFilter(q.filter) || q.groupBy.length > 0 || q.search.trim() !== "" || q.status !== "all" || !defaultSort;
}

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

/** The workspace sidebar's default: the first top-level group and the no-value group open, the other top-level groups collapsed. */
export const firstGroupOpen = (n: RunGroupNode, i: number) => n.depth === 0 && i > 0 && n.label != null;

/** Every run in the same (non-null) group: the group needs no saying on each row (e.g. filtered to one group). */
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

/** A group header's checkbox: every, some or none of its runs (nested groups included) selected. */
export function groupSelection(runs: readonly Run[], selected: ReadonlySet<string>): "all" | "some" | "none" {
  let n = 0;
  for (const r of runs) if (selected.has(r.id)) n++;
  return n === 0 ? "none" : n === runs.length ? "all" : "some";
}

/** Clicking a group header's checkbox: select all its runs, or clear them when all are selected. */
export function toggleGroupSelection(runs: readonly Run[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (runs.length > 0 && groupSelection(runs, selected) === "all") for (const r of runs) next.delete(r.id);
  else for (const r of runs) next.add(r.id);
  return next;
}
