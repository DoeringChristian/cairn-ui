/**
 * Source-snapshot diffing: merge two runs' file trees, and turn one file's
 * two versions into display rows (unified or side by side) with unchanged
 * stretches collapsed to `context` lines around each change.
 *
 * Pure; used by the code-diff card and the comparison's Source tab
 * (components/code-diff/*).
 */

import { diffLines } from "diff";
import type { SourceFileResponse } from "../api/types.ts";

// ---------------------------------------------------------------------------
// Trees

export type FileStatus = "modified" | "added" | "removed" | "unchanged";

/** One manifest entry (`GET /api/runs/{id}/source/tree` → `files[]`). */
export interface TreeFile {
  path: string;
  sha256: string;
  size?: number;
}

export interface MergedFile {
  path: string;
  status: FileStatus;
  leftSha?: string;
  rightSha?: string;
}

/**
 * Every path of either tree, sorted, with its status going left → right:
 * `added` exists only on the right, `removed` only on the left, `modified`
 * on both with different content hashes.
 */
export function mergeTrees(left: readonly TreeFile[], right: readonly TreeFile[]): MergedFile[] {
  const l = new Map(left.map((f) => [f.path, f.sha256]));
  const r = new Map(right.map((f) => [f.path, f.sha256]));
  const paths = Array.from(new Set([...l.keys(), ...r.keys()])).sort();
  return paths.map((path) => {
    const ls = l.get(path);
    const rs = r.get(path);
    const status: FileStatus =
      ls != null && rs != null ? (ls === rs ? "unchanged" : "modified") : ls != null ? "removed" : "added";
    return { path, status, leftSha: ls, rightSha: rs };
  });
}

// ---------------------------------------------------------------------------
// File contents

/** A binary file (the source route returned it base64-encoded). */
export interface BinaryFile {
  binary: true;
}
export const BINARY: BinaryFile = { binary: true };

/** One side of a file diff: its text, `null` when the file is absent on that side, or binary. */
export type FileText = string | null | BinaryFile;

/** A `/source/file` response as a diff side (`null` when absent). */
export function fileText(resp: SourceFileResponse | null | undefined): FileText {
  if (!resp) return null;
  return resp.encoding === "utf-8" ? resp.content : BINARY;
}

function isBinary(t: FileText): t is BinaryFile {
  return t != null && typeof t === "object";
}

// ---------------------------------------------------------------------------
// Rows

export type LineOp = "context" | "add" | "del";

/** One line of the diff; `aLine`/`bLine` are 1-based, `null` on the side it is missing from. */
export interface DiffLine {
  op: LineOp;
  aLine: number | null;
  bLine: number | null;
  text: string;
}

/** `count` unchanged lines collapsed away, starting at `aStart`/`bStart` (1-based). */
export interface SkipRow {
  kind: "skip";
  count: number;
  aStart: number;
  bStart: number;
}

export type UnifiedRow = ({ kind: "line" } & DiffLine) | SkipRow;

export interface SplitCell {
  line: number;
  text: string;
  op: LineOp;
}

/** A side-by-side row: a removed line pairs with an added one; `null` pads the shorter side. */
export type SplitRow = { kind: "pair"; left: SplitCell | null; right: SplitCell | null } | SkipRow;

export interface DiffResult<R> {
  /** Either side is binary: no rows. */
  binary: boolean;
  rows: R[];
  added: number;
  removed: number;
}

function splitLines(value: string): string[] {
  return value.replace(/\n$/, "").split("\n");
}

/** Every line of `a` → `b` in order, with line numbers. */
export function diffLineOps(a: string, b: string): DiffLine[] {
  const out: DiffLine[] = [];
  let aLine = 1;
  let bLine = 1;
  for (const part of diffLines(a, b)) {
    if (part.value === "") continue;
    for (const text of splitLines(part.value)) {
      if (part.added) out.push({ op: "add", aLine: null, bLine: bLine++, text });
      else if (part.removed) out.push({ op: "del", aLine: aLine++, bLine: null, text });
      else out.push({ op: "context", aLine: aLine++, bLine: bLine++, text });
    }
  }
  return out;
}

type Block = { kind: "lines"; lines: DiffLine[] } | SkipRow;

/**
 * Keep every change plus `context` unchanged lines on each side of it; each
 * other stretch of unchanged lines becomes one skip. A stretch of a single
 * line is kept (its marker would take the same room). `context` of
 * `Infinity` (or negative) keeps the whole file.
 */
function collapse(lines: DiffLine[], context: number): Block[] {
  const n = lines.length;
  const keep = new Array<boolean>(n).fill(false);
  if (context < 0 || !Number.isFinite(context)) keep.fill(true);
  else {
    const ctx = Math.floor(context);
    for (let i = 0; i < n; i++) {
      if (lines[i]!.op === "context") continue;
      for (let j = Math.max(0, i - ctx); j <= Math.min(n - 1, i + ctx); j++) keep[j] = true;
    }
  }
  const blocks: Block[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && keep[j] === keep[i]) j++;
    const run = lines.slice(i, j);
    if (keep[i] || run.length === 1) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "lines") last.lines.push(...run);
      else blocks.push({ kind: "lines", lines: run });
    } else {
      blocks.push({ kind: "skip", count: run.length, aStart: run[0]!.aLine!, bStart: run[0]!.bLine! });
    }
    i = j;
  }
  return blocks;
}

function prepare(a: FileText, b: FileText, context: number): { blocks: Block[]; added: number; removed: number } | null {
  if (isBinary(a) || isBinary(b)) return null;
  const lines = diffLineOps(a ?? "", b ?? "");
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === "add") added++;
    else if (l.op === "del") removed++;
  }
  return { blocks: collapse(lines, context), added, removed };
}

/** One column of `-`/`+`/context lines, collapsed to `context` lines around changes. */
export function toUnifiedRows(a: FileText, b: FileText, context: number): DiffResult<UnifiedRow> {
  const p = prepare(a, b, context);
  if (!p) return { binary: true, rows: [], added: 0, removed: 0 };
  const rows: UnifiedRow[] = [];
  for (const block of p.blocks) {
    if (block.kind === "skip") rows.push(block);
    else for (const l of block.lines) rows.push({ kind: "line", ...l });
  }
  return { binary: false, rows, added: p.added, removed: p.removed };
}

/**
 * Two columns: unchanged lines on both sides; within each run of changes the
 * i-th removed line sits beside the i-th added line.
 */
export function toSplitRows(a: FileText, b: FileText, context: number): DiffResult<SplitRow> {
  const p = prepare(a, b, context);
  if (!p) return { binary: true, rows: [], added: 0, removed: 0 };
  const rows: SplitRow[] = [];
  for (const block of p.blocks) {
    if (block.kind === "skip") {
      rows.push(block);
      continue;
    }
    const { lines } = block;
    let i = 0;
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.op === "context") {
        rows.push({
          kind: "pair",
          left: { line: l.aLine!, text: l.text, op: "context" },
          right: { line: l.bLine!, text: l.text, op: "context" },
        });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i]!.op !== "context") {
        const c = lines[i]!;
        (c.op === "del" ? dels : adds).push(c);
        i++;
      }
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k];
        const ad = adds[k];
        rows.push({
          kind: "pair",
          left: d ? { line: d.aLine!, text: d.text, op: "del" } : null,
          right: ad ? { line: ad.bLine!, text: ad.text, op: "add" } : null,
        });
      }
    }
  }
  return { binary: false, rows, added: p.added, removed: p.removed };
}
