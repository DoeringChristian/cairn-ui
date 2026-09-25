/**
 * Pratt parser for the expression language, plus `${…}` templates.
 * MIRRORED by cairn `cairn/expr.py`.
 *
 * Binding powers (low → high), as in Python:
 *   or 10 · and 20 · not 30 (prefix) · comparisons 40 (chained) ·
 *   + - 50 · * / % 60 · unary - + 70 (prefix) · ** 80 (right-assoc)
 */
import {
  ExprError,
  RUN_FIELDS,
  type ArithOp,
  didYouMean,
  type Axis,
  type CmpOp,
  type Node,
  type RunField,
  type Span,
} from "./ast.ts";
import { tokenize, type NameSegment, type Token } from "./lexer.ts";
import { FUNCTION_NAMES } from "./functions.ts";

const CMP_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);
const ARITH_BP: Record<string, number> = { "+": 50, "-": 50, "*": 60, "/": 60, "%": 60, "**": 80 };

function tokText(src: string, t: Token): string {
  return t.kind === "eof" ? "end of expression" : `'${src.slice(t.span.start, t.span.end)}'`;
}

class Parser {
  private pos = 0;
  private readonly src: string;
  private readonly toks: Token[];
  constructor(src: string, toks: Token[]) {
    this.src = src;
    this.toks = toks;
  }

  peek(k = 0): Token {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)]!;
  }
  next(): Token {
    const t = this.peek();
    if (this.pos < this.toks.length - 1) this.pos += 1;
    return t;
  }
  isOp(t: Token, v: string): boolean {
    return t.kind === "op" && t.value === v;
  }
  isKw(t: Token, v: string): boolean {
    return t.kind === "kw" && t.value === v;
  }
  unexpected(t: Token): ExprError {
    if (t.kind === "eof") return new ExprError("unexpected end of expression", t.span);
    return new ExprError(`unexpected ${tokText(this.src, t)}`, t.span);
  }

  parseTop(): Node {
    if (this.peek().kind === "eof") throw new ExprError("empty expression", this.peek().span);
    const node = this.expr(0);
    const t = this.peek();
    if (t.kind !== "eof") throw this.unexpected(t);
    return node;
  }

  /** Left binding power of the token in infix position (0: not infix). */
  lbp(): number {
    const t = this.peek();
    if (t.kind === "kw") {
      if (t.value === "or") return 10;
      if (t.value === "and") return 20;
      if (t.value === "in") return 40;
      if (t.value === "not" && this.isKw(this.peek(1), "in")) return 40;
      return 0;
    }
    if (t.kind === "op") {
      if (CMP_OPS.has(t.value)) return 40;
      return ARITH_BP[t.value] ?? 0;
    }
    return 0;
  }

  expr(rbp: number): Node {
    let left = this.nud(rbp);
    while (this.lbp() > rbp) left = this.led(left);
    return left;
  }

  cmpOp(): CmpOp {
    const t = this.next();
    if (t.kind === "kw" && t.value === "not") {
      this.next();
      return "not in";
    }
    return (t.kind === "kw" ? t.value : (t as { value: string }).value) as CmpOp;
  }

  led(left: Node): Node {
    const t = this.peek();
    const bp = this.lbp();
    if (bp === 40) {
      const ops: CmpOp[] = [];
      const operands: Node[] = [left];
      while (this.lbp() === 40) {
        ops.push(this.cmpOp());
        operands.push(this.expr(40));
      }
      const last = operands[operands.length - 1]!;
      return { type: "compare", ops, operands, span: { start: left.span.start, end: last.span.end } };
    }
    this.next();
    const op = t.kind === "kw" ? t.value : (t as { value: string }).value;
    const right = this.expr(op === "**" ? 79 : bp);
    return {
      type: "binary",
      op: op as ArithOp | "and" | "or",
      left,
      right,
      span: { start: left.span.start, end: right.span.end },
    };
  }

  nud(rbp: number): Node {
    const t = this.next();
    switch (t.kind) {
      case "num":
        return { type: "num", value: t.value, span: t.span };
      case "str":
        return { type: "str", value: t.value, span: t.span };
      case "kw":
        if (t.value === "true" || t.value === "false") return { type: "bool", value: t.value === "true", span: t.span };
        if (t.value === "null") return { type: "null", span: t.span };
        if (t.value === "not") {
          if (rbp > 30) throw new ExprError("'not' needs parentheses here: (not …)", t.span);
          const operand = this.expr(30);
          return { type: "unary", op: "not", operand, span: { start: t.span.start, end: operand.span.end } };
        }
        throw this.unexpected(t);
      case "op":
        if (t.value === "-" || t.value === "+") {
          const operand = this.expr(70);
          return { type: "unary", op: t.value, operand, span: { start: t.span.start, end: operand.span.end } };
        }
        if (t.value === "(") {
          const inner = this.expr(0);
          const close = this.peek();
          if (!this.isOp(close, ")")) {
            if (close.kind === "eof") throw new ExprError("unclosed '('", t.span);
            throw new ExprError(`expected ')' but found ${tokText(this.src, close)}`, close.span);
          }
          this.next();
          // Parentheses keep the inner node but widen nothing: spans stay on the content.
          return inner;
        }
        if (t.value === "[") {
          const items: Node[] = [];
          while (!this.isOp(this.peek(), "]")) {
            items.push(this.expr(0));
            const sep = this.peek();
            if (this.isOp(sep, ",")) {
              this.next();
              continue;
            }
            if (this.isOp(sep, "]")) break;
            if (sep.kind === "eof") throw new ExprError("unclosed '['", t.span);
            throw new ExprError(`expected ',' or ']' but found ${tokText(this.src, sep)}`, sep.span);
          }
          const close = this.next();
          return { type: "list", items, span: { start: t.span.start, end: close.span.end } };
        }
        throw this.unexpected(t);
      case "name":
        if (this.isOp(this.peek(), "(")) return this.call(t);
        return nameNode(t.segments, t.span);
      case "eof":
        throw this.unexpected(t);
    }
  }

  call(t: Extract<Token, { kind: "name" }>): Node {
    const seg = t.segments[0]!;
    if (t.segments.length !== 1 || seg.quoted) {
      throw new ExprError(`'${this.src.slice(t.span.start, t.span.end)}' is not a function`, t.span);
    }
    if (!FUNCTION_NAMES.includes(seg.text)) {
      throw new ExprError(`unknown function '${seg.text}'${didYouMean(seg.text, FUNCTION_NAMES)}`, t.span);
    }
    const open = this.next();
    const args: Node[] = [];
    if (!this.isOp(this.peek(), ")")) {
      for (;;) {
        args.push(this.expr(0));
        const sep = this.peek();
        if (this.isOp(sep, ",")) {
          this.next();
          continue;
        }
        if (this.isOp(sep, ")")) break;
        if (sep.kind === "eof") throw new ExprError("unclosed '('", open.span);
        throw new ExprError(`expected ',' or ')' but found ${tokText(this.src, sep)}`, sep.span);
      }
    }
    const close = this.next();
    return { type: "call", fn: seg.text, fnSpan: t.span, args, span: { start: t.span.start, end: close.span.end } };
  }
}

