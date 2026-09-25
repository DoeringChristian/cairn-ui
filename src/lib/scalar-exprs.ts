/**
 * Scalar expressions over a set of runs: the pure half of
 * `useScalarExprs` (lib/use-scalar-exprs.ts).
 *
 * Multi-run cards (scatter axes, parallel columns, the bar metric, the tile
 * and the importance target) each read one scalar per run from an
 * expression `{src}` such as `config.lr`, `min(val.loss)` or
 * `last(acc) / config.batch_size`. `planScalarExprs` compiles them and says
 * which metric series must be fetched: none when every metric is only
 * reduced (`plan() === "stats"`), since the run's `stats` answer those.
 *
 * Tested in `scalar-exprs.test.ts`.
 */
import {
  check,
  deps,
  evaluate,
  ExprError,
  parse,
  parseTime,
  parseTemplate,
  plan,
  type ExprWarning,
  type Node,
  type Reducer,
  type RunContext,
  type RunField,
  type SeriesData,
} from "./expr/index.ts";
import type { FieldOption } from "../components/settings/palette/logic.ts";
import type { Param, RunDetailResponse, SequencePoint } from "../api/types.ts";

/** A scalar expression setting (an axis, a column, a metric). */
export interface ScalarExprDef {
  src: string;
}

export interface CompiledScalarExpr {
  src: string;
  node: Node | null;
  /** Parse / type error, or "is a series" — the expression then yields nothing. */
  error: string | null;
  /** "stats": run stats suffice; "series": `metrics` must be fetched. */
  plan: "stats" | "series";
  metrics: string[];
}

