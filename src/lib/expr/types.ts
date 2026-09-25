/**
 * Static type check: every node is `scalar | series` × `number | bool |
 * string | any`. Scalars broadcast over series. MIRRORED by cairn
 * `cairn/expr.py`.
 */
import { ExprError, type Node } from "./ast.ts";
import { isReducer } from "./functions.ts";

export type Shape = "scalar" | "series";
export type Base = "number" | "bool" | "string" | "any";
export interface ExprType {
  shape: Shape;
  base: Base;
}

/** `"series<number>"`, `"scalar<any>"`, … */
export function formatType(t: ExprType): string {
  return `${t.shape}<${t.base}>`;
}

const S = (base: Base): ExprType => ({ shape: "scalar", base });
const join = (...ts: ExprType[]): Shape => (ts.some((t) => t.shape === "series") ? "series" : "scalar");

function describe(t: ExprType): string {
  return t.shape === "series" ? `a ${t.base} series` : t.base === "any" ? "a value" : `a ${t.base}`;
}

function notString(t: ExprType, node: Node, what: string): void {
  if (t.base === "string") throw new ExprError(`${what} needs a number, got a string`, node.span);
}

function needSeries(t: ExprType, node: Node, fn: string): void {
  if (t.shape !== "series") throw new ExprError(`${fn}() needs a series, got ${describe(t)}`, node.span);
}

function arity(node: Extract<Node, { type: "call" }>, n: number, sig: string): void {
  if (node.args.length !== n) {
    throw new ExprError(`${node.fn}() takes ${n} argument${n === 1 ? "" : "s"}: ${sig}`, node.span);
  }
}

/** The expression's type; throws `ExprError` on the first type error. */
export function check(node: Node): ExprType {
  switch (node.type) {
    case "num":
      return S("number");
    case "str":
      return S("string");
    case "bool":
      return S("bool");
    case "null":
      return S("any");
    case "list":
      for (const it of node.items) {
        if (check(it).shape === "series") throw new ExprError("list items must be scalars", it.span);
      }
      return S("any");
    case "metric":
    case "axis":
      return { shape: "series", base: "number" };
    case "config":
    case "summary":
      return S("any");
    case "run":
      return S(node.field === "tags" || node.field === "created_at" ? "any" : "string");
    case "unary": {
      const t = check(node.operand);
      if (node.op === "not") return { shape: t.shape, base: "bool" };
      notString(t, node.operand, `unary '${node.op}'`);
      return { shape: t.shape, base: "number" };
    }
    case "binary": {
      const l = check(node.left);
      const r = check(node.right);
      const shape = join(l, r);
      if (node.op === "and" || node.op === "or") return { shape, base: "bool" };
      const ls = l.base === "string";
      const rs = r.base === "string";
      if (node.op === "+" && (ls || rs)) {
        if (ls && rs) return { shape, base: "string" };
        if (l.base === "any" || r.base === "any") return { shape, base: "any" };
        throw new ExprError(`cannot add ${l.base} and ${r.base}`, node.span);
      }
      if (ls || rs) throw new ExprError(`'${node.op}' needs numbers, got a string`, (ls ? node.left : node.right).span);
      if (node.op === "+" && (l.base === "any" || r.base === "any")) return { shape, base: "any" };
      return { shape, base: "number" };
    }
    case "compare": {
      const ts = node.operands.map(check);
      node.ops.forEach((op, i) => {
        const a = ts[i]!;
        const b = ts[i + 1]!;
        if (op === "in" || op === "not in") {
          if (b.shape === "series") {
            throw new ExprError(`'${op}' needs a scalar container on the right`, node.operands[i + 1]!.span);
          }
        } else if (op !== "==" && op !== "!=") {
          const num = (t: ExprType) => t.base === "number" || t.base === "bool";
          if ((a.base === "string" && num(b)) || (num(a) && b.base === "string")) {
            throw new ExprError(`cannot order ${a.base} and ${b.base} with '${op}'`, {
              start: node.operands[i]!.span.start,
              end: node.operands[i + 1]!.span.end,
            });
          }
        }
      });
      return { shape: join(...ts), base: "bool" };
    }
    case "call": {
      const ts = node.args.map(check);
      const fn = node.fn;
      if ((fn === "min" || fn === "max") && node.args.length === 2) {
        ts.forEach((t, i) => notString(t, node.args[i]!, `${fn}()`));
        return { shape: join(...ts), base: "number" };
      }
      if (isReducer(fn)) {
        if (node.args.length !== 1) {
          const extra = fn === "min" || fn === "max" ? ` (reduce) or 2: ${fn}(a, b) (pointwise)` : "";
          throw new ExprError(`${fn}() takes 1 argument: ${fn}(series)${extra}`, node.span);
        }
        notString(ts[0]!, node.args[0]!, `${fn}()`);
        return ts[0]!.shape === "series" ? S("number") : ts[0]!;
      }
      switch (fn) {
        case "cummin":
        case "cummax":
        case "diff":
          arity(node, 1, `${fn}(series)`);
          needSeries(ts[0]!, node.args[0]!, fn);
          return { shape: "series", base: "number" };
        case "ema":
          arity(node, 2, "ema(series, alpha)");
          needSeries(ts[0]!, node.args[0]!, fn);
          if (ts[1]!.shape !== "scalar") throw new ExprError("ema() alpha must be a scalar", node.args[1]!.span);
          notString(ts[1]!, node.args[1]!, "ema() alpha");
          return { shape: "series", base: "number" };
        case "log":
        case "exp":
        case "abs":
          arity(node, 1, `${fn}(x)`);
          notString(ts[0]!, node.args[0]!, `${fn}()`);
          return { shape: ts[0]!.shape, base: "number" };
        case "clip":
          arity(node, 3, "clip(x, lo, hi)");
          ts.forEach((t, i) => notString(t, node.args[i]!, "clip()"));
          return { shape: join(...ts), base: "number" };
        case "exact":
        case "resample":
          arity(node, 2, `${fn}(a, b)`);
          needSeries(ts[0]!, node.args[0]!, fn);
          needSeries(ts[1]!, node.args[1]!, fn);
          return ts[0]!;
      }
      throw new ExprError(`unknown function '${fn}'`, node.fnSpan);
    }
  }
}
