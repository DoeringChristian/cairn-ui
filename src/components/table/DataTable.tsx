import { useMemo, useState } from "react";
import { diffCellClassName, type CellComparison } from "../../lib/table-diff";
import { formatNum } from "../../lib/plot-utils/format";
import { mediaOf } from "../../lib/table-media";
import { cellText, type TableData } from "../../lib/table/types";
import { isTextCell, type TextDiffMode } from "../../lib/table/text-diff";
import { nextSort, pageOf, pageSizeOptions, sortRows, visibleColumns, type TableSort } from "../../lib/table/view";
import MediaCellView from "./MediaCellView";
import TextDiffCell from "./TextDiffCell";

interface Props {
  table: TableData;
  rowsPerPage: number;
  /** A new page size from the footer; none: no page size picker. */
  onRowsPerPageChange?: (n: number) => void;
  hiddenColumns: string[];
  /** Column display order (see lib/table/view.ts `orderedColumns`). */
  columnOrder?: string[];
  /** The sort (by a header click); `onSortChange` makes it the card's, else it is local. */
  sort?: TableSort;
  onSortChange?: (sort: TableSort) => void;
  /** A column naming each row's run: its cells get the run's colour dot. */
  runColumn?: { name: string; colors: ReadonlyMap<string, string> };
  /** [rowIdx][colIdx] status, same row/col order as `table`. No diff coloring when omitted. */
  diffStatuses?: CellComparison[][];
  invertDiff?: boolean;
  /**
   * [rowIdx][colIdx] reference value per cell: a text cell that differs from
   * its (text) reference shows a diff against it. None when omitted.
   */
  textRefs?: unknown[][];
  textDiffMode?: TextDiffMode;
}

/** Displayed text: non-integer numbers are shortened; integers stay exact. */
function cellDisplay(v: unknown): string {
  if (typeof v === "number" && !Number.isInteger(v)) return formatNum(v);
  return cellText(v);
}

/**
 * Display of one (already processed) table: sortable, paginated, with a
 * sticky header. Filtering and every other operation happen upstream
 * (lib/table/pipeline.ts, `QueryBar`); the sort is the card's (or local), the page local.
 */
export default function DataTable({
  table,
  rowsPerPage,
  onRowsPerPageChange,
  hiddenColumns,
  columnOrder,
  sort: sortProp,
  onSortChange,
  runColumn,
  diffStatuses,
  invertDiff = false,
  textRefs,
  textDiffMode = "words",
}: Props) {
  const [localSort, setLocalSort] = useState<TableSort>(null);
  const sort = onSortChange ? (sortProp ?? null) : localSort;
  const setSort = onSortChange ?? setLocalSort;
  const [page, setPage] = useState(0);

  const columns = table.columns ?? [];
  const rows = table.data ?? [];

  const visibleCols = useMemo(
    () => visibleColumns(table, columnOrder ?? [], hiddenColumns),
    [table, columnOrder, hiddenColumns],
  );

  // Original row indices travel through sort/page so diff colors (keyed by
  // original index) stay on their row.
  const sorted = useMemo(() => sortRows(table, sort), [table, sort]);

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

  const pg = pageOf(sorted.length, page, rowsPerPage);
  const pageRows = sorted.slice(pg.from, pg.to);
  const runCol = runColumn ? columns.findIndex((c) => c.name === runColumn.name) : -1;

  const toggleSort = (column: string) => {
    setSort(nextSort(sort, column));
    setPage(0);
  };

  if (columns.length === 0) {
    return <div className="text-sm text-fg-muted">empty table</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-data-table="">
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
                    const ref = textRefs?.[ri]?.[c];
                    const textDiff = !media && isTextCell(row[c]) && isTextCell(ref) && ref !== row[c];
                    return (
                      <td
                        key={c}
                        title={textDiff ? `${ref}\n→\n${cellText(row[c])}` : cellText(row[c])}
                        className={`${textDiff ? "whitespace-pre-wrap break-words" : "truncate"} border-b border-border px-2 py-1 text-fg ${align} ${status ? diffCellClassName(status, invertDiff) : ""}`}
                      >
                        {c === runCol && runColumn ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: runColumn.colors.get(cellText(row[c])) }} />
                            <span className="truncate">{cellText(row[c])}</span>
                          </span>
                        ) : media ? (
                          <MediaCellView media={media} />
                        ) : textDiff ? (
                          <TextDiffCell before={ref} after={row[c]} mode={textDiffMode} />
                        ) : (
                          cellDisplay(row[c])
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="px-2 py-3 text-center text-fg-muted">no rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {table.truncated && (
        <div className="mono mt-1 text-[10px] text-fg-subtle">table truncated to first 10,000 rows at log time</div>
      )}

      <div className="mono mt-1.5 flex items-center justify-end gap-2 text-[11px] text-fg-muted" data-table-pager>
        {onRowsPerPageChange && (
          <label className="inline-flex items-center gap-1">
            <span>Rows</span>
            <select
              aria-label="Rows per page"
              className="input py-0 text-[11px]"
              value={rowsPerPage}
              onChange={(e) => {
                onRowsPerPageChange(Number(e.target.value));
                setPage(0);
              }}
            >
              {pageSizeOptions(rowsPerPage).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <span className="tabular-nums">{pg.label}</span>
        <button
          type="button"
          aria-label="Previous page"
          className="rounded px-1.5 py-0.5 hover:bg-bg-hover disabled:opacity-40"
          disabled={pg.page <= 0}
          onClick={() => setPage(pg.page - 1)}
        >
          <i className="fa-solid fa-chevron-left text-[9px]" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          className="rounded px-1.5 py-0.5 hover:bg-bg-hover disabled:opacity-40"
          disabled={pg.page >= pg.pages - 1}
          onClick={() => setPage(pg.page + 1)}
        >
          <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
