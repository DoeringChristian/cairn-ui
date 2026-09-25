/**
 * Text diffs of table cells (the `diff` package), and which reference cell
 * each cell of a compared table is diffed against. Pure.
 */

import { diffChars, diffLines, diffWordsWithSpace } from "diff";
import { detectKeyColumn } from "../table-diff.ts";
import { cellText, type TableData } from "./types.ts";

export type TextDiffMode = "chars" | "words" | "lines";
export const TEXT_DIFF_MODES: readonly TextDiffMode[] = ["words", "chars", "lines"];

/** One run of a diff: unchanged, added (only in `b`) or removed (only in `a`). */
export interface DiffPart {
  value: string;
  op: "same" | "add" | "del";
}

/** Diff the text of cell `a` (reference) against cell `b`. Media cells compare by hash. */
export function diffCell(a: unknown, b: unknown, mode: TextDiffMode = "words"): DiffPart[] {
  const ta = cellText(a);
  const tb = cellText(b);
  if (ta === tb) return ta ? [{ value: ta, op: "same" }] : [];
  const changes =
    mode === "chars" ? diffChars(ta, tb) : mode === "lines" ? diffLines(ta, tb) : diffWordsWithSpace(ta, tb);
  const out: DiffPart[] = [];
  for (const c of changes) {
    if (!c.value) continue;
    const op: DiffPart["op"] = c.added ? "add" : c.removed ? "del" : "same";
    const last = out[out.length - 1];
    if (last && last.op === op) last.value += c.value;
    else out.push({ value: c.value, op });
  }
  return out;
}

/** Whether a cell is diffed as text: a string (numbers get the red/green diff, media is shown as media). */
export function isTextCell(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * For each cell of `table`, the aligned cell of `ref` (undefined where none):
 * rows by the shared id-like key column (see `detectKeyColumn`), else by
 * position; columns by name. `[row][col]` in `table`'s order.
 */
export function alignReference(ref: TableData, table: TableData): Array<Array<unknown>> {
  const key = detectKeyColumn([ref, table]);
  const refRow = new Map<string, number>();
  if (key !== null) {
    ref.data.forEach((row, i) => {
      const t = cellText(row[key]);
      if (!refRow.has(t)) refRow.set(t, i);
    });
  }
  const colMap = table.columns.map((c) => ref.columns.findIndex((rc) => rc.name === c.name));
  return table.data.map((row, i) => {
    const ri = key === null ? (i < ref.data.length ? i : -1) : (refRow.get(cellText(row[key])) ?? -1);
    const r = ri < 0 ? undefined : ref.data[ri];
    return colMap.map((ci) => (r === undefined || ci < 0 ? undefined : r[ci]));
  });
}
