import { useMemo, useState } from "react";
import { diffCellClassName, type CellComparison } from "../../lib/table-diff";
import { formatNum } from "../../lib/plot-utils/types";
import { mediaOf } from "../../lib/table-media";
import MediaCellView from "./MediaCellView";

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

interface Props {
  table: TableData;
  rowsPerPage: number;
  hiddenColumns: string[];
  /** [rowIdx][colIdx] status, same row/col order as `table`. No diff coloring when omitted. */
  diffStatuses?: CellComparison[][];
  invertDiff?: boolean;
}

type Sort = { column: string; direction: "asc" | "desc" } | null;

/** Raw text of a cell: what filtering, width hints and the tooltip see. A media cell is its hash. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const media = mediaOf(v);
  if (media) return media.hash;
  return String(v);
}

/** Displayed text: non-integer numbers are shortened; integers stay exact. */
function cellDisplay(v: unknown): string {
  if (typeof v === "number" && !Number.isInteger(v)) return formatNum(v);
  return cellText(v);
}

/**
 * Sortable, filterable, paginated table with a sticky header. Self-contained:
 * sort, filter and page are local state.
 */
export default function DataTable({ table, rowsPerPage, hiddenColumns, diffStatuses, invertDiff = false }: Props) {
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const columns = table.columns ?? [];
  const rows = table.data ?? [];

  const visibleCols = useMemo(
    () => columns.map((_, i) => i).filter((i) => !hiddenColumns.includes(columns[i]!.name)),
    [columns, hiddenColumns],
  );

  // Original row indices travel through filter/sort/page so diff colors
  // (keyed by original index) stay on their row.
  const filtered = useMemo(() => {
    const all = rows.map((_, i) => i);
    const needle = filter.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((i) => visibleCols.some((c) => cellText(rows[i]![c]).toLowerCase().includes(needle)));
  }, [rows, filter, visibleCols]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.findIndex((column) => column.name === sort.column);
    if (col < 0) return filtered;
    const numeric = columns[col]!.type === "number";
    const factor = sort.direction === "asc" ? 1 : -1;
    return filtered.slice().sort((ia, ib) => {
      const a = rows[ia]![col];
      const b = rows[ib]![col];
      // Nulls sort last in either direction.
      const aNull = a === null || a === undefined;
      const bNull = b === null || b === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (numeric) return (Number(a) - Number(b)) * factor;
      return cellText(a).localeCompare(cellText(b), undefined, { sensitivity: "base", numeric: true }) * factor;
    });
  }, [filtered, sort, columns, rows]);

  // `table-layout: fixed` + a <colgroup> give header and body one width per
  // column, so the sticky header never drifts. Widths are hinted from the
  // widest value across the data (not the page) so paging doesn't jitter.
  const colWidths = useMemo(() => {
    const sample = Math.min(rows.length, 500);
    const hints = visibleCols.map((c) => {
      let w = columns[c]!.name.length + 2; // room for the sort arrow
      // A media column is thumbnails, not text: a fixed width, never its hashes.
      if (columns[c]!.type === "media") return Math.max(12, Math.min(40, w));
      for (let r = 0; r < sample; r++) w = Math.max(w, cellDisplay(rows[r]![c]).length);
      return Math.min(40, Math.max(6, w));
    });
    const total = hints.reduce((a, b) => a + b, 0) || 1;
    return hints.map((w) => (w / total) * 100);
  }, [visibleCols, columns, rows]);

  const perPage = Math.max(1, rowsPerPage);
  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * perPage, safePage * perPage + perPage);

  const toggleSort = (column: string) => {
    setSort(!sort || sort.column !== column
      ? { column, direction: "asc" }
      : sort.direction === "asc" ? { column, direction: "desc" } : null);
    setPage(0);
  };

  if (columns.length === 0) {
    return <div className="text-sm text-fg-muted">empty table</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <input
          className="input flex-1"
          type="text"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
        />
        <span className="mono shrink-0 text-xs text-fg-subtle">
          {sorted.length}
          {sorted.length !== rows.length ? `/${rows.length}` : ""} rows
        </span>
      </div>

      {/* A stable scrollbar gutter keeps header and body aligned whether or not a scrollbar shows. */}
      <div className="flex-1 min-h-0 overflow-auto rounded border border-border" style={{ scrollbarGutter: "stable" }}>
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            {visibleCols.map((c, i) => <col key={c} style={{ width: `${colWidths[i]}%` }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-bg-elevated">
            <tr>
              {visibleCols.map((c) => {
                const col = columns[c]!;
                const right = col.type === "number";
                const arrow = sort?.column === col.name ? (sort.direction === "asc" ? "▲" : "▼") : "";
                const arrowEl = <span className={`shrink-0 text-accent ${right ? "mr-0.5" : "ml-0.5"}`}>{arrow}</span>;
                const name = <span className="mono truncate">{col.name}</span>;
                // Numeric columns right-align header and cells alike; the arrow
                // goes left of the name so the name lines up with the numbers.
                return (
                  <th
                    key={c}
                    onClick={() => toggleSort(col.name)}
                    title={col.name}
                    className={`cursor-pointer select-none border-b border-border px-2 py-1 font-semibold text-fg-muted hover:text-fg ${right ? "text-right" : "text-left"}`}
                  >
                    <span className={right ? "flex items-center justify-end" : "flex items-center"}>
                      {right ? <>{arrowEl}{name}</> : <>{name}{arrowEl}</>}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((ri) => {
              const row = rows[ri]!;
              return (
                <tr key={ri} className="odd:bg-bg even:bg-bg-hover/40">
                  {visibleCols.map((c) => {
                    const status = diffStatuses?.[ri]?.[c];
                    const align = columns[c]!.type === "number" ? "mono text-right" : "";
                    const media = mediaOf(row[c]);
                    return (
                      <td
                        key={c}
                        title={cellText(row[c])}
                        className={`truncate border-b border-border px-2 py-1 text-fg ${align} ${status ? diffCellClassName(status, invertDiff) : ""}`}
                      >
                        {media ? <MediaCellView media={media} /> : cellDisplay(row[c])}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="px-2 py-3 text-center text-fg-muted">no matching rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {table.truncated && (
        <div className="mono mt-1 text-[10px] text-fg-subtle">table truncated to first 10,000 rows at log time</div>
      )}

      {pageCount > 1 && (
        <div className="mono mt-2 flex items-center justify-center gap-3 text-xs text-fg-muted">
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-bg-hover disabled:opacity-40"
            disabled={safePage <= 0}
            onClick={() => setPage(safePage - 1)}
          >
            {"← prev"}
          </button>
          <span>{safePage + 1} / {pageCount}</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-bg-hover disabled:opacity-40"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            {"next →"}
          </button>
        </div>
      )}
    </div>
  );
}
