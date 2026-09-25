/**
 * Expression AST, spans, errors and warnings. See `index.ts` for the language.
 *
 * MIRRORED by cairn `cairn/expr.py`; `docs/schemas/expr-vectors.json` pins both.
 */

/** Half-open source range `[start, end)` in UTF-16 code units. */
export interface Span {
  start: number;
  end: number;
}

export const RUN_FIELDS = ["name", "id", "status", "tags", "group", "job_type", "created_at"] as const;
export type RunField = (typeof RUN_FIELDS)[number];

export const AXES = ["step", "wall_time", "relative_time"] as const;
export type Axis = (typeof AXES)[number];

export type ArithOp = "+" | "-" | "*" | "/" | "%" | "**";
export type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not in";

export type Node =
  | { type: "num"; value: number; span: Span }
  | { type: "str"; value: string; span: Span }
  | { type: "bool"; value: boolean; span: Span }
  | { type: "null"; span: Span }
  | { type: "list"; items: Node[]; span: Span }
  /** A metric series of the run (any name that is not a reserved root). */
  | { type: "metric"; name: string; span: Span }
  | { type: "config"; key: string; span: Span }
  | { type: "summary"; key: string; span: Span }
  | { type: "run"; field: RunField; span: Span }
  | { type: "axis"; axis: Axis; span: Span }
  | { type: "unary"; op: "-" | "+" | "not"; operand: Node; span: Span }
  | { type: "binary"; op: ArithOp | "and" | "or"; left: Node; right: Node; span: Span }
  /** A (possibly chained, Python-style) comparison: `a < b <= c`. */
  | { type: "compare"; ops: CmpOp[]; operands: Node[]; span: Span }
  | { type: "call"; fn: string; fnSpan: Span; args: Node[]; span: Span };

/** A parse, type or evaluation error, located in the source. */
export class ExprError extends Error {
  readonly span: Span;
  constructor(message: string, span: Span) {
    super(message);
    this.name = "ExprError";
    this.span = span;
  }
}

/**
 * A non-fatal note from evaluation. `asof-join`: two series with different
 * steps were combined by an as-of join (each left step takes the right
 * operand's last value at a step <= it); the UI shows it as a badge.
 */
export interface ExprWarning {
  kind: "asof-join";
  message: string;
  span: Span;
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The closest candidate within edit distance 2 (ties: first listed), or null. */
export function suggest(name: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const c of candidates) {
    const d = editDistance(name, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function didYouMean(name: string, candidates: readonly string[]): string {
  const s = suggest(name, candidates);
  return s === null ? "" : `; did you mean '${s}'?`;
}
