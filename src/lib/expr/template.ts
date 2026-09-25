/**
 * `${…}` templates (legend, tooltip, label text). MIRRORED by cairn
 * `cairn/expr.py`.
 */
import { ExprError } from "./ast.ts";
import { evaluate, type EvalOptions, type RunContext } from "./eval.ts";
import { parseTemplate, type Template } from "./parser.ts";
import { check } from "./types.ts";

/**
 * Python's `"%.{p}g" % x` (default 6 significant digits): fixed notation
 * for exponents in [-4, p), else `1.5e-05`; trailing zeros dropped.
 * Rounding ties go away from zero (JS `toExponential`/`toFixed`); the
 * Python mirror rounds the same way.
 */
export function formatG(x: number, p = 6): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const strip = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  const e = x.toExponential(p - 1);
  const [mant, expStr] = e.split("e") as [string, string];
  const exp = Number(expStr);
  if (exp >= -4 && exp < p) return strip(x.toFixed(Math.max(0, p - 1 - exp)));
  const sign = exp < 0 ? "-" : "+";
  return `${strip(mant)}e${sign}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/**
 * Default text of a template value: null is empty, bools are
 * `true`/`false`, numbers use `formatG`, lists join their items with ", ",
 * objects are compact JSON.
 */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return formatG(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  return JSON.stringify(v);
}

/** Throws `ExprError` if a hole does not type-check or is a series. */
export function checkTemplate(tpl: Template): void {
  for (const part of tpl.parts) {
    if (typeof part === "string") continue;
    if (check(part.node).shape === "series") {
      throw new ExprError(`template value is a series; reduce it, e.g. last(${part.src.trim()})`, part.span);
    }
  }
}

export interface RenderOptions extends EvalOptions {
  format?: (v: unknown) => string;
}

/** Render a template (source or parsed) for one run. */
export function renderTemplate(tpl: string | Template, ctx: RunContext, opts: RenderOptions = {}): string {
  const t = typeof tpl === "string" ? parseTemplate(tpl) : tpl;
  checkTemplate(t);
  const fmt = opts.format ?? formatValue;
  return t.parts
    .map((part) => {
      if (typeof part === "string") return part;
      const r = evaluate(part.node, ctx, opts);
      return fmt(r.value.kind === "scalar" ? r.value.value : null);
    })
    .join("");
}
