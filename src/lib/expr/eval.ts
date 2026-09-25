/**
 * Evaluation of a checked expression against one run. MIRRORED by cairn
 * `cairn/expr.py`; `docs/schemas/expr-vectors.json` pins both.
 */
import { ExprError, type ExprWarning, type Node, type RunField, type Span } from "./ast.ts";
import { parse } from "./parser.ts";
import { deps } from "./deps.ts";
import { check, type ExprType } from "./types.ts";
import { isReducer, type Reducer } from "./functions.ts";
import { pyCmp, pyEq, pyIn, pyTruthy, PyTypeError } from "../run-filter.ts";
import { asOfLookup } from "../plot-utils/x-axis.ts";
import { emaSmooth } from "../plot-utils/smooth.ts";

/** One metric's points, sorted by step or not (they are sorted on read). */
export interface SeriesData {
  steps: readonly number[];
  values: ReadonlyArray<number | null>;
  /** Wall-clock time of each point, epoch milliseconds. */
  wall?: ReadonlyArray<number | null> | null;
}

/** Everything an expression can read about one run. */
export interface RunContext {
  /** A metric's series; null/undefined when the run has no such metric (an empty series). */
  series(name: string): SeriesData | null | undefined;
  /**
   * A precomputed reducer over a metric (the server's run stats). Return
   * undefined when unknown: evaluation then falls back to `series`.
   */
  stat?(name: string, reducer: Reducer): number | null | undefined;
  /** A config value by its flattened dotted key; undefined/null when absent. */
  config(key: string): unknown;
  summary(key: string): unknown;
  /** `run.<field>`; `created_at` is epoch ms or an ISO string (naive = UTC). */
  run(field: RunField): unknown;
}

export type Cell = number | boolean | null;
export type ExprValue =
  | { kind: "scalar"; value: unknown }
  | { kind: "series"; steps: number[]; values: Cell[] };

export interface EvalResult {
  value: ExprValue;
  type: ExprType;
  warnings: ExprWarning[];
}

export interface EvalOptions {
  /**
   * The steps `step` / `wall_time` / `relative_time` run over. Default: the
   * first metric the expression references (source order).
   */
  domain?: SeriesData;
}

type Series = Extract<ExprValue, { kind: "series" }>;
type Val = ExprValue;

const scalar = (value: unknown): Val => ({ kind: "scalar", value: value === undefined ? null : value });

/** Numeric view of a value: bools are 0/1, anything non-numeric is null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function cell(v: unknown): Cell {
  return typeof v === "number" || typeof v === "boolean" ? v : null;
}

function normalize(d: SeriesData | null | undefined): Series {
  if (!d) return { kind: "series", steps: [], values: [] };
  const idx = d.steps.map((_, i) => i).sort((a, b) => d.steps[a]! - d.steps[b]!);
  return {
    kind: "series",
    steps: idx.map((i) => d.steps[i]!),
    values: idx.map((i) => cell(d.values[i])),
  };
}

// ---------------------------------------------------------------------------
// Scalar operations (shared with the Python mirror, value for value)
// ---------------------------------------------------------------------------

function div(x: number, y: number): number {
  return x / y;
}

/** Python's float `%`: the result takes the divisor's sign; `x % 0` is NaN. */
function mod(x: number, y: number): number {
  if (y === 0 || !Number.isFinite(x) || Number.isNaN(y)) return NaN;
  let r = x % y;
  if (r !== 0 && r < 0 !== y < 0) r += y;
  return r;
}

function arith(op: string, a: unknown, b: unknown): unknown {
  if (op === "+" && typeof a === "string" && typeof b === "string") return a + b;
  const x = num(a);
  const y = num(b);
  if (x === null || y === null) return null;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return div(x, y);
    case "%":
      return mod(x, y);
    default:
      return Math.pow(x, y);
  }
}

/** Kleene truth: null is unknown, anything else is Python `bool(v)`. */
function truth(v: unknown): boolean | null {
  return v === null || v === undefined ? null : pyTruthy(v);
}

function kleeneAnd(a: boolean | null, b: boolean | null): boolean | null {
  if (a === false || b === false) return false;
  return a === null || b === null ? null : true;
}

