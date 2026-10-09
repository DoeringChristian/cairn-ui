import { useRef, useState } from "react";
import Popover from "../ui/Popover";
import { moveColumn, orderedColumns } from "../../lib/table/view";

const BTN =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border bg-bg px-2 text-[11px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40";
const ARROW =
  "inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:opacity-30";

/** wandb's "Columns…": show / hide and reorder the table's columns. */
export default function ColumnsPicker({
  names,
  hidden,
  order,
  onChange,
  disabled,
}: {
  /** The table's columns as logged (after the card's operations). */
  names: string[];
  hidden: string[];
  order: string[];
  onChange: (patch: { hiddenColumns?: string[]; columnOrder?: string[] }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const shown = orderedColumns(names, order);
  const hide = new Set(hidden);
  const hiddenHere = shown.filter((n) => hide.has(n)).length;
  const toggle = (n: string) =>
    onChange({ hiddenColumns: hide.has(n) ? hidden.filter((h) => h !== n) : [...hidden, n] });
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={BTN}
        disabled={disabled || names.length === 0}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show, hide and reorder columns"
      >
        <i className="fa-solid fa-table-columns text-[10px]" aria-hidden="true" />
        Columns{hiddenHere > 0 ? ` (${shown.length - hiddenHere}/${shown.length})` : ""}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} title="Columns" width={240} align="end" bodyClassName="p-2">
        <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
          <span>Columns</span>
          <span className="flex gap-2">
            <button type="button" className="hover:text-fg" onClick={() => onChange({ hiddenColumns: hidden.filter((h) => !names.includes(h)) })}>
              Show all
            </button>
            <button type="button" className="hover:text-fg" onClick={() => onChange({ hiddenColumns: [...new Set([...hidden, ...names])] })}>
              Hide all
            </button>
          </span>
        </div>
        <ul className="flex flex-col" data-columns-picker>
          {shown.map((n, i) => (
            <li key={n} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-hover">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!hide.has(n)} onChange={() => toggle(n)} />
                <span className="mono truncate" title={n}>{n}</span>
              </label>
              <button type="button" className={ARROW} aria-label={`Move ${n} up`} disabled={i === 0}
                onClick={() => onChange({ columnOrder: moveColumn(names, order, n, -1) })}>
                <i className="fa-solid fa-arrow-up text-[9px]" aria-hidden="true" />
              </button>
              <button type="button" className={ARROW} aria-label={`Move ${n} down`} disabled={i === shown.length - 1}
                onClick={() => onChange({ columnOrder: moveColumn(names, order, n, 1) })}>
                <i className="fa-solid fa-arrow-down text-[9px]" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
