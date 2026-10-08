/**
 * Nested group-by for the runs table: each level partitions its parent's
 * runs (kept in their sorted order) by a run field, a config param or a
 * scalar expression. A run with several tags appears under each tag. Groups
 * sort by value (numbers numerically, text numeric-aware), the no-value
 * group last.
 */

import type { Run } from "../../api/types.ts";
import { formatValue } from "../expr/index.ts";
import { compileScalarExpr, evalScalar } from "./columns.ts";
import { parseTags } from "./context.ts";

export type GroupBy =
  | { source: "group" | "job_type" | "tag" }
  | { source: "param"; key: string }
  | { source: "expr"; expr: string };

export interface RunGroupNode {
  /** Unique across the tree (parent path included): React keys and collapse state. */
  id: string;
  /** Display label; null when the runs have no value. */
  label: string | null;
  depth: number;
  by: GroupBy;
  /** Every run under this group, children included. */
  runs: Run[];
  /** Sub-groups; null at the deepest level. */
  children: RunGroupNode[] | null;
  /** The levels from the top down to this group (itself last). */
  path: GroupStep[];
}

/** One level of a group's path: the field and the group's value there (null: none). */
export interface GroupStep {
  by: GroupBy;
  label: string | null;
}

export function groupByLabel(g: GroupBy): string {
  switch (g.source) {
    case "param":
      return `param: ${g.key}`;
    case "expr":
      return g.expr;
    default:
      return g.source;
  }
}

/** Whether `levels` already groups by `level` (a second level on the same field splits nothing). */
export function hasGroupLevel(levels: readonly GroupBy[], level: GroupBy): boolean {
  return levels.some((g) => g.source === level.source && groupByLabel(g) === groupByLabel(level));
}

/** A group row's field, as rows read it (`Group: exp-44`): Group, Job Type, Tag, a param key, an expression. */
export function groupFieldLabel(g: GroupBy): string {
  switch (g.source) {
    case "group":
      return "Group";
    case "job_type":
      return "Job Type";
    case "tag":
      return "Tag";
    case "param":
      return g.key;
    case "expr":
      return g.expr;
  }
}

/** A field's key in a chart legend (wandb's): group, jobType, tag, a param key, an expression. */
export function groupLegendKey(g: GroupBy): string {
  switch (g.source) {
    case "job_type":
      return "jobType";
    case "param":
      return g.key;
    case "expr":
      return g.expr;
    default:
      return g.source;
  }
}

export const NO_VALUE = "(none)";

/**
 * An innermost group's line (its chart line's identity, colour and legend
 * label): `group: exp-44, jobType: train`.
 */
export function groupLineLabel(path: readonly GroupStep[]): string {
  return path.map((s) => `${groupLegendKey(s.by)}: ${s.label ?? NO_VALUE}`).join(", ");
}

/**
 * A group header row: `Field: value`; an outer group (sub-groups below it)
 * has a hollow circle and two counts (sub-groups, runs); an innermost group
 * has the filled dot of its chart line (`line`) and its run count.
 */
export interface GroupRowModel {
  field: string;
  /** The value; `(none)` for no value (`none`). */
  value: string;
  none: boolean;
  text: string;
  innermost: boolean;
  dot: "hollow" | "filled";
  /** Outer: [sub-groups, runs]; innermost: [runs]. */
  counts: number[];
  /** Innermost: its chart line's label (groupLineLabel); outer: null. */
  line: string | null;
}

export function groupRowModel(node: RunGroupNode): GroupRowModel {
  const field = groupFieldLabel(node.by);
  const value = node.label ?? NO_VALUE;
  const innermost = node.children === null;
  return {
    field,
    value,
    none: node.label === null,
    text: `${field}: ${value}`,
    innermost,
    dot: innermost ? "filled" : "hollow",
    counts: innermost ? [node.runs.length] : [node.children!.length, node.runs.length],
    line: innermost ? groupLineLabel(node.path) : null,
  };
}

