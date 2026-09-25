import type { ReactNode } from "react";
import { useCompactLayout } from "../../lib/use-media-query";
import { formatKeyValue } from "../../lib/media/slider-key";
import { galleryColumns, setLinked, slotValue, type Columns, type CompareSlot } from "../../lib/media/panel-layout";

export interface ComparePaneOption {
  key: string;
  label: string;
  color?: string;
}

interface Props {
  /** Normalized slots (see `normalizeSlots`). */
  slots: readonly CompareSlot[];
  onSlotsChange: (slots: CompareSlot[]) => void;
  /** Linked: every slot follows the card's slider; else each keeps its own value. */
  linked: boolean;
  onLinkedChange: (linked: boolean, slots: CompareSlot[]) => void;
  /** Every pane (series) a slot can show. */
  panes: readonly ComparePaneOption[];
  /** Slider positions, for each slot's own value picker. */
  values: readonly number[];
  keyName: string;
  /** The card slider's value. */
  current: number;
  columns?: Columns;
  renderSlot: (slot: CompareSlot, value: number, index: number) => ReactNode;
  disabled?: boolean;
}

const PICKER = "input mono min-w-0 truncate py-0 text-[11px] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The media compare mode: 2–4 slots side by side, each with its own run
 * (series) and — unless linked to the card's slider — its own step or key
 * value. Unlinking freezes each slot where it was.
 */
export default function ComparePanes({
  slots,
  onSlotsChange,
  linked,
  onLinkedChange,
  panes,
  values,
  keyName,
  current,
  columns = "auto",
  renderSlot,
  disabled,
}: Props) {
  const compact = useCompactLayout();
  const cols = galleryColumns(columns === "auto" ? slots.length : columns, slots.length, compact);
  const byKey = new Map(panes.map((p) => [p.key, p]));
  const patch = (i: number, next: CompareSlot) => onSlotsChange(slots.map((s, j) => (j === i ? next : s)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={linked}
          onClick={() => onLinkedChange(!linked, setLinked(slots, !linked, current))}
          title={linked ? "Slots follow the slider — click to pick a value per slot" : "Each slot keeps its own value — click to follow the slider"}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-bg-hover disabled:cursor-not-allowed ${linked ? "text-accent" : "text-fg-muted"}`}
        >
          <i className={`fa-solid ${linked ? "fa-link" : "fa-link-slash"}`} aria-hidden="true" />
          {linked ? "Linked" : "Individual"}
        </button>
      </div>
      <div
        className="grid min-h-0 flex-1 gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(160px, 1fr)" }}
      >
        {slots.map((slot, i) => {
          const value = slotValue(slot, linked, current);
          const pane = byKey.get(slot.pane);
          return (
            <div key={i} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-border-subtle">
              <div className="flex items-center gap-1 border-b border-border-subtle bg-bg-elevated px-1 py-0.5">
                {pane?.color && (
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: pane.color }} />
                )}
                <select
                  aria-label={`Slot ${i + 1} run`}
                  className={`${PICKER} flex-1`}
                  value={slot.pane}
                  disabled={disabled || panes.length < 2}
                  onChange={(e) => patch(i, { ...slot, pane: e.target.value })}
                >
                  {panes.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
                <select
                  aria-label={`Slot ${i + 1} ${keyName}`}
                  className={`${PICKER} w-24 shrink-0`}
                  value={String(value)}
                  disabled={disabled || linked || values.length < 2}
                  onChange={(e) => patch(i, { pane: slot.pane, value: Number(e.target.value) })}
                >
                  {!values.includes(value) && <option value={String(value)}>{`${keyName} ${formatKeyValue(value)}`}</option>}
                  {values.map((v) => (
                    <option key={v} value={String(v)}>{`${keyName} ${formatKeyValue(v)}`}</option>
                  ))}
                </select>
              </div>
              <div className="relative min-h-0 flex-1">{renderSlot(slot, value, i)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
