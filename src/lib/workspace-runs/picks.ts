/**
 * Version picks inside one group (pure): which run of each name the
 * workspace shows, and the lineage rules that keep picks consistent.
 *
 * A group's picks map each name key (graph.ts `nameKey`) to a run of that
 * name, or null ("not run yet"). The group is either `latest` (latest.ts
 * `latestRuns`) or custom picks. Picking a version:
 *
 * - pulls its upstream along: for each upstream name the picked run used,
 *   that name's pick becomes the run it used (when it used several, the
 *   current pick if among them, else the newest of them), recursively;
 * - re-checks every other name, upstream → downstream: a pick that no longer
 *   fits is replaced by the newest version that fits all picks, else null.
 *
 * A candidate fits the picks when every picked upstream name is a run it
 * used (any of them, when it used several versions of one name) and every
 * picked downstream run that used this name used the candidate.
 */

import { nameKey, type GroupGraph, type GroupGraphRun } from "./graph.ts";
import { latestRuns, runsByName } from "./latest.ts";

/** name key → picked run id, or null ("not run yet"). */
export type GroupPicks = Record<string, string | null>;

interface Ctx {
  byId: Map<string, GroupGraphRun>;
  /** run → upstream name key → the runs of that name it used. */
  upstream: Map<string, Map<string, Set<string>>>;
  /** name key → its runs, newest first. */
  versions: Map<string, GroupGraphRun[]>;
}

const ctxCache = new WeakMap<GroupGraph, Ctx>();

function ctxOf(graph: GroupGraph): Ctx {
  const hit = ctxCache.get(graph);
  if (hit) return hit;
  const byId = new Map(graph.runs.map((r) => [r.id, r]));
  const upstream = new Map<string, Map<string, Set<string>>>();
  for (const e of graph.edges) {
    const u = byId.get(e.from);
    const d = byId.get(e.to);
    if (!u || !d || nameKey(u) === nameKey(d)) continue;
    let perName = upstream.get(d.id);
    if (!perName) upstream.set(d.id, (perName = new Map()));
    const k = nameKey(u);
    let ids = perName.get(k);
    if (!ids) perName.set(k, (ids = new Set()));
    ids.add(u.id);
  }
  const ctx = { byId, upstream, versions: runsByName(graph) };
  ctxCache.set(graph, ctx);
  return ctx;
}

/** The group's runs of `key`, newest first. */
export function versionsOf(graph: GroupGraph, key: string): GroupGraphRun[] {
  return ctxOf(graph).versions.get(key) ?? [];
}

/** The runs inside the group that `runId` used, upstream name order, newest first per name. */
export function usedRuns(graph: GroupGraph, runId: string): GroupGraphRun[] {
  const ctx = ctxOf(graph);
  const per = ctx.upstream.get(runId);
  if (!per) return [];
  const order = nameOrder(graph);
  return [...per]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .flatMap(([, ids]) => newestFirst([...ids].map((id) => ctx.byId.get(id)!)));
}

const newestFirst = (runs: GroupGraphRun[]) =>
  [...runs].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || (b.version ?? -1) - (a.version ?? -1) || (a.id < b.id ? -1 : 1),
  );

/**
 * The group's name keys upstream → downstream (a name another name used
 * comes first); names unordered by lineage (and cycles) by their first run.
 */
