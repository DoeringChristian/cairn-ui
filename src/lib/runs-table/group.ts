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
import { compareValues } from "./sort.ts";

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
  return [...groups.values()].sort((a, b) => {
    if (a.label === null) return b.label === null ? 0 : 1;
    if (b.label === null) return -1;
    return compareValues(a.raw, b.raw);
  });
}

/** Group `runs` level by level; [] levels → no groups (null). */
export function groupRunsNested(runs: readonly Run[], levels: readonly GroupBy[]): RunGroupNode[] | null {
  if (levels.length === 0) return null;
  const build = (rs: readonly Run[], depth: number, parentId: string): RunGroupNode[] => {
    const by = levels[depth]!;
    return partition(rs, by).map((g) => {
      const id = `${parentId}${depth}${g.label === null ? "∅" : `=${g.label}`}/`;
      return {
        id,
        label: g.label,
        depth,
        by,
        runs: g.runs,
        children: depth + 1 < levels.length ? build(g.runs, depth + 1, id) : null,
      };
    });
  };
  return build(runs, 0, "");
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