function kleeneOr(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true;
  return a === null || b === null ? null : false;
}

function compare(op: string, a: unknown, b: unknown): boolean | null {
  if (op === "==") return pyEq(a, b);
  if (op === "!=") return !pyEq(a, b);
  try {
    if (op === "in") return pyIn(a, b);
    if (op === "not in") return !pyIn(a, b);
  } catch (e) {
    if (e instanceof PyTypeError) return null;
    throw e;
  }
  if (a === null || b === null) return null;
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null && (Number.isNaN(x) || Number.isNaN(y))) return false;
  let c: number;
  try {
    c = pyCmp(a, b);
  } catch (e) {
    if (e instanceof PyTypeError) return null;
    throw e;
  }
  switch (op) {
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    default:
      return c >= 0;
  }
}

function pointMinMax(fn: string, a: unknown, b: unknown): number | null {
  const x = num(a);
  const y = num(b);
  if (x === null || y === null) return null;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  return fn === "min" ? Math.min(x, y) : Math.max(x, y);
}

function unaryMath(fn: string, a: unknown): number | null {
  const x = num(a);
  if (x === null) return null;
  if (fn === "log") return Math.log(x);
  if (fn === "exp") return Math.exp(x);
  return Math.abs(x);
}

function clip(a: unknown, lo: unknown, hi: unknown): number | null {
  const x = num(a);
  const l = num(lo);
  const h = num(hi);
  if (x === null || l === null || h === null) return null;
  if (Number.isNaN(x) || Number.isNaN(l) || Number.isNaN(h)) return NaN;
  return Math.min(Math.max(x, l), h);
}

