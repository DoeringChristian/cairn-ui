import { smoothSeries, type SmoothingKind } from "../lib/plot-utils/smooth.ts";
import { filterOutliers } from "../lib/plot-utils/outlier.ts";
import { bucketPoints } from "../lib/plot-utils/bucket.ts";
import { stackColumns, type StackMode } from "../lib/plot-utils/stack.ts";
import { asOfLookup } from "../lib/plot-utils/x-axis.ts";
import type { AxisScale, Series, SeriesPoint } from "../lib/plot-utils/types.ts";
import {
  ExprError,
  check,
  checkTemplate,
  deps,
  evaluate,
  formatType,
  parse,
  parseTemplate,
  renderTemplate,
  type ExprWarning,
  type Node,
  type Reducer,
  type RunContext,
  type RunField,
  type SeriesData,
  type Span,
  type Template,
} from "../lib/expr/index.ts";

// ---------------------------------------------------------------------------
// Drawing: every line on one shared x array
// ---------------------------------------------------------------------------

/**
 * One drawn line: a series, the faded raw copy under a smoothed one ("raw"),
 * a group member, a group's band edge (which shares its line's key), or the
 * min/max envelope of a bucketed line ("envHi"/"envLo", same key).
 */
export type DrawnRole = "line" | "raw" | "member" | "bandHi" | "bandLo" | "envHi" | "envLo";

export interface DrawnSeries {
  key: string;
  label: string;
  color: string;
  role: DrawnRole;
  /** The run the line belongs to (none for a group's centre and band). */
  runId?: string;
  /** Source points aligned with the shared x array (null = no sample at that x). */
  points: Array<SeriesPoint | null>;
}

export interface AlignedData {
  xs: number[];
  lines: DrawnSeries[];
  /** The y each line is drawn at per x: its value, or its cumulative top when stacked. */
  ys: Array<Array<number | null>>;
}

export interface AlignOptions {
  smoothing: number;
  smoothingKind: SmoothingKind;
  outlierPct: [number, number];
  xScale: AxisScale;
  yScale: AxisScale;
  /** Keep the faded raw copy under a smoothed line (default true). */
  showOriginal?: boolean;
  stack?: StackMode;
  /** Min/max bucketing over the visible x range (`fullFidelity`); null draws every point. */
  bucket?: { lo: number | null; hi: number | null; buckets: number } | null;
}

const isBand = (role: DrawnRole) => role === "bandHi" || role === "bandLo";

/**
 * Put every series on one shared, sorted x array — uPlot draws columns, and
 * runs rarely log at the same steps. Missing samples become null and the
 * line spans over them. Values a log axis can't show become null too.
 *
 * Stacked modes draw only the lines (no raw copies, members or bands), each
 * at its cumulative top; the points keep each line's own values.
 */
export function alignSeries(series: Series[], opts: AlignOptions): AlignedData {
  const stack = opts.stack ?? "none";
  const showOriginal = opts.showOriginal ?? true;
  // Every line buckets over one range, so the buckets share their x columns.
  let range = opts.bucket ?? null;
  if (range && (range.lo == null || range.hi == null)) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
    }
    range = { ...range, lo: range.lo ?? (lo <= hi ? lo : null), hi: range.hi ?? (lo <= hi ? hi : null) };
  }
  const prepared: Array<{ s: Series; role: DrawnRole; points: SeriesPoint[] }> = [];
  for (const s of series) {
    const role: DrawnRole = s.role ?? "line";
    if (stack !== "none" && role !== "line") continue;
    const band = isBand(role);
    // Band edges are already aggregates: no outlier cut, smoothing or raw copy.
    let points = band ? s.points : filterOutliers(s.points, opts.outlierPct[0], opts.outlierPct[1]);
    if (opts.xScale === "log") points = points.filter((p) => p.x > 0);
    if (opts.yScale === "log") points = points.filter((p) => p.y > 0);
    if (band) {
      prepared.push({ s, role, points });
      continue;
    }
    const { smoothed, raw } = smoothSeries(points, opts.smoothingKind, opts.smoothing);
    const bucket = (pts: SeriesPoint[]) =>
      range ? bucketPoints(pts, { ...range, log: opts.xScale === "log" }) : null;
    // A member is already the faded copy under its group's mean.
    if (raw && role === "line" && showOriginal && stack === "none") {
      prepared.push({ s, role: "raw", points: bucket(raw)?.line ?? raw });
    }
    const b = bucket(smoothed);
    if (b?.bucketed && role === "line" && stack === "none") {
      prepared.push({ s, role: "envHi", points: b.hi });
      prepared.push({ s, role: "envLo", points: b.lo });
    }
    prepared.push({ s, role, points: b?.line ?? smoothed });
  }

  const xSet = new Set<number>();
  for (const p of prepared) for (const pt of p.points) xSet.add(pt.x);
  const xs = Array.from(xSet).sort((a, b) => a - b);
  const index = new Map<number, number>();
  xs.forEach((x, i) => index.set(x, i));

  const lines = prepared.map(({ s, role, points }): DrawnSeries => {
    const col = new Array<SeriesPoint | null>(xs.length).fill(null);
    for (const pt of points) col[index.get(pt.x)!] = pt;
    return { key: s.key, label: s.label, color: s.color, role, runId: s.runId, points: col };
  });
  const own = lines.map((l) => l.points.map((p) => (p ? p.y : null)));
  const ys = stack === "none" ? own : stackColumns(own, stack);
  return { xs, lines, ys };
}

