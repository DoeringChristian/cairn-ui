/**
 * The runs table's rows, shared by the Runs page and the workspace sidebar:
 * status, "Latest only", filter and search (lib/runs-table/model.ts), the
 * sort (computed columns included), pinned runs first (in the sidebar
 * listed whatever the filters), the nested groups
 * and which of them are collapsed (page-local; reset when the group-by
 * changes).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Run } from "../../api/types";
import type { GroupNode } from "../../lib/run-filter";
import { cellValue, computeColumns, type ComputedColumn } from "../../lib/runs-table/columns";
import { flattenGroups, groupRunsNested, type GroupBy, type RunGroupNode, type TableRow } from "../../lib/runs-table/group";
import { collapsedGroups, filterRunsKeeping, latestRuns, pinnedFirst, type StatusFilter } from "../../lib/runs-table/model";
import { compileRunSearch } from "../../lib/runs-table/search";
import { sortBy, type SortKey } from "../../lib/runs-table/sort";
import { restoredToggles } from "../../lib/run-nav";
import { loadJson, saveJson, storageKeys } from "../../lib/storage";

export interface RunsTableQuery {
  runs: readonly Run[];
  status: StatusFilter;
  search: string;
  filter: GroupNode;
  latestOnly: boolean;
  groupBy: GroupBy[];
  sort: SortKey[];
  computed: ComputedColumn[];
  /** Pinned run ids, listed first. */
  pinned: readonly string[];
  /** Pinned runs are listed whatever the filters (the workspace sidebar). */
  pinnedAlwaysListed?: boolean;
  /** Deltas compare against it even when filtered out, so its computed values are needed. */
  baseline?: Run;
  /** Which groups start collapsed (default: none). */
  defaultCollapsed?: (node: RunGroupNode, index: number) => boolean;
  /** Keep the toggled groups for the session under this key (the workspace sidebar: back from a run page as left). */
  collapsedKey?: string;
}

const NONE_COLLAPSED = () => false;
const NO_RUNS: readonly string[] = [];

export function useRunsTable(q: RunsTableQuery) {
  const { runs, status, search, filter, latestOnly, groupBy, sort, computed, pinned, baseline } = q;
  const runSearch = useMemo(() => compileRunSearch(search), [search]);
  const { latestIds, latestByName } = useMemo(() => latestRuns(runs), [runs]);
  const kept = q.pinnedAlwaysListed ? pinned : NO_RUNS;
  const filtered = useMemo(
    () => filterRunsKeeping(runs, { status, search: runSearch, filter, latestOnly }, latestIds, kept),
    [runs, status, runSearch, filter, latestOnly, latestIds, kept],
  );
  const computedValues = useMemo(
    () => computeColumns(baseline && !filtered.includes(baseline) ? [...filtered, baseline] : filtered, computed),
    [filtered, computed, baseline],
  );
  const sorted = useMemo(
    () => pinnedFirst(sortBy(filtered, sort, (r, col) => cellValue(r, col, computedValues), (r) => r.id), pinned),
    [filtered, sort, computedValues, pinned],
  );
  const groups = useMemo(() => groupRunsNested(sorted, groupBy), [sorted, groupBy]);

  const groupByKey = JSON.stringify(groupBy);
  const { collapsedKey } = q;
  const [toggled, setToggled] = useState<Set<string>>(() =>
    collapsedKey ? restoredToggles(loadJson(sessionStorage, storageKeys.runsCollapsed(collapsedKey)), groupByKey) : new Set(),
  );
  // A new group-by starts from the default again.
  const groupedBy = useRef(groupByKey);
  useEffect(() => {
    if (groupedBy.current === groupByKey) return;
    groupedBy.current = groupByKey;
    setToggled(new Set());
  }, [groupByKey]);
  useEffect(() => {
    if (collapsedKey) saveJson(sessionStorage, storageKeys.runsCollapsed(collapsedKey), { groupBy: groupedBy.current, toggled: [...toggled] });
  }, [collapsedKey, toggled]);
  const toggleGroup = useCallback(
    (id: string) =>
      setToggled((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const defaultCollapsed = q.defaultCollapsed ?? NONE_COLLAPSED;
  const collapsed = useMemo(() => collapsedGroups(groups, toggled, defaultCollapsed), [groups, toggled, defaultCollapsed]);

  const rows = useMemo<TableRow[]>(
    () => (groups ? flattenGroups(groups, collapsed) : sorted.map((run) => ({ kind: "run", run, key: run.id, depth: 0, own: true }))),
    [groups, collapsed, sorted],
  );

  return { runSearch, latestByName, filtered, computedValues, sorted, groups, collapsed, toggleGroup, rows };
}