export interface ScalarExprPlan {
  compiled: CompiledScalarExpr[];
  /** Metric series to fetch per run (for the "series" expressions), unique. */
  seriesMetrics: string[];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Parse and type-check one scalar expression. */
export function compileScalarExpr(src: string): CompiledScalarExpr {
  const text = src.trim();
  if (!text) return { src, node: null, error: "empty expression", plan: "stats", metrics: [] };
  let node: Node;
  try {
    node = parse(text);
    const t = check(node);
    if (t.shape === "series") {
      return {
        src,
        node: null,
        error: `this is a series; reduce it to one value, e.g. last(${text})`,
        plan: "stats",
        metrics: [],
      };
    }
  } catch (e) {
    return { src, node: null, error: message(e), plan: "stats", metrics: [] };
  }
  const p = plan(node);
  return { src, node, error: null, plan: p, metrics: p === "series" ? deps(node).metrics : [] };
}

/** Why `src` is not a valid scalar expression, or null. */
export function validateScalarExpr(src: string): string | null {
  return compileScalarExpr(src).error;
}

/** Compile `srcs` and collect the metric series the "series" ones need. */
export function planScalarExprs(srcs: readonly string[]): ScalarExprPlan {
  const compiled = srcs.map(compileScalarExpr);
  const seriesMetrics: string[] = [];
  for (const c of compiled) for (const m of c.metrics) if (!seriesMetrics.includes(m)) seriesMetrics.push(m);
  return { compiled, seriesMetrics };
}

/** The `${…}` hole sources of a template (to fetch what they read); [] if it does not parse. */
export function templateSrcs(template: string): string[] {
  if (!template.includes("${")) return [];
  try {
    return parseTemplate(template).parts.flatMap((p) => (typeof p === "string" ? [] : [p.src]));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Run contexts
// ---------------------------------------------------------------------------

/** A sequence response's points as expression series data. */
export function pointsToSeries(points: readonly SequencePoint[]): SeriesData {
  return {
    steps: points.map((p) => p.step),
    values: points.map((p) => p.scalar_value),
    wall: points.map((p) => parseTime(p.wall_time)),
  };
}

function decodeParams(params: readonly Param[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params ?? []) {
    try {
      out[p.key] = JSON.parse(p.value);
    } catch {
      out[p.key] = p.value;
    }
  }
  return out;
}

function runField(detail: RunDetailResponse, field: RunField): unknown {
  const r = detail.run;
  switch (field) {
    case "name":
      return r.display_name ?? r.id;
    case "id":
      return r.id;
    case "status":
      return r.status;
    case "tags": {
      if (!r.tags) return [];
      try {
        const t: unknown = JSON.parse(r.tags);
        return Array.isArray(t) ? t : [];
      } catch {
        return [];
      }
    }
    case "group":
      return r.group;
    case "job_type":
      return r.job_type;
    case "created_at":
      return r.created_at;
  }
}

/**
 * Everything an expression reads about one run: its details (config,
 * summary, run fields, and `run.stats` for reducers over a metric) and the
 * metric series fetched so far.
 */
export function runContext(detail: RunDetailResponse, series: ReadonlyMap<string, SeriesData>): RunContext {
  const config = decodeParams(detail.params);
  const summary = decodeParams(detail.summary);
  const stats = detail.run.stats;
  return {
    series: (name) => series.get(name) ?? null,
    stat: (name: string, reducer: Reducer) => {
      // Fetched series win (they are live-updated); without stats, fall back to them.
      if (series.has(name) || !stats) return undefined;
      const s = stats[name];
      // No stats entry: the run has no finite value for this metric.
      return s ? s[reducer] : null;
    },
    config: (key) => config[key],
    summary: (key) => summary[key],
    run: (field) => runField(detail, field),
  };
}

export interface ScalarResult {
  value: unknown;
  warnings: ExprWarning[];
  /** A per-run evaluation error (e.g. an axis root without a metric). */
  error: string | null;
}

/** Evaluate a compiled scalar expression for one run. */
export function evalScalar(c: CompiledScalarExpr, ctx: RunContext): ScalarResult {
  if (!c.node) return { value: null, warnings: [], error: c.error };
  try {
    const r = evaluate(c.node, ctx);
    return {
      value: r.value.kind === "scalar" ? r.value.value : null,
      warnings: r.warnings,
      error: null,
    };
  } catch (e) {
    if (e instanceof ExprError) return { value: null, warnings: [], error: e.message };
    throw e;
  }
}

/** A value as a plot number: finite numbers, bools as 0/1; anything else null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** A value as text (a categorical axis tick, a CSV cell); null stays null. */
export function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Field options: one click for a plain param / metric pick
// ---------------------------------------------------------------------------

const KEYWORDS = new Set(["and", "or", "not", "in", "true", "false", "null", "True", "False", "None"]);
const ROOTS = new Set(["config", "summary", "run", "step", "wall_time", "relative_time"]);
const HEAD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TAIL = /^[A-Za-z0-9_]+$/;

const backtick = (s: string) => "`" + s.replace(/`/g, "``") + "`";

/** A dotted key after a root (`config.<key>`): segments quoted as needed. */
function keyPath(key: string): string {
  const segs = key.split(".");
  if (segs.some((s) => s === "")) return backtick(key);
  return segs.map((s) => (TAIL.test(s) ? s : backtick(s))).join(".");
}

/** A metric name as it must be written in an expression (`train.loss`, `` `train/loss` ``). */
export function quoteMetric(name: string): string {
  const segs = name.split(".");
  if (segs.some((s) => s === "")) return backtick(name);
  return segs
    .map((s, i) => {
      const ok = i === 0 ? HEAD.test(s) && !ROOTS.has(s) && !(segs.length === 1 && KEYWORDS.has(s)) : TAIL.test(s);
      return ok ? s : backtick(s);
    })
    .join(".");
}

export const paramExpr = (key: string): string => `config.${keyPath(key)}`;
export const summaryExpr = (key: string): string => `summary.${keyPath(key)}`;
export const metricExpr = (name: string, reducer: Reducer): string => `${reducer}(${quoteMetric(name)})`;

/** The reducer a metric's pick uses: its summary rule, else `last`. */
export function reducerForRule(rule: string | null | undefined): Reducer {
  return rule === "min" || rule === "max" || rule === "mean" ? rule : "last";
}

/**
 * Picker options for the runs' fields: every param as `config.<key>`, every
 * scalar metric reduced by its summary rule (`min(val.loss)`, else
 * `last(loss)`), and every summary key as `summary.<key>`. Any other
 * expression is typed in.
 */
export function scalarFieldOptions(details: ReadonlyArray<RunDetailResponse | undefined>): FieldOption[] {
  const params = new Set<string>();
  const summary = new Set<string>();
  const metrics = new Map<string, string | null>();
  for (const d of details) {
    if (!d) continue;
    for (const p of d.params) params.add(p.key);
    for (const s of d.summary ?? []) summary.add(s.key);
    for (const [name, s] of Object.entries(d.run.stats ?? {})) {
      if (!metrics.get(name)) metrics.set(name, s.rule ?? null);
    }
  }
  const sorted = <T>(xs: Iterable<T>, key: (x: T) => string) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
  const opt = (kind: FieldOption["kind"], src: string): FieldOption => ({ key: src, kind, label: src });
  return [
    ...sorted(params, (k) => k).map((k) => opt("param", paramExpr(k))),
    ...sorted(metrics.entries(), ([n]) => n).map(([n, rule]) => opt("metric", metricExpr(n, reducerForRule(rule)))),
    ...sorted(summary, (k) => k).map((k) => opt("metric", summaryExpr(k))),
  ];
}

/**
 * Which way is better for an expression's value, from its metric's summary
 * rule (`max` = higher is better) when it reads exactly one metric with a
 * min/max rule; else null (the caller's default).
 */
export function ruleDirection(
  src: string,
  ruleOf: (metric: string) => string | null | undefined,
): "min" | "max" | null {
  let node: Node;
  try {
    node = parse(src);
  } catch {
    return null;
  }
  const ms = deps(node).metrics;
  if (ms.length !== 1) return null;
  const rule = ruleOf(ms[0]!);
  return rule === "min" || rule === "max" ? rule : null;
}