// ---------------------------------------------------------------------------
// One run's data for expressions
// ---------------------------------------------------------------------------

/** A metric's fetched points as expression series data (wall time in epoch ms). */
export function sequenceData(
  points: ReadonlyArray<{ step: number; scalar_value: number | null; wall_time: string }>,
): SeriesData {
  const steps: number[] = [];
  const values: Array<number | null> = [];
  const wall: Array<number | null> = [];
  for (const p of points) {
    steps.push(p.step);
    values.push(p.scalar_value);
    const t = Date.parse(p.wall_time);
    wall.push(Number.isFinite(t) ? t : null);
  }
  return { steps, values, wall };
}

/** The run fields and per-metric stats an expression may read. */
export interface RunFacts {
  id: string;
  display_name?: string | null;
  status?: string;
  /** A JSON-encoded list (as the API sends it) or a list. */
  tags?: string | string[] | null;
  group?: string | null;
  job_type?: string | null;
  created_at?: string;
  stats?: Record<string, Partial<Record<Reducer, number | null>>>;
}

function parseTags(tags: RunFacts["tags"]): string[] {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * A `RunContext` over the series fetched for one run, its config (flattened
 * dotted keys), summary and run fields. Reducers over a metric use the
 * server's stats when present.
 */
export function makeRunContext(args: {
  series: ReadonlyMap<string, SeriesData>;
  run?: RunFacts;
  config?: Record<string, unknown>;
  summary?: Record<string, unknown>;
}): RunContext {
  const { series, run, config, summary } = args;
  return {
    series: (name) => series.get(name) ?? null,
    stat: (name, reducer) => {
      const v = run?.stats?.[name]?.[reducer];
      return v === undefined ? undefined : v;
    },
    config: (key) => config?.[key] ?? null,
    summary: (key) => summary?.[key] ?? null,
    run: (field: RunField) => {
      if (!run) return null;
      switch (field) {
        case "name":
          return run.display_name ?? run.id;
        case "tags":
          return parseTags(run.tags);
        default:
          return run[field] ?? null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Expressions: x, derived series, templates
// ---------------------------------------------------------------------------

export interface Compiled<T> {
  value: T | null;
  error: { message: string; span: Span } | null;
}

function fail<T>(e: unknown, src: string): Compiled<T> {
  if (e instanceof ExprError) return { value: null, error: { message: e.message, span: e.span } };
  return { value: null, error: { message: String(e), span: { start: 0, end: src.length } } };
}

/**
 * Parse and type-check a series expression (the x-axis, a derived series):
 * it must be a numeric (or bool) series. The error carries its source span.
 */
export function compileSeriesExpr(src: string): Compiled<Node> {
  try {
    const node = parse(src);
    const t = check(node);
    if (t.shape !== "series") {
      throw new ExprError(`expected a series, got ${formatType(t)}`, node.span);
    }
    if (t.base === "string") {
      throw new ExprError(`expected numbers, got ${formatType(t)}`, node.span);
    }
    return { value: node, error: null };
  } catch (e) {
    return fail(e, src);
  }
}

/** Parse and check a `${…}` template; an empty source is no template. */
export function compileTemplate(src: string): Compiled<Template> {
  if (!src.trim()) return { value: null, error: null };
  try {
    const tpl = parseTemplate(src);
    checkTemplate(tpl);
    return { value: tpl, error: null };
  } catch (e) {
    return fail(e, src);
  }
}

/** A template's text for one run; `fallback` when it fails or renders empty. */
export function renderLabel(tpl: Template | null, ctx: RunContext | undefined, fallback: string): string {
  if (!tpl || !ctx) return fallback;
  try {
    return renderTemplate(tpl, ctx) || fallback;
  } catch {
    return fallback;
  }
}

/** The metrics an expression reads (to fetch them). */
export function exprMetrics(node: Node | null): string[] {
  return node ? deps(node).metrics : [];
}

export interface XValues {
  /** The x value in effect at a step (as-of), or null. */
  at: (step: number) => number | null;
  warnings: ExprWarning[];
}

const numOrNull = (v: number | boolean | null | undefined): number | null =>
  typeof v === "boolean" ? (v ? 1 : 0) : v != null && Number.isFinite(v) ? v : null;

/**
 * Evaluate the x expression over `domain` (the line's own steps): `step`,
 * `wall_time` and `relative_time` run over them, a metric is joined as of
 * each step. `null` when x is not a series here.
 */
export function evalX(x: Node, ctx: RunContext, domain: SeriesData): XValues | null {
  const r = evaluate(x, ctx, { domain });
  if (r.value.kind !== "series") return null;
  const { steps, values } = r.value;
  const at = asOfLookup(steps.map((step, i) => ({ step, scalar_value: numOrNull(values[i]) })));
  return { at, warnings: r.warnings };
}

/**
 * A line's points: each y sample at its step's x (dropping steps without an
 * x or a finite y), sorted by x.
 */
export function toPoints(y: SeriesData, x: XValues): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < y.steps.length; i++) {
    const v = y.values[i];
    if (v == null || !Number.isFinite(v)) continue;
    const xv = x.at(y.steps[i]!);
    if (xv == null) continue;
    const pt: SeriesPoint = { x: xv, y: v };
    const w = y.wall?.[i];
    if (w != null) pt.wallTime = new Date(w).toISOString();
    out.push(pt);
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

export interface LineResult {
  points: SeriesPoint[];
  warnings: ExprWarning[];
}

/** A metric's line for one run against the x expression. */
export function metricLine(name: string, x: Node, ctx: RunContext): LineResult {
  const y = ctx.series(name);
  if (!y) return { points: [], warnings: [] };
  const xv = evalX(x, ctx, y);
  if (!xv) return { points: [], warnings: [] };
  return { points: toPoints(y, xv), warnings: xv.warnings };
}

/**
 * A derived series' line for one run: the expression over its steps, against
 * the x expression evaluated on the steps of its first metric.
 */
export function derivedLine(expr: Node, x: Node, ctx: RunContext): LineResult {
  const r = evaluate(expr, ctx);
  if (r.value.kind !== "series") return { points: [], warnings: r.warnings };
  const first = deps(expr).metrics[0];
  const base: SeriesData = { steps: r.value.steps, values: r.value.values.map(numOrNull) };
  const domain = (first ? ctx.series(first) : null) ?? base;
  // Wall times of the derived steps, as of the first metric's points.
  const dw = domain.wall;
  const wallAt = dw ? asOfLookup(domain.steps.map((step, i) => ({ step, scalar_value: dw[i] ?? null }))) : null;
  const y: SeriesData = wallAt ? { ...base, wall: base.steps.map((s) => wallAt(s)) } : base;
  const xv = evalX(x, ctx, domain);
  if (!xv) return { points: [], warnings: r.warnings };
  return { points: toPoints(y, xv), warnings: [...r.warnings, ...xv.warnings] };
}

/**
 * A metric name as an expression: as is when it already parses to that
 * metric (`val.loss`), else backtick-quoted (`` `train/loss` ``, `` `step` ``).
 */
export function metricRef(name: string): string {
  try {
    const n = parse(name);
    if (n.type === "metric" && n.name === name) return name;
  } catch {
    // Not a plain name: quote it.
  }
  return `\`${name.replace(/`/g, "``")}\``;
}

/** The x expression's axis kind: time axes format as dates / seconds. */
export function xAxisKind(src: string): "step" | "wall_time" | "relative_time" | "value" {
  const s = src.trim();
  if (s === "step" || s === "wall_time" || s === "relative_time") return s;
  return "value";
}

// ---------------------------------------------------------------------------
// Which runs a card draws
// ---------------------------------------------------------------------------

/**
 * Runs to draw, in order: with `latestPerGroup`, only the newest run of each
 * group (runs without a group all stay); then the first `maxRuns`.
 */
export function limitRuns(
  runIds: readonly string[],
  opts: {
    latestPerGroup: boolean;
    maxRuns: number | null;
    groupOf: (id: string) => string | null;
    createdAt: (id: string) => number | undefined;
  },
): string[] {
  let out = [...runIds];
  if (opts.latestPerGroup) {
    const newest = new Map<string, string>();
    for (const id of out) {
      const g = opts.groupOf(id);
      if (g == null) continue;
      const cur = newest.get(g);
      if (cur === undefined || (opts.createdAt(id) ?? -Infinity) > (opts.createdAt(cur) ?? -Infinity)) {
        newest.set(g, id);
      }
    }
    const keep = new Set(newest.values());
    out = out.filter((id) => opts.groupOf(id) == null || keep.has(id));
  }
  if (opts.maxRuns != null && opts.maxRuns >= 0) out = out.slice(0, opts.maxRuns);
  return out;
}
