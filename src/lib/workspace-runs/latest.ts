/**
 * A group's "latest" path: the newest runs that fit together.
 *
 * Start from the group's newest run (by `created_at`; a running run counts).
 * Then, through the other names from most to least recently active (by each
 * name's newest run), add that name's newest version that keeps the set
 * valid; a name with no fitting version is "not run yet".
 *
 * Valid: for every chosen run d and every edge u→d whose u's name is also
 * chosen, the chosen version of that name is u (when d used several versions
 * of one name, any of them will do). Unnamed runs are each their own name.
 */

import { nameKey, type GroupGraph, type GroupGraphRun } from "./graph.ts";

export interface LatestPath {
  /** Chosen runs, in the order they were chosen (newest name first). */
  runIds: string[];
  /** Name keys (`nameKey`) with no version that fits: "not run yet". */
  notRun: string[];
}

const newestFirst = (a: GroupGraphRun, b: GroupGraphRun) =>
  b.created_at.localeCompare(a.created_at) || (b.version ?? -1) - (a.version ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The group's runs per name, newest first, names ordered by their newest run (newest first). */
export function runsByName(graph: GroupGraph): Map<string, GroupGraphRun[]> {
  const sorted = [...graph.runs].sort(newestFirst);
  const out = new Map<string, GroupGraphRun[]>();
  for (const r of sorted) {
    const k = nameKey(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

export function latestRuns(graph: GroupGraph): LatestPath {
  const byId = new Map(graph.runs.map((r) => [r.id, r]));
  // Upstream runs of each run, keyed by the upstream's name.
  const upstream = new Map<string, Map<string, Set<string>>>();
  for (const e of graph.edges) {
    const u = byId.get(e.from);
    if (!u || !byId.has(e.to)) continue;
    let perName = upstream.get(e.to);
    if (!perName) upstream.set(e.to, (perName = new Map()));
    const k = nameKey(u);
    let ids = perName.get(k);
    if (!ids) perName.set(k, (ids = new Set()));
    ids.add(u.id);
  }

  const chosen = new Map<string, string>(); // name key → run id
  const fits = (candidate: GroupGraphRun): boolean => {
    const trial = new Map(chosen).set(nameKey(candidate), candidate.id);
    for (const d of trial.values()) {
      for (const [name, ids] of upstream.get(d) ?? []) {
        const pick = trial.get(name);
        if (pick !== undefined && !ids.has(pick)) return false;
      }
    }
    return true;
  };

  const notRun: string[] = [];
  for (const [name, versions] of runsByName(graph)) {
    const pick = versions.find(fits);
    if (pick) chosen.set(name, pick.id);
    else notRun.push(name);
  }
  return { runIds: [...chosen.values()], notRun };
}