function nameNode(segments: NameSegment[], span: Span): Node {
  const head = segments[0]!;
  const rest = segments.slice(1).map((s) => s.text);
  if (!head.quoted) {
    switch (head.text) {
      case "config":
      case "summary":
        if (rest.length === 0) {
          throw new ExprError(`'${head.text}' needs a key, e.g. ${head.text}.lr`, span);
        }
        return head.text === "config"
          ? { type: "config", key: rest.join("."), span }
          : { type: "summary", key: rest.join("."), span };
      case "run": {
        if (rest.length === 0) throw new ExprError(`'run' needs a field: ${RUN_FIELDS.map((f) => `run.${f}`).join(", ")}`, span);
        const field = rest.join(".");
        if (rest.length !== 1 || !(RUN_FIELDS as readonly string[]).includes(field)) {
          throw new ExprError(`unknown run field '${field}'${didYouMean(field, RUN_FIELDS)}`, span);
        }
        return { type: "run", field: field as RunField, span };
      }
      case "step":
      case "wall_time":
      case "relative_time":
        if (rest.length > 0) {
          throw new ExprError(`'${head.text}' has no fields; quote a metric named like this: \`${[head.text, ...rest].join(".")}\``, span);
        }
        return { type: "axis", axis: head.text as Axis, span };
    }
  }
  return { type: "metric", name: segments.map((s) => s.text).join("."), span };
}

function shiftSpan(s: Span, by: number): Span {
  return { start: s.start + by, end: s.end + by };
}

/** Parse `src[start:end]`, reporting spans relative to the whole `src`. */
function parseRange(src: string, start: number, end: number): Node {
  const sub = src.slice(start, end);
  let toks: Token[];
  try {
    toks = tokenize(sub);
  } catch (e) {
    if (e instanceof ExprError) throw new ExprError(e.message, shiftSpan(e.span, start));
    throw e;
  }
  for (const t of toks) t.span = shiftSpan(t.span, start);
  return new Parser(src, toks).parseTop();
}

/** Parse an expression; throws `ExprError` with the offending span. */
export function parse(src: string): Node {
  return parseRange(src, 0, src.length);
}

/** One `${…}` hole of a template. */
export interface TemplateHole {
  node: Node;
  /** The expression source inside the braces. */
  src: string;
  /** Span of the whole `${…}` in the template. */
  span: Span;
}

export interface Template {
  parts: Array<string | TemplateHole>;
}

/**
 * Parse `"loss ${last(loss)} for ${run.name}"`. `$$` is a literal `$`. The
 * closing brace is the first `}` outside a quoted string or name.
 */
export function parseTemplate(src: string): Template {
  const parts: Array<string | TemplateHole> = [];
  let text = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === "$" && src[i + 1] === "$") {
      text += "$";
      i += 2;
      continue;
    }
    if (c === "$" && src[i + 1] === "{") {
      let j = i + 2;
      let quote: string | null = null;
      while (j < n) {
        const d = src[j]!;
        if (quote !== null) {
          if (d === "\\" && quote !== "`") j += 1;
          else if (d === quote) quote = null;
        } else if (d === '"' || d === "'" || d === "`") quote = d;
        else if (d === "}") break;
        j += 1;
      }
      if (j >= n) throw new ExprError("unclosed '${'", { start: i, end: n });
      if (src.slice(i + 2, j).trim() === "") throw new ExprError("empty expression", { start: i, end: j + 1 });
      if (text !== "") parts.push(text);
      text = "";
      parts.push({ node: parseRange(src, i + 2, j), src: src.slice(i + 2, j), span: { start: i, end: j + 1 } });
      i = j + 1;
      continue;
    }
    text += c;
    i += 1;
  }
  if (text !== "") parts.push(text);
  return { parts };
}
