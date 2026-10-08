/**
 * Metric rules: which number a metric's column shows (`summary`) and which
 * way is better (`goal`), per project. A TS mirror of cairn
 * `cairn/server/metric_rules.py` (`effective_rule`); both run the vectors in
 * `docs/schemas/metric-rule-vectors.json`.
 *
 * The logged rule is `run.track(..., summary=)` of the project's newest run
 * that set one; a project override (`PUT /api/projects/{p}/metric-rules/{m}`)
 * replaces either field:
 *
 * 1. summary: the override's, else the logged one, else null (the last point);
 * 2. goal: the override's; else the effective summary's (min: lower, max:
 *    higher); else the logged summary's; else "none".
 */

export type Summary = "min" | "max" | "mean" | "last";
export type Goal = "lower" | "higher" | "none";

export interface MetricOverride {
  summary?: Summary | null;
  goal?: Goal | null;
}

export interface EffectiveRule {
  summary: Summary | null;
  goal: Goal;
}

/** `GET /api/projects/{p}/metric-rules`. */
export interface MetricRulesDoc {
  /** The newest run's `track(..., summary=)` per metric. */
  logged: Record<string, Summary>;
  overrides: Record<string, MetricOverride>;
  /** The server's effective rules (the same resolver). */
  rules: Record<string, EffectiveRule>;
}

const GOAL_OF_SUMMARY: Partial<Record<string, Goal>> = { min: "lower", max: "higher" };

export function effectiveRule(override: MetricOverride | null | undefined, logged: Summary | null | undefined): EffectiveRule {
  const summary = override?.summary || logged || null;
  const goal = override?.goal || GOAL_OF_SUMMARY[summary ?? ""] || GOAL_OF_SUMMARY[logged ?? ""] || "none";
  return { summary, goal };
}

const NO_RULE: EffectiveRule = Object.freeze({ summary: null, goal: "none" }) as EffectiveRule;

/** Each metric's effective rule in a project (no rule: last point, no goal). */
export type RuleOf = (metric: string) => EffectiveRule;

export const noRules: RuleOf = () => NO_RULE;

/** The resolver over a project's rules document. */
export function rulesOf(doc: MetricRulesDoc | null | undefined): RuleOf {
  if (!doc) return noRules;
  const cache = new Map<string, EffectiveRule>();
  return (metric) => {
    let r = cache.get(metric);
    if (!r) {
      const has = (o: object) => Object.prototype.hasOwnProperty.call(o, metric);
      r = has(doc.logged) || has(doc.overrides) ? effectiveRule(has(doc.overrides) ? doc.overrides[metric] : null, has(doc.logged) ? doc.logged[metric] : null) : NO_RULE;
      cache.set(metric, r);
    }
    return r;
  };
}

/** A goal as the Pareto / sort direction of a value (null: none). */
export function goalDirection(goal: Goal): "min" | "max" | null {
  return goal === "lower" ? "min" : goal === "higher" ? "max" : null;
}
