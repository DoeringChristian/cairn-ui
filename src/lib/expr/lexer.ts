/**
 * Tokenizer for the expression language. MIRRORED by cairn `cairn/expr.py`.
 */
import { ExprError, type Span } from "./ast.ts";

export interface NameSegment {
  text: string;
  /** Written in backticks: never a keyword or a reserved root. */
  quoted: boolean;
}

export type Token =
  | { kind: "num"; value: number; span: Span }
  | { kind: "str"; value: string; span: Span }
  | { kind: "name"; segments: NameSegment[]; span: Span }
  | { kind: "op"; value: string; span: Span }
  | { kind: "kw"; value: "and" | "or" | "not" | "in" | "true" | "false" | "null"; span: Span }
  | { kind: "eof"; span: Span };

const KEYWORDS: Record<string, "and" | "or" | "not" | "in" | "true" | "false" | "null"> = {
  and: "and",
  or: "or",
  not: "not",
  in: "in",
  true: "true",
  false: "false",
  null: "null",
  True: "true",
  False: "false",
  None: "null",
};

const OPS3 = ["**"] as const;
const OPS2 = ["==", "!=", "<=", ">="];
const OPS1 = "()[],+-*/%<>";

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isIdentStart = (c: string | undefined) =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_");
const isIdentChar = (c: string | undefined) => isIdentStart(c) || isDigit(c);

const NUM_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;

  const quotedName = (start: number): [string, number] => {
    // src[start] === "`"; a doubled backtick is a literal one.
    let j = start + 1;
    let text = "";
    for (;;) {
      if (j >= n) throw new ExprError("unterminated quoted name", { start, end: n });
      const c = src[j]!;
      if (c === "`") {
        if (src[j + 1] === "`") {
          text += "`";
          j += 2;
          continue;
        }
        j += 1;
        break;
      }
      text += c;
      j += 1;
    }
    if (text === "") throw new ExprError("empty quoted name", { start, end: j });
    return [text, j];
  };

  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    const start = i;
    // Numbers
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src)!;
      i += m[0].length;
      if (isIdentChar(src[i]) || src[i] === ".") {
        let j = i;
        while (isIdentChar(src[j]) || src[j] === ".") j += 1;
        throw new ExprError(`invalid number '${src.slice(start, j)}'`, { start, end: j });
      }
      out.push({ kind: "num", value: Number(m[0]), span: { start, end: i } });
      continue;
    }
    // Strings
    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= n) throw new ExprError("unterminated string", { start, end: n });
        const d = src[j]!;
        if (d === c) {
          j += 1;
          break;
        }
        if (d === "\\" && j + 1 < n) {
          const e = src[j + 1]!;
          text += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" || e === "'" || e === '"' ? e : "\\" + e;
          j += 2;
          continue;
        }
        text += d;
        j += 1;
      }
      out.push({ kind: "str", value: text, span: { start, end: j } });
      i = j;
      continue;
    }
    // Names: seg ('.' seg)*
    if (isIdentStart(c) || c === "`") {
      const segments: NameSegment[] = [];
      let first = true;
      for (;;) {
        const d = src[i];
        if (d === "`") {
          const [text, j] = quotedName(i);
          segments.push({ text, quoted: true });
          i = j;
        } else if (first ? isIdentStart(d) : isIdentChar(d)) {
          let j = i;
          while (isIdentChar(src[j])) j += 1;
          segments.push({ text: src.slice(i, j), quoted: false });
          i = j;
        } else {
          throw new ExprError("expected a name after '.'", { start: i - 1, end: i });
        }
        first = false;
        if (src[i] === ".") {
          i += 1;
          continue;
        }
        break;
      }
      const span = { start, end: i };
      const only = segments.length === 1 && !segments[0]!.quoted ? segments[0]!.text : null;
      if (only !== null && Object.prototype.hasOwnProperty.call(KEYWORDS, only)) {
        out.push({ kind: "kw", value: KEYWORDS[only]!, span });
      } else {
        out.push({ kind: "name", segments, span });
      }
      continue;
    }
    // Operators
    const two = src.slice(i, i + 2);
    if ((OPS3 as readonly string[]).includes(two) || OPS2.includes(two)) {
      out.push({ kind: "op", value: two, span: { start, end: i + 2 } });
      i += 2;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ kind: "op", value: c, span: { start, end: i + 1 } });
      i += 1;
      continue;
    }
    if (two === "&&") throw new ExprError("unexpected '&&'; use 'and'", { start, end: i + 2 });
    if (two === "||") throw new ExprError("unexpected '||'; use 'or'", { start, end: i + 2 });
    if (c === "=") throw new ExprError("unexpected '='; use '==' to compare", { start, end: i + 1 });
    if (c === "!") throw new ExprError("unexpected '!'; use 'not' or '!='", { start, end: i + 1 });
    const cp = src.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    throw new ExprError(`unexpected character '${ch}'`, { start, end: i + ch.length });
  }
  out.push({ kind: "eof", span: { start: n, end: n } });
  return out;
}
