import type { ReactNode } from "react";

export interface GridRow {
  key: string;
  label: string;
  /** Run colour swatch. */
  color?: string;
}

export interface GridColumn {
  value: number;
  label: string;
}

interface Props {
  rows: readonly GridRow[];
  columns: readonly GridColumn[];
  renderCell: (row: number, column: number) => ReactNode;
  /** Row height in px (cells are square-ish thumbnails). */
  rowHeight?: number;
  /** The slider's value: its column is highlighted. */
  current?: number;
  /** Click a column header to move the card's slider there. */
  onColumnClick?: (value: number) => void;
}

/**
 * The media grid mode: runs as rows × slider values as columns, so a glance
 * shows how every run evolves. Scrolls both ways when it doesn't fit; the
 * header row and the run labels stay put.
 */
export default function GridPanes({ rows, columns, renderCell, rowHeight = 140, current, onColumnClick }: Props) {
  if (rows.length === 0 || columns.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle">Nothing logged yet</div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `max-content repeat(${columns.length}, minmax(96px, 1fr))`,
          gridTemplateRows: `auto repeat(${rows.length}, ${rowHeight}px)`,
        }}
      >
        <div className="sticky left-0 top-0 z-20 bg-bg-elevated" />
        {columns.map((c) => {
          const on = c.value === current;
          return (
            <button
              key={c.value}
              type="button"
              disabled={!onColumnClick}
              onClick={() => onColumnClick?.(c.value)}
              className={[
                "mono sticky top-0 z-10 truncate rounded-sm bg-bg-elevated px-1 py-0.5 text-center text-[10px]",
                on ? "text-accent" : "text-fg-muted enabled:hover:text-fg",
              ].join(" ")}
              title={c.label}
            >
              {c.label}
            </button>
          );
        })}
        {rows.map((r, ri) => (
          <GridRowCells key={r.key} row={r} rowIndex={ri} columns={columns} renderCell={renderCell} />
        ))}
      </div>
    </div>
  );
}

function GridRowCells({
  row,
  rowIndex,
  columns,
  renderCell,
}: {
  row: GridRow;
  rowIndex: number;
  columns: readonly GridColumn[];
  renderCell: (row: number, column: number) => ReactNode;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 flex max-w-[9rem] items-center gap-1.5 bg-bg-elevated pr-1 text-[11px] text-fg-muted">
        {row.color && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />}
        <span className="mono truncate" title={row.label}>{row.label}</span>
      </div>
      {columns.map((c, ci) => (
        <div key={c.value} className="relative min-h-0 min-w-0 overflow-hidden rounded-sm bg-bg">
          {renderCell(rowIndex, ci)}
        </div>
      ))}
    </>
  );
}
