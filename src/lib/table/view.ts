/**
 * How the table card shows a (processed) table: its sort, which columns in
 * what order, the page, and the CSV of what is shown (wandb's table panel:
 * sort by a header, Columns… show/hide/reorder, "1–5 of 5" paging, Export as
 * CSV). Pure: runs under `node --test`.
 */

import { cellText, type TableData } from "./types.ts";

export type TableSort = { column: string; direction: "asc" | "desc" } | null;

/** The next sort after clicking `column`'s header: ascending, descending, off. */
export function nextSort(sort: TableSort, column: string): TableSort {
  if (!sort || sort.column !== column) return { column, direction: "asc" };
  return sort.direction === "asc" ? { column, direction: "desc" } : null;
}

/**
 * The table's row indices in display order. Numbers compare numerically,
 * everything else as text (natural order, case-insensitive); nulls last in
 * either direction; ties keep the logged order. An unknown column: as logged.
 */
export function sortRows(table: TableData, sort: TableSort): number[] {
  const all = table.data.map((_, i) => i);
  if (!sort) return all;
  const col = table.columns.findIndex((c) => c.name === sort.column);
  if (col < 0) return all;
  const numeric = table.columns[col]!.type === "number";
  const factor = sort.direction === "asc" ? 1 : -1;
  return all.sort((ia, ib) => {
    const a = table.data[ia]![col];
    const b = table.data[ib]![col];
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return ia - ib;
    if (aNull) return 1;
    if (bNull) return -1;
    const d = numeric
      ? Number(a) - Number(b)
      : cellText(a).localeCompare(cellText(b), undefined, { sensitivity: "base", numeric: true });
    return d !== 0 ? d * factor : ia - ib;
  });
}

/**
 * Every column name in display order: those named in `order` first (in that
 * order), then the rest as logged. Names in `order` the table lacks are skipped.
 */
export function orderedColumns(names: readonly string[], order: readonly string[]): string[] {
  const have = new Set(names);
  const head = order.filter((n, i) => have.has(n) && order.indexOf(n) === i);
  const listed = new Set(head);
  return [...head, ...names.filter((n) => !listed.has(n))];
}

/** The indices of the shown columns, in display order (hidden ones left out). */
export function visibleColumns(table: TableData, order: readonly string[], hidden: readonly string[]): number[] {
  const names = table.columns.map((c) => c.name);
  const hide = new Set(hidden);
  return orderedColumns(names, order)
    .filter((n) => !hide.has(n))
    .map((n) => names.indexOf(n));
}

/** The column order after moving `name` by `delta` places among `names` (displayed order). */
export function moveColumn(names: readonly string[], order: readonly string[], name: string, delta: number): string[] {
  const cur = orderedColumns(names, order);
  const i = cur.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  const out = [...cur];
  out.splice(i, 1);
  out.splice(j, 0, name);
  return out;
}

/** One page of `total` rows: its 0-based row range, the clamped page, the page count, and the "1–5 of 5" label. */
export function pageOf(total: number, page: number, perPage: number): { from: number; to: number; page: number; pages: number; label: string } {
  const per = Math.max(1, Math.floor(perPage));
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const from = p * per;
  const to = Math.min(total, from + per);
  return { from, to, page: p, pages, label: total === 0 ? "0 of 0" : `${from + 1}–${to} of ${total}` };
}

/** Page sizes offered in the footer (plus the current one when it is none of them). */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

export function pageSizeOptions(current: number): number[] {
  return [...new Set([...PAGE_SIZES, current])].sort((a, b) => a - b);
}

/**
 * What the CSV export writes: the shown columns (display order) and every
 * row in display order (all pages). Numbers stay numbers; other cells are
 * their text (a media cell is its hash).
 */
export function shownCsv(
  table: TableData,
  rows: readonly number[],
  cols: readonly number[],
): { header: string[]; rows: Array<Array<string | number>> } {
  return {
    header: cols.map((c) => table.columns[c]!.name),
    rows: rows.map((r) => cols.map((c) => {
      const v = table.data[r]![c];
      return typeof v === "number" ? v : cellText(v);
    })),
  };
}
