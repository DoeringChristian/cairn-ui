/**
 * Run sets: the runs of a report's cards cell (wandb's panel-grid run sets).
 * A run set is a frozen copy of the workspace's runs table state — its
 * filter tree, group-by levels, Latest only, sort and eyes — and its runs are
 * resolved live, exactly as the workspace resolves the runs its cards draw
 * (lib/workspace-runs/visibility.ts): over the project's newest
 * `RUN_SET_POOL` runs, archived runs left out, Latest only, the filter, the
 * sort, the grouping and the eyes (by default the `DEFAULT_VISIBLE` newest
 * groups, or runs when not grouped).
 *
 * A Python port (cairn `cairn/server/run_sets.py`) computes the same runs
 * for a share link's scope; both run the vectors in
 * `docs/schemas/run-set-vectors.json`.
 */

import type { Run } from "../api/types.ts";
import { EMPTY_FILTER, matchesFilter, parseFilter, type GroupNode } from "./run-filter.ts";
import { cellValue } from "./runs-table/columns.ts";
import { groupRunsNested, isGroupBy, type GroupBy } from "./runs-table/group.ts";
import { latestRuns } from "./runs-table/model.ts";
import { DEFAULT_SORT, sortBy, type SortKey } from "./runs-table/sort.ts";
import { cardRuns, resolveVisibility } from "./workspace-runs/visibility.ts";

/** The project's newest runs a run set resolves against (the workspace's). */
export const RUN_SET_POOL = 1000;

export interface RunSet {
  name: string;
  filter: GroupNode;
  groupBy: GroupBy[];
  latestOnly: boolean;
  sort: SortKey[];
  /** Explicit eyes (`g:<group>` / `r:<run id>`), as the workspace's. */
  eyes: Record<string, boolean>;
}

export function defaultRunSet(name = "Run set"): RunSet {
  return { name, filter: EMPTY_FILTER, groupBy: [], latestOnly: false, sort: DEFAULT_SORT, eyes: {} };
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

/** A stored run set; what does not parse takes its default. Null: not a mapping. */
export function parseRunSet(raw: unknown, index = 0): RunSet | null {
  if (!isObj(raw)) return null;
  const eyes: Record<string, boolean> = {};
  if (isObj(raw.eyes)) for (const [k, v] of Object.entries(raw.eyes)) if (typeof v === "boolean") eyes[k] = v;
  const sort = Array.isArray(raw.sort)
    ? raw.sort
        .filter((k): k is SortKey => isObj(k) && typeof k.column === "string" && k.column !== "" && (k.direction === "asc" || k.direction === "desc"))
        .map((k) => ({ column: k.column, direction: k.direction }))
    : [];
  return {
    name: typeof raw.name === "string" && raw.name ? raw.name : `Run set ${index + 1}`,
    filter: parseFilter(raw.filter),
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy.filter(isGroupBy) : [],
    latestOnly: raw.latestOnly === true,
    sort: sort.length > 0 ? sort : DEFAULT_SORT,
    eyes,
  };
}

/**
 * The runs a set shows, in table order. `pool`: the project's newest runs,
 * archived ones included (they count for Latest only), with `params`,
 * `values` and `stats`.
 */
export function resolveRunSet(set: RunSet, pool: readonly Run[]): string[] {
  const { latestIds } = latestRuns(pool);
  const listed = pool.filter((r) => !r.archived && (!set.latestOnly || latestIds.has(r.id)) && matchesFilter(r, set.filter));
  const sorted = sortBy(listed, set.sort, (r, col) => cellValue(r, col), (r) => r.id);
  const groups = groupRunsNested(sorted, set.groupBy);
  const visible = resolveVisibility(sorted, groups, set.eyes);
  return cardRuns(sorted, groups, visible.runs).runIds;
}

export interface ResolvedRunSets {
  /** Every set's runs, in set order. */
  sets: string[][];
  /** Their union, in set order (a run in several sets is listed once, under its first). */
  runIds: string[];
}

export function unionOfSets(sets: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ids of sets) for (const id of ids) if (!seen.has(id)) (seen.add(id), out.push(id));
  return out;
}

export function resolveRunSets(sets: readonly RunSet[], pool: readonly Run[]): ResolvedRunSets {
  const resolved = sets.map((s) => resolveRunSet(s, pool));
  return { sets: resolved, runIds: unionOfSets(resolved) };
}

