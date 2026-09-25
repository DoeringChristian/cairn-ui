/**
 * # The cairn expression language
 *
 * Derived values over one run: chart series (`loss / step`), scalar
 * columns and axes (`min(val.loss)`), run filters
 * (`config.opt in ["adam", "sgd"] and last(acc) > 0.9`) and `${…}` text
 * templates. Pure; MIRRORED by cairn `cairn/expr.py`, and both sides run
 * `docs/schemas/expr-vectors.json` (the contract: when in doubt, the
 * vectors say what the language does).
 *
 * ## Syntax (Python-like, Pratt parser)
 * Precedence, low → high: `or` · `and` · `not` · comparisons
 * (`== != < <= > >= in`, `not in`; chained like Python: `0 < x <= 1`) ·
 * `+ -` · `* / %` · unary `- +` · `**` (right-assoc; `-2**2 == -4`) ·
 * calls and atoms. Literals: numbers (`1`, `.5`, `1e-3`), strings (`'…'`
 * or `"…"`, backslash escapes), `true false null` (also `True False
 * None`), lists `[1, "a"]`, parentheses.
 *
 * Names are dotted (`train.loss`, `layer.0.w`). A segment in backticks is
 * taken literally (`` `train/loss` ``, `` `a``b` `` for a backtick) and is
 * never a keyword or reserved root. Reserved roots (unquoted first segment):
 * - `config.<key>`, `summary.<key>`: scalar<any> by flattened dotted key;
 * - `run.{name,id,status,tags,group,job_type,created_at}`: scalar;
 * - `step`, `wall_time` (epoch ms), `relative_time` (seconds since
 *   `run.created_at`): series<number> over the *domain*, which is
 *   `EvalOptions.domain` or else the first metric in the expression.
 * Any other name is a metric: series<number>.
 *
 * ## Types
 * `scalar | series` × `number | bool | string | any` (`check` →
 * `ExprType`). Scalars broadcast over series. Two series with different
 * steps are combined by an **as-of join** onto the first series' steps
 * (the other takes its last non-null value at a step <= each step) and the
 * result carries an `ExprWarning{kind:"asof-join"}` — shown as a badge.
 *
 * ## Functions
 * - reducers `min|max|mean|first|last(series) → scalar` (skip null and
 *   NaN; empty → null; on a scalar: identity). With `RunContext.stat`, a
 *   reducer over a bare metric uses the precomputed stat.
 * - pointwise `min|max(a, b)`, `log`, `exp`, `abs`, `clip(x, lo, hi)`.
 * - shape-preserving (series only): `cummin`, `cummax`, `diff` (first →
 *   null), `ema(x, alpha)` (exactly `smooth.ts`'s EMA over the non-null
 *   points; alpha clamped to [0, 0.999]).
 * - explicit joins: `exact(a, b)` = a at the steps where b has a value;
 *   `resample(a, b)` = a's as-of value at every step of b. No warning.
 *
 * ## Values and nulls
 * Arithmetic is IEEE (`1/0 = inf`, `0/0 = NaN`); `%` is Python's (sign of
 * the divisor; `x % 0 = NaN`); bools count as 0/1; `+` concatenates two
 * strings; any other non-number operand gives null. Comparisons are
 * Python's (`pyEq`/`pyCmp`/`pyIn` from `lib/run-filter.ts`): `True == 1`,
 * lexicographic lists, `in` on strings is substring; ordering with null, or
 * a comparison Python would raise on, gives null; NaN orders false.
 * `and`/`or`/`not` are three-valued (Kleene) over Python truthiness, null =
 * unknown. A missing metric is an empty series; a missing key is null.
 *
 * ## API
 * - `parse(src) → Node` — throws `ExprError{message, span:{start,end}}`
 *   (UTF-16 offsets, end exclusive); unknown functions and run fields say
 *   "did you mean …".
 * - `check(node) → ExprType` (`formatType` → `"series<number>"`) — throws
 *   `ExprError` on a type error.
 * - `evaluate(expr: string | Node, ctx: RunContext, opts?: {domain?}) →
 *   {value, type, warnings}`; `value` is `{kind:"scalar", value}` or
 *   `{kind:"series", steps, values: (number|boolean|null)[]}`. Throws
 *   `ExprError` for parse/type errors (and an axis root without a domain);
 *   never for data.
 * - `RunContext` (one run): `series(name) → {steps, values, wall?} | null`
 *   (wall: epoch ms per point), `stat?(name, reducer) → number | null |
 *   undefined` (undefined = unknown → falls back to `series`),
 *   `config(key)`, `summary(key)`, `run(field)` (created_at: epoch ms or
 *   ISO string, naive = UTC).
 * - `deps(node) → {metrics, config, summary, run, axes, reduced}` and
 *   `plan(node) → "stats" | "series"`: "stats" when every metric appears
 *   only as `reducer(metric)` and no axis root is used — then a
 *   `RunContext` whose `stat` answers `deps().reduced` needs no series.
 * - `matches(result) → boolean`: a filter's verdict (scalar, not null,
 *   Python-truthy; a series never matches).
 * - `parseTemplate(src) → Template` (`${expr}` holes; `$$` is `$`),
 *   `checkTemplate(tpl)` (holes must be scalars), `renderTemplate(tpl,
 *   ctx, {format?, domain?}) → string`; default `formatValue`: null → "",
 *   numbers `%.6g` (`formatG`), lists joined by ", ".
 */
import type { EvalResult } from "./eval.ts";
import { pyTruthy } from "../run-filter.ts";

export {
  ExprError,
  RUN_FIELDS,
  AXES,
  type Axis,
  type ExprWarning,
  type Node,
  type RunField,
  type Span,
} from "./ast.ts";
export { parse, parseTemplate, type Template, type TemplateHole } from "./parser.ts";
export { check, formatType, type Base, type ExprType, type Shape } from "./types.ts";
export { deps, plan, type Deps } from "./deps.ts";
export { FUNCTION_NAMES, REDUCERS, type Reducer } from "./functions.ts";
export {
  evaluate,
  parseTime,
  type Cell,
  type EvalOptions,
  type EvalResult,
  type ExprValue,
  type RunContext,
  type SeriesData,
} from "./eval.ts";
export { checkTemplate, formatG, formatValue, renderTemplate, type RenderOptions } from "./template.ts";

/** A filter's verdict: a scalar that is not null and Python-truthy. */
export function matches(result: EvalResult): boolean {
  const v = result.value;
  return v.kind === "scalar" && v.value !== null && pyTruthy(v.value);
}
