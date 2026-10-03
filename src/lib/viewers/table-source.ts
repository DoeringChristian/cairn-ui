/**
 * Text formats as a `TableData` (the table card's shape), so a CSV file, a
 * JSON list of records or JSON Lines show in the same table as a logged
 * `cairn.Table`; and what a JSON document can also be shown as. Pure.
 */

import { inferColumnType, type TableData } from "../table/types.ts";

/**
 * RFC 4180 CSV: quoted fields (with `""` escapes and embedded newlines),
 * CRLF or LF. At most `maxRows` rows; `truncated` when there were more (or
 * the text ended mid-row because it was cut).
 */
export function parseCsv(
  text: string,
  { delimiter = ",", maxRows = 500 }: { delimiter?: string; maxRows?: number } = {},
): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i += 1;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    } else field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
  return { rows, truncated: quoted };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A CSV field as a typed value: "" is null, numbers and true/false are parsed, the rest stays text. */
export function csvValue(field: string): string | number | boolean | null {
  const s = field.trim();
  if (s === "") return null;
  if (NUMBER.test(s)) return Number(s);
  if (/^(nan|inf|-inf|\+inf)$/i.test(s)) return s.toLowerCase() === "nan" ? NaN : s.startsWith("-") ? -Infinity : Infinity;
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  return field;
}

/**
 * CSV text as a table: the first row names the columns, the rest are typed
 * per field (`csvValue`). A cut text (`cut`) drops its partial last line.
 * `truncated` when rows were left out (more than `maxRows`, or cut).
 */
export function csvToTable(
  text: string,
  { delimiter = ",", maxRows = 10_000, cut = false }: { delimiter?: string; maxRows?: number; cut?: boolean } = {},
): TableData {
  const usable = cut ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
  const { rows, truncated } = parseCsv(usable, { delimiter, maxRows: maxRows + 1 });
  const [head = [], ...body] = rows;
  const width = Math.max(head.length, ...body.map((r) => r.length));
  const names = uniqueNames(Array.from({ length: width }, (_, i) => head[i] ?? ""));
  const data = body.map((r) => names.map((_, i) => csvValue(r[i] ?? "")));
  return {
    columns: names.map((name, i) => ({ name, type: inferColumnType(data.map((r) => r[i])) })),
    data,
    truncated: truncated || cut,
  };
}

/** Header names made unique and non-empty (`col_3`, `a`, `a_2`). */
function uniqueNames(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((n, i) => {
    const base = n.trim() || `col_${i + 1}`;
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return k === 0 ? base : `${base}_${k + 1}`;
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A list of plain objects (JSON records), each one row. Null when `value` is not one. */
export function recordsToTable(value: unknown, { maxRows = 10_000 }: { maxRows?: number } = {}): TableData | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord)) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const r of value) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        names.push(k);
      }
    }
  }
  const rows = value.slice(0, maxRows);
  const data = rows.map((r) => names.map((k) => (k in r ? r[k] : null)));
  return {
    columns: names.map((name, i) => ({ name, type: inferColumnType(data.map((row) => row[i])) })),
    data,
    truncated: value.length > maxRows,
  };
}

/** JSON Lines (one record per line) as a table; null when a line is not a JSON object. */
export function jsonlToTable(text: string, { cut = false, maxRows = 10_000 }: { cut?: boolean; maxRows?: number } = {}): TableData | null {
  const lines = (cut ? text.slice(0, text.lastIndexOf("\n") + 1) : text).split(/\r?\n/).filter((l) => l.trim() !== "");
  const records: unknown[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  const table = recordsToTable(records, { maxRows });
  return table && { ...table, truncated: table.truncated || cut };
}

/** Is `value` a Plotly figure (`{data: [traces], layout?}`)? */
export function isPlotlyFigure(value: unknown): value is { data: unknown[]; layout?: unknown } {
  if (!isRecord(value) || !Array.isArray(value.data)) return false;
  if (value.layout !== undefined && !isRecord(value.layout)) return false;
  return value.data.length > 0 && value.data.every((t) => isRecord(t) && (typeof t.type === "string" || "x" in t || "y" in t || "z" in t || "values" in t));
}

/** Pretty JSON, or null when `text` is not JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
