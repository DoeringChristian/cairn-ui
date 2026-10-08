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

export const SUMMARIES: readonly Summary[] = ["min", "max", "mean", "last"];
export const GOALS: readonly Goal[] = ["lower", "higher", "none"];
export const GOAL_LABEL: Record<Goal, string> = { lower: "lower is better", higher: "higher is better", none: "none" };

/** What a metric column's header menu shows: the effective rule, the logged one, and whether the project overrides it. */
export interface MetricRuleMenuState {
  /** The effective summary (no rule: `last`, the last point). */
  summary: Summary;
  goal: Goal;
  logged: Summary | null;
  override: MetricOverride | null;
  /** `logged: summary=min · project overrides`. */
  note: string;
}

export function metricRuleMenuState(doc: MetricRulesDoc | null | undefined, metric: string): MetricRuleMenuState {
  const has = (o: object | undefined) => !!o && Object.prototype.hasOwnProperty.call(o, metric);
  const logged = has(doc?.logged) ? doc!.logged[metric]! : null;
  const override = has(doc?.overrides) ? doc!.overrides[metric]! : null;
  const rule = effectiveRule(override, logged);
  return {
    summary: rule.summary ?? "last",
    goal: rule.goal,
    logged,
    override,
    note: `logged: summary=${logged ?? "none"}${override ? " · project overrides" : ""}`,
  };
}

/**
 * The override after picking a summary or goal in the menu: the other field
 * keeps its override (unset stays unset).
 */
export function withPick(override: MetricOverride | null, pick: { summary: Summary } | { goal: Goal }): MetricOverride {
  return { summary: override?.summary ?? null, goal: override?.goal ?? null, ...pick };
}