/** Epoch ms of a `created_at`: a number is ms, a string is ISO (naive = UTC). */
export function parseTime(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  // A time without an offset is UTC (Date.parse would read it as local time).
  const s = /(?:Z|[+-]\d\d:?\d\d)$/i.test(v) || !v.includes(":") ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Series machinery
// ---------------------------------------------------------------------------

function reduce(fn: Reducer, s: Series): number | null {
  const xs: number[] = [];
  for (const v of s.values) {
    const x = num(v);
    if (x !== null && !Number.isNaN(x)) xs.push(x);
  }
  if (xs.length === 0) return null;
  switch (fn) {
    case "first":
      return xs[0]!;
    case "last":
      return xs[xs.length - 1]!;
    case "min":
      return xs.reduce((m, x) => (x < m ? x : m));
    case "max":
      return xs.reduce((m, x) => (x > m ? x : m));
    case "mean": {
      let acc = 0;
      for (const x of xs) acc += x;
      return acc / xs.length;
    }
  }
}

/**
 * The join lookup into `s`: its value at a step it has (its last point
 * there, null included), else the as-of value (`asOfLookup`: the last
 * non-null value at an earlier step, null before the first). The flag says
 * whether the step matched exactly.
 */
function joinLookup(s: Series): (step: number) => [Cell, boolean] {
  const at = new Map<number, Cell>();
  s.steps.forEach((step, i) => at.set(step, s.values[i]!));
  const asOf = asOfLookup<number | boolean>(s.steps.map((step, i) => ({ step, scalar_value: s.values[i]! })));
  return (step) => (at.has(step) ? [at.get(step)!, true] : [asOf(step), false]);
}

class Evaluator {
  readonly warnings: ExprWarning[] = [];
  private readonly cache = new Map<string, Series>();
  private domainCache: { steps: number[]; wall: Array<number | null> } | null = null;
  private readonly ctx: RunContext;
  private readonly firstMetric: string | null;
  private readonly domain: SeriesData | undefined;

  constructor(ctx: RunContext, firstMetric: string | null, domain: SeriesData | undefined) {
    this.ctx = ctx;
    this.firstMetric = firstMetric;
    this.domain = domain;
  }

  metric(name: string): Series {
    let s = this.cache.get(name);
    if (!s) {
      s = normalize(this.ctx.series(name));
      this.cache.set(name, s);
    }
    return s;
  }

  axisDomain(span: Span, axis: string): { steps: number[]; wall: Array<number | null> } {
    if (this.domainCache) return this.domainCache;
    const d = this.domain ?? (this.firstMetric !== null ? this.ctx.series(this.firstMetric) : undefined);
    if (this.domain === undefined && this.firstMetric === null) {
      throw new ExprError(`'${axis}' needs a metric in the expression to take its steps from`, span);
    }
    const idx = d ? d.steps.map((_, i) => i).sort((a, b) => d.steps[a]! - d.steps[b]!) : [];
    this.domainCache = {
      steps: idx.map((i) => d!.steps[i]!),
      wall: idx.map((i) => {
        const w = d!.wall?.[i];
        return typeof w === "number" ? w : null;
      }),
    };
    return this.domainCache;
  }

  /**
   * Apply `fn` pointwise. Scalars broadcast; series are joined onto the
   * steps of the first series argument, the others looked up as-of. A
   * lookup that is not an exact step match warns once for `span`.
   */
  zip(args: Val[], fn: (xs: unknown[]) => unknown, span: Span): Val {
    const base = args.find((a): a is Series => a.kind === "series");
    if (!base) return scalar(fn(args.map((a) => (a as { value: unknown }).value)));
    let inexact = false;
    const getters = args.map((a): ((step: number, i: number) => unknown) => {
      if (a.kind === "scalar") return () => a.value;
      if (a === base) return (_, i) => base.values[i];
      const look = joinLookup(a);
      return (step, i) => {
        const [v, exact] = look(step);
        if (!exact && base.values[i] !== null) inexact = true;
        return v;
      };
    });
    const values = base.steps.map((step, i) => cell(fn(getters.map((g) => g(step, i)))));
    if (inexact) {
      this.warnings.push({
        kind: "asof-join",
        message:
          "series with different steps were joined as-of (each step takes the other series' last value at or before it); use exact() or resample() to choose",
        span,
      });
    }
    return { kind: "series", steps: [...base.steps], values };
  }

  map(v: Val, fn: (x: unknown) => unknown): Val {
    if (v.kind === "scalar") return scalar(fn(v.value));
    return { kind: "series", steps: [...v.steps], values: v.values.map((x) => cell(fn(x))) };
  }

  ev(node: Node): Val {
    switch (node.type) {
      case "num":
      case "str":
      case "bool":
        return scalar(node.value);
      case "null":
        return scalar(null);
      case "list":
        return scalar(node.items.map((it) => (this.ev(it) as { value: unknown }).value));
      case "metric":
        return this.metric(node.name);
      case "config":
        return scalar(this.ctx.config(node.key));
      case "summary":
        return scalar(this.ctx.summary(node.key));
      case "run":
        return scalar(this.ctx.run(node.field));
      case "axis": {
        const d = this.axisDomain(node.span, node.axis);
        if (node.axis === "step") return { kind: "series", steps: [...d.steps], values: [...d.steps] };
        if (node.axis === "wall_time") return { kind: "series", steps: [...d.steps], values: [...d.wall] };
        const created = parseTime(this.ctx.run("created_at"));
        return {
          kind: "series",
          steps: [...d.steps],
          values: d.wall.map((w) => (w === null || created === null ? null : (w - created) / 1000)),
        };
      }
      case "unary": {
        const v = this.ev(node.operand);
        if (node.op === "not") return this.map(v, (x) => {
          const t = truth(x);
          return t === null ? null : !t;
        });
        return this.map(v, (x) => {
          const n = num(x);
          return n === null ? null : node.op === "-" ? -n : n;
        });
      }
      case "binary": {
        const l = this.ev(node.left);
        const r = this.ev(node.right);
        const op = node.op;
        if (op === "and") return this.zip([l, r], ([a, b]) => kleeneAnd(truth(a), truth(b)), node.span);
        if (op === "or") return this.zip([l, r], ([a, b]) => kleeneOr(truth(a), truth(b)), node.span);
        return this.zip([l, r], ([a, b]) => arith(op, a, b), node.span);
      }
      case "compare": {
        const vals = node.operands.map((o) => this.ev(o));
        const ops = node.ops;
        return this.zip(
          vals,
          (xs) => {
            let acc: boolean | null = true;
            for (let i = 0; i < ops.length; i++) acc = kleeneAnd(acc, compare(ops[i]!, xs[i], xs[i + 1]));
            return acc;
          },
          node.span,
        );
      }
      case "call":
        return this.call(node);
    }
  }

  call(node: Extract<Node, { type: "call" }>): Val {
    const fn = node.fn;
    const a0 = node.args[0]!;
    if (isReducer(fn) && node.args.length === 1) {
      if (a0.type === "metric" && this.ctx.stat) {
        const v = this.ctx.stat(a0.name, fn);
        if (v !== undefined) return scalar(v);
      }
      const v = this.ev(a0);
      return v.kind === "scalar" ? v : scalar(reduce(fn, v));
    }
    const args = node.args.map((a) => this.ev(a));
    switch (fn) {
      case "min":
      case "max":
        return this.zip(args, ([a, b]) => pointMinMax(fn, a, b), node.span);
      case "log":
      case "exp":
      case "abs":
        return this.map(args[0]!, (x) => unaryMath(fn, x));
      case "clip":
        return this.zip(args, ([x, lo, hi]) => clip(x, lo, hi), node.span);
      case "cummin":
      case "cummax": {
        const s = args[0] as Series;
        let state: number | null = null;
        const values = s.values.map((v) => {
          const x = num(v);
          if (x === null) return null;
          if (Number.isNaN(x)) return NaN;
          state = state === null ? x : fn === "cummin" ? Math.min(state, x) : Math.max(state, x);
          return state;
        });
        return { kind: "series", steps: [...s.steps], values };
      }
      case "diff": {
        const s = args[0] as Series;
        let prev: number | null = null;
        const values = s.values.map((v) => {
          const x = num(v);
          if (x === null) return null;
          const out = prev === null ? null : x - prev;
          prev = x;
          return out;
        });
        return { kind: "series", steps: [...s.steps], values };
      }
      case "ema": {
        const s = args[0] as Series;
        const alpha = num((args[1] as { value: unknown }).value);
        if (alpha === null || Number.isNaN(alpha)) {
          return { kind: "series", steps: [...s.steps], values: s.values.map(() => null) };
        }
        const idx: number[] = [];
        const points: Array<{ x: number; y: number }> = [];
        s.values.forEach((v, i) => {
          const y = num(v);
          if (y !== null) {
            idx.push(i);
            points.push({ x: s.steps[i]!, y });
          }
        });
        const values: Cell[] = s.values.map(() => null);
        if (points.length > 0) {
          const { smoothed } = emaSmooth(points, Math.max(alpha, 0));
          smoothed.forEach((p, k) => {
            values[idx[k]!] = p.y;
          });
        }
        return { kind: "series", steps: [...s.steps], values };
      }
      case "exact": {
        const a = args[0] as Series;
        const keep = new Set((args[1] as Series).steps);
        const steps: number[] = [];
        const values: Cell[] = [];
        a.steps.forEach((step, i) => {
          if (keep.has(step)) {
            steps.push(step);
            values.push(a.values[i]!);
          }
        });
        return { kind: "series", steps, values };
      }
      case "resample": {
        const look = joinLookup(args[0] as Series);
        const b = args[1] as Series;
        return { kind: "series", steps: [...b.steps], values: b.steps.map((step) => look(step)[0]) };
      }
    }
    throw new ExprError(`unknown function '${fn}'`, node.fnSpan);
  }
}

/**
 * Evaluate `expr` (source or a parsed node) for one run. Throws `ExprError`
 * on parse/type errors and when an axis root has no steps to run over;
 * data problems (missing values, Python type errors) yield null instead.
 */
export function evaluate(expr: string | Node, ctx: RunContext, opts: EvalOptions = {}): EvalResult {
  const node = typeof expr === "string" ? parse(expr) : expr;
  const type = check(node);
  const first = deps(node).metrics[0] ?? null;
  const ev = new Evaluator(ctx, first, opts.domain);
  const value = ev.ev(node);
  return { value, type, warnings: ev.warnings };
}
