/**
 * Deltas against the baseline run, coloured better or worse.
 *
 * Which way is better is the metric's goal in the project
 * (lib/metric-rules.ts: a project override, else from its summary rule, min
 * means lower is better, max higher). A computed column reads the goal of
 * the one metric its expression reads; a config column has none. Without a
 * goal the delta is shown uncoloured.
 */

import { deps, parse } from "../expr/index.ts";
import type { Goal, RuleOf } from "../metric-rules.ts";
import { columnKind, type ComputedColumn } from "./columns.ts";

export type Tone = "better" | "worse" | "same" | "neutral";

/** The goal of an expression's value: its one metric's (none when it reads several or none). */
export function exprGoal(src: string, ruleOf: RuleOf): Goal {
  try {
    const ms = deps(parse(src)).metrics;
    return ms.length === 1 ? ruleOf(ms[0]!).goal : "none";
  } catch {
    return "none";
  }
}

/** A column's goal: a metric's, a computed column's metric's, else none. */
export function goalFor(col: string, ruleOf: RuleOf, computed: readonly ComputedColumn[]): Goal {
  const { kind, key } = columnKind(col);
  if (kind === "value") return ruleOf(key).goal;
  if (kind === "computed") {
    const c = computed.find((x) => x.id === key);
    return c ? exprGoal(c.expr, ruleOf) : "none";
  }
  return "none";
}

/** `value − baseline` for two finite numbers (bools as 0/1), else null. */
export function deltaOf(value: unknown, baseline: unknown): number | null {
  const a = typeof value === "boolean" ? Number(value) : value;
  const b = typeof baseline === "boolean" ? Number(baseline) : baseline;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

export function toneOf(delta: number | null, goal: Goal): Tone {
  if (delta === null) return "neutral";
  if (delta === 0) return "same";
  if (goal === "none") return "neutral";
  return (delta < 0) === (goal === "lower") ? "better" : "worse";
}

/** `+0.0123`, `-4.5e-5`: a signed, compact delta. */
export function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  const s = abs === 0 ? "0" : abs >= 1e5 || abs < 1e-3 ? abs.toExponential(2) : String(Number(abs.toPrecision(4)));
  return `${sign}${s}`;
}

/** The delta relative to the baseline's magnitude, e.g. `-12.5%`; null when undefined. */
export function relativeDelta(delta: number | null, baseline: unknown): number | null {
  if (delta === null || typeof baseline !== "number" || baseline === 0 || !Number.isFinite(baseline)) return null;
  return delta / Math.abs(baseline);
}
