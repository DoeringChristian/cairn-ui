/**
 * The `table` artifact's JSON blob and the text view of its cells. Shared by
 * the table pipeline (`pipeline.ts`, `combine.ts`, `text-diff.ts`) and the
 * display components (`components/table/*`).
 */

import { mediaOf } from "../table-media.ts";

export type ColumnType = "number" | "string" | "bool" | "media" | "other";

export interface TableColumn {
  name: string;
  type: ColumnType;
}

/** The `table` artifact's JSON blob. */
export interface TableData {
  columns: TableColumn[];
  data: unknown[][];
  truncated?: boolean;
}

/** Raw text of a cell: what width hints, the tooltip and text diffs see. A media cell is its hash. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const media = mediaOf(v);
  if (media) return media.hash;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** The column type of a list of values: one kind for every non-null value, else "other". */
export function inferColumnType(values: readonly unknown[]): ColumnType {
  let type: ColumnType | null = null;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const t: ColumnType =
      typeof v === "number" ? "number"
      : typeof v === "string" ? "string"
      : typeof v === "boolean" ? "bool"
      : mediaOf(v) ? "media"
      : "other";
    if (type === null) type = t;
    else if (type !== t) return "other";
  }
  return type ?? "other";
}