export function nameOrder(graph: GroupGraph): string[] {
  const first = new Map<string, string>();
  for (const r of graph.runs) {
    const k = nameKey(r);
    const t = first.get(k);
    if (t === undefined || r.created_at < t) first.set(k, r.created_at);
  }
  const byFirst = (a: string, b: string) => first.get(a)!.localeCompare(first.get(b)!) || (a < b ? -1 : a > b ? 1 : 0);
  const out = new Map<string, Set<string>>(); // name → downstream names
  const indeg = new Map<string, number>([...first.keys()].map((k) => [k, 0]));
  const byId = new Map(graph.runs.map((r) => [r.id, r]));
  for (const e of graph.edges) {
    const u = byId.get(e.from);
    const d = byId.get(e.to);
    if (!u || !d) continue;
    const a = nameKey(u);
    const b = nameKey(d);
    if (a === b) continue;
    let set = out.get(a);
    if (!set) out.set(a, (set = new Set()));
    if (set.has(b)) continue;
    set.add(b);
    indeg.set(b, indeg.get(b)! + 1);
  }
  const order: string[] = [];
  const ready = [...indeg].filter(([, n]) => n === 0).map(([k]) => k);
  while (ready.length) {
    ready.sort(byFirst);
    const k = ready.shift()!;
    order.push(k);
    for (const b of out.get(k) ?? []) {
      const n = indeg.get(b)! - 1;
      indeg.set(b, n);
      if (n === 0) ready.push(b);
    }
  }
  // Cycles: whatever is left, by first run.
  const rest = [...first.keys()].filter((k) => !order.includes(k)).sort(byFirst);
  return [...order, ...rest];
}

/** Does `runId` (of name `key`) fit the other picks? */
export function fits(graph: GroupGraph, picks: GroupPicks, key: string, runId: string): boolean {
  const { upstream } = ctxOf(graph);
  for (const [name, ids] of upstream.get(runId) ?? []) {
    if (name === key) continue;
    const pick = picks[name];
    if (pick != null && !ids.has(pick)) return false;
  }
  for (const [name, pick] of Object.entries(picks)) {
    if (name === key || pick == null) continue;
    const ids = upstream.get(pick)?.get(key);
    if (ids && !ids.has(runId)) return false;
  }
  return true;
}

/** The newest version of `key` that fits `picks`, else null. */
function newestFitting(graph: GroupGraph, picks: GroupPicks, key: string): string | null {
  return versionsOf(graph, key).find((r) => fits(graph, picks, key, r.id))?.id ?? null;
}

/** The latest picks: `latestRuns`, names without a fitting run null. */
export function latestPicks(graph: GroupGraph): GroupPicks {
  const { byId } = ctxOf(graph);
  const path = latestRuns(graph);
  const out: GroupPicks = {};
  for (const id of path.runIds) out[nameKey(byId.get(id)!)] = id;
  for (const k of path.notRun) out[k] = null;
  return out;
}

/**
 * Stored custom picks against the group as it is now: a pick whose run is
 * gone (or of another name) and a name not picked yet take the newest
 * version that fits the others, else null.
 */
export function resolvePicks(graph: GroupGraph, stored: GroupPicks): GroupPicks {
  const { byId } = ctxOf(graph);
  const out: GroupPicks = {};
  const open: string[] = [];
  for (const k of nameOrder(graph)) {
    const p = stored[k];
    if (p === null) out[k] = null;
    else if (p !== undefined && byId.has(p) && nameKey(byId.get(p)!) === k) out[k] = p;
    else open.push(k);
  }
  for (const k of open) out[k] = newestFitting(graph, out, k);
  return out;
}

/** Pick `runId` for name `key` (null: none), applying the lineage rules to the other picks. */
export function pickRun(graph: GroupGraph, picks: GroupPicks, key: string, runId: string | null): GroupPicks {
  const ctx = ctxOf(graph);
  const next: GroupPicks = { ...picks, [key]: runId };
  const fixed = new Set([key]);
  const pull = (rid: string) => {
    for (const [name, ids] of ctx.upstream.get(rid) ?? []) {
      if (fixed.has(name)) continue;
      const cur = next[name];
      const choice = cur != null && ids.has(cur) ? cur : newestFirst([...ids].map((id) => ctx.byId.get(id)!))[0]!.id;
      next[name] = choice;
      fixed.add(name);
      pull(choice);
    }
  };
  if (runId != null) pull(runId);
  // Each other name is checked against the fixed picks and the names before
  // it (upstream first), never against downstream picks still to be checked.
  const settled: GroupPicks = {};
  for (const name of fixed) settled[name] = next[name] ?? null;
  for (const name of nameOrder(graph)) {
    if (fixed.has(name)) continue;
    const cur = next[name];
    if (cur == null || !fits(graph, settled, name, cur)) next[name] = newestFitting(graph, settled, name);
    settled[name] = next[name] ?? null;
  }
  return next;
}