/**
 * Each run's innermost group line (groupLineLabel), in table order; a run
 * under several groups (tags) takes its first.
 */
export function innermostLineOf(nodes: readonly RunGroupNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (ns: readonly RunGroupNode[]) => {
    for (const n of ns) {
      if (n.children) {
        walk(n.children);
        continue;
      }
      const line = groupLineLabel(n.path);
      for (const r of n.runs) if (!out.has(r.id)) out.set(r.id, line);
    }
  };
  walk(nodes);
  return out;
}

export function isGroupBy(v: unknown): v is GroupBy {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.source === "group" || o.source === "job_type" || o.source === "tag") return true;
  if (o.source === "param") return typeof o.key === "string";
  if (o.source === "expr") return typeof o.expr === "string";
  return false;
}

function labelOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return formatValue(v);
  return JSON.stringify(v);
}

/** The group values of one run at one level (several for tags; [] never: null = no value). */
function valuesOf(run: Run, by: GroupBy): unknown[] {
  switch (by.source) {
    case "group":
      return [run.group ?? null];
    case "job_type":
      return [run.job_type ?? null];
    case "param":
      return [run.params?.[by.key] ?? null];
    case "tag": {
      const tags = [...new Set(parseTags(run.tags))];
      return tags.length === 0 ? [null] : tags;
    }
    case "expr": {
      const { node } = compileScalarExpr(by.expr);
      return [node ? evalScalar(node, run) : null];
    }
  }
}

function partition(runs: readonly Run[], by: GroupBy): Array<{ label: string | null; raw: unknown; runs: Run[] }> {
  const groups = new Map<string | null, { label: string | null; raw: unknown; runs: Run[] }>();
  for (const run of runs) {
    for (const raw of valuesOf(run, by)) {
      const label = labelOf(raw);
      const g = groups.get(label) ?? { label, raw, runs: [] };
      g.runs.push(run);
      groups.set(label, g);
    }
  }
  // Groups follow the table's sort: `runs` arrive sorted, so a group sits
  // where its first run does (insertion order). Sorting by the grouped
  // column orders the groups by their value; sorting by Created puts the
  // group with the newest run first. Runs without a value group last.
  const out = [...groups.values()];
  return [...out.filter((g) => g.label !== null), ...out.filter((g) => g.label === null)];
}

/**
 * Group `runs` level by level; [] levels → no groups (null). `runs` must be
 * in the table's sort order: groups (at every level) and the runs inside
 * them keep that order, so sorting and grouping compose.
 */
export function groupRunsNested(runs: readonly Run[], levels: readonly GroupBy[]): RunGroupNode[] | null {
  if (levels.length === 0) return null;
  const build = (rs: readonly Run[], depth: number, parentId: string, parent: GroupStep[]): RunGroupNode[] => {
    const by = levels[depth]!;
    return partition(rs, by).map((g) => {
      const id = `${parentId}${depth}${g.label === null ? "∅" : `=${g.label}`}/`;
      const path = [...parent, { by, label: g.label }];
      return {
        id,
        label: g.label,
        depth,
        by,
        runs: g.runs,
        children: depth + 1 < levels.length ? build(g.runs, depth + 1, id, path) : null,
        path,
      };
    });
  };
  return build(runs, 0, "", []);
}

export type TableRow =
  | { kind: "group"; node: RunGroupNode }
  | { kind: "run"; run: Run; key: string; depth: number };

/** The on-screen rows: group headers, then (when expanded) their children or runs. */
export function flattenGroups(nodes: readonly RunGroupNode[], collapsed: ReadonlySet<string>): TableRow[] {
  const out: TableRow[] = [];
  const walk = (ns: readonly RunGroupNode[]) => {
    for (const n of ns) {
      out.push({ kind: "group", node: n });
      if (collapsed.has(n.id)) continue;
      if (n.children) walk(n.children);
      else for (const r of n.runs) out.push({ kind: "run", run: r, key: `${n.id}:${r.id}`, depth: n.depth + 1 });
    }
  };
  walk(nodes);
  return out;
}