/** A string literal of the expression language (lib/expr). */
function exprString(s: string): string {
  return JSON.stringify(s);
}

/**
 * A run set of exactly these runs (a section sent to a report, a template
 * applied to picked runs): the filter `run.id in [...]`, every run's eye on.
 */
export function runSetOfIds(ids: readonly string[], name = "Run set 1"): RunSet {
  const unique = [...new Set(ids)];
  return {
    ...defaultRunSet(name),
    filter: { kind: "group", op: "and", children: [{ kind: "expr", expr: `run.id in [${unique.map(exprString).join(", ")}]` }] },
    eyes: Object.fromEntries(unique.map((id) => [`r:${id}`, true])),
  };
}

// --- editing (the Runs dialog's run set list) --------------------------------

/** `base`, or `base 2`, `base 3`, … : the first name no set has. */
export function uniqueRunSetName(sets: readonly RunSet[], base: string): string {
  const taken = new Set(sets.map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** "+ Add run set": a default set (every run, newest 10 visible), `Run set <n>`. */
export function addRunSet(sets: readonly RunSet[]): RunSet[] {
  return [...sets, defaultRunSet(uniqueRunSetName(sets, `Run set ${sets.length + 1}`))];
}

/** The last set cannot be removed. */
export const canRemoveRunSet = (sets: readonly RunSet[]) => sets.length > 1;

/** ✕: the set gone, unless it is the last one. */
export function removeRunSet(sets: readonly RunSet[], index: number): RunSet[] {
  if (!canRemoveRunSet(sets) || index < 0 || index >= sets.length) return [...sets];
  return sets.filter((_, i) => i !== index);
}

/** One set changed (its name, or its frozen runs table state). */
export function updateRunSet(sets: readonly RunSet[], index: number, fn: (s: RunSet) => RunSet): RunSet[] {
  return sets.map((s, i) => (i === index ? fn(s) : s));
}

export const renameRunSet = (sets: readonly RunSet[], index: number, name: string): RunSet[] =>
  updateRunSet(sets, index, (s) => ({ ...s, name }));

/** The runs table state a set freezes (the workspace's run state minus its status and search). */
export type FrozenRunsState = Pick<RunSet, "filter" | "groupBy" | "latestOnly" | "sort" | "eyes">;

/** A set frozen from a runs table state (the workspace view's `runState`): a copy, so later edits there do not reach it. */
export function runSetFromState(state: FrozenRunsState, name: string): RunSet {
  return structuredClone({
    name,
    filter: state.filter,
    groupBy: state.groupBy,
    latestOnly: state.latestOnly,
    sort: state.sort,
    eyes: state.eyes,
  });
}

/** "⤓ Insert from workspace": a set copying the workspace view's run state, named after the view. */
export function insertRunSetFromWorkspace(sets: readonly RunSet[], state: FrozenRunsState, viewName: string): RunSet[] {
  return [...sets, runSetFromState(state, uniqueRunSetName(sets, viewName || "Workspace"))];
}

// --- colour families ---------------------------------------------------------

/** `#rrggbb` of an HSL colour (h in degrees, s and l in [0, 1]). */
export function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Each set's hue (degrees): blue, red, green, orange, purple, teal, brown, pink. */
const FAMILY_HUES = [212, 0, 128, 30, 275, 180, 20, 320];

/** A set's colour family, as its dot in the run set list: the family's middle shade. */
export function runSetFamilyColor(index: number): string {
  return hslHex(FAMILY_HUES[index % FAMILY_HUES.length]!, 0.7, 0.49);
}

/**
 * Colours of a cell with several run sets: each set its own colour family
 * (one hue, its runs in shades from dark to light). A run in several sets
 * takes its first set's family. One set: null (the usual id colours).
 */
export function runSetColors(sets: readonly (readonly string[])[]): Map<string, string> | null {
  if (sets.length < 2) return null;
  const out = new Map<string, string>();
  sets.forEach((ids, i) => {
    const hue = FAMILY_HUES[i % FAMILY_HUES.length]!;
    const own = ids.filter((id) => !out.has(id));
    own.forEach((id, k) => {
      const t = own.length === 1 ? 0.5 : k / (own.length - 1);
      out.set(id, hslHex(hue, 0.7, 0.32 + t * 0.34));
    });
  });
  return out;
}
