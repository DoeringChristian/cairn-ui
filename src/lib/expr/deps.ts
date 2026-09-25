/**
 * What an expression reads, and whether per-run stats suffice to evaluate it.
 * MIRRORED by cairn `cairn/expr.py`.
 */
import type { Axis, Node, RunField } from "./ast.ts";
import { isReducer, type Reducer } from "./functions.ts";

export interface Deps {
  /** Metric series names, unique, in source order. */
  metrics: string[];
  config: string[];
  summary: string[];
  run: RunField[];
  axes: Axis[];
  /** `reducer(metric)` pairs (a bare metric straight inside a 1-arg reducer), unique. */
  reduced: Array<{ metric: string; reducer: Reducer }>;
}

function children(node: Node): Node[] {
  switch (node.type) {
    case "list":
      return node.items;
    case "unary":
      return [node.operand];
    case "binary":
      return [node.left, node.right];
    case "compare":
      return node.operands;
    case "call":
      return node.args;
    default:
      return [];
  }
}

/** The bare metric a 1-argument reducer call reduces, or null. */
export function reducedMetric(node: Node): { metric: string; reducer: Reducer } | null {
  if (node.type !== "call" || !isReducer(node.fn) || node.args.length !== 1) return null;
  const a = node.args[0]!;
  return a.type === "metric" ? { metric: a.name, reducer: node.fn } : null;
}

export function deps(node: Node): Deps {
  const out: Deps = { metrics: [], config: [], summary: [], run: [], axes: [], reduced: [] };
  const add = <T>(arr: T[], v: T) => {
    if (!arr.includes(v)) arr.push(v);
  };
  const walk = (n: Node) => {
    switch (n.type) {
      case "metric":
        add(out.metrics, n.name);
        break;
      case "config":
        add(out.config, n.key);
        break;
      case "summary":
        add(out.summary, n.key);
        break;
      case "run":
        add(out.run, n.field);
        break;
      case "axis":
        add(out.axes, n.axis);
        break;
    }
    const r = reducedMetric(n);
    if (r && !out.reduced.some((x) => x.metric === r.metric && x.reducer === r.reducer)) out.reduced.push(r);
    children(n).forEach(walk);
  };
  walk(node);
  return out;
}

/**
 * `"stats"` when the per-metric stats (`first/last/min/max/mean`) suffice:
 * every metric appears only as the bare argument of a 1-argument reducer and
 * no axis root (`step`, `wall_time`, `relative_time`) is used. Otherwise
 * `"series"`: the full series must be fetched.
 */
export function plan(node: Node): "stats" | "series" {
  const ok = (n: Node): boolean => {
    if (reducedMetric(n)) return true;
    if (n.type === "metric" || n.type === "axis") return false;
    return children(n).every(ok);
  };
  return ok(node) ? "stats" : "series";
}
