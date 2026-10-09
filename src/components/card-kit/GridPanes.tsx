import type { ReactNode } from "react";

export interface GridHeader {
  key: string;
  label: string;
  /** Run colour swatch (a run row or column). */
  color?: string;
  /** Highlighted (the slider's value on a step axis). */
  active?: boolean;
  /** Click the header (a step column moves the card's slider there). */
  onClick?: () => void;
}

interface Props {
  rows: readonly GridHeader[];
  columns: readonly GridHeader[];
  renderCell: (row: number, column: number) => ReactNode;
  /** Row height in px (cells are square-ish thumbnails). */
  rowHeight?: number;
}

/**
 * The media grid mode: two of step · index · run as rows × columns (see
 * lib/media/media-plan.ts `planGrid`), so a glance shows how media evolve.
 * Scrolls both ways when it doesn't fit; the header row and the row labels
 * stay put.
 */
export default function GridPanes({ rows, columns, renderCell, rowHeight = 140 }: Props) {
  if (rows.length === 0 || columns.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle">Nothing logged yet</div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-media-grid>
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `max-content repeat(${columns.length}, minmax(96px, 1fr))`,
          gridTemplateRows: `auto repeat(${rows.length}, ${rowHeight}px)`,
        }}
      >
        <div className="sticky left-0 top-0 z-20 bg-bg-elevated" />
        {columns.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={!c.onClick}
            onClick={c.onClick}
            className={[
              "mono sticky top-0 z-10 inline-flex items-center justify-center gap-1 truncate rounded-sm bg-bg-elevated px-1 py-0.5 text-[10px]",
              c.active ? "text-accent" : "text-fg-muted enabled:hover:text-fg",
            ].join(" ")}
            title={c.label}
          >
            {c.color && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />}
            <span className="truncate">{c.label}</span>
          </button>
        ))}
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
  row: GridHeader;
  rowIndex: number;
  columns: readonly GridHeader[];
  renderCell: (row: number, column: number) => ReactNode;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 flex max-w-[9rem] items-center gap-1.5 bg-bg-elevated pr-1 text-[11px] text-fg-muted">
        {row.color && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />}
        <span className="mono truncate" title={row.label}>{row.label}</span>
      </div>
      {columns.map((c, ci) => (
        <div key={c.key} className="relative min-h-0 min-w-0 overflow-hidden rounded-sm bg-bg">
          {renderCell(rowIndex, ci)}
        </div>
      ))}
    </>
  );
}
