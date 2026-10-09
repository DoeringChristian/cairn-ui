import type { ReactNode } from "react";
import { useCompactLayout } from "../../lib/use-media-query";
import { formatNum } from "../../lib/plot-utils/format";
import { galleryColumns, type Columns, type CompareSlot } from "../../lib/media/panel-layout";
import type { CompareLinks, TileRef } from "../../lib/media/media-plan";

export interface ComparePaneOption {
  key: string;
  label: string;
  color?: string;
}

interface Props {
  /** Normalized slots (see `normalizeSlots`). */
  slots: readonly CompareSlot[];
  /** What each slot shows (see media-plan.ts `resolveSlot`). */
  tiles: readonly TileRef[];
  onSlotsChange: (slots: CompareSlot[]) => void;
  /** Per variable: linked (card-wide) or individual (a selector in each slot's header). */
  links: CompareLinks;
  /** Every pane (series) a slot can show. */
  panes: readonly ComparePaneOption[];
  /** Slider positions, for each slot's own value picker. */
  values: readonly number[];
  keyName: string;
  /** The card holds lists: the index is a variable. */
  lists: boolean;
  /** Items of the widest list (the index picker's range). */
  listCount: number;
  columns?: Columns;
  renderSlot: (tile: TileRef, index: number) => ReactNode;
  disabled?: boolean;
}

const PICKER = "input mono min-w-0 truncate py-0 text-[11px] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The media compare mode: 2–4 slots side by side. Each of Run, Step and Index
 * is linked (every slot takes the card's) or individual: then each slot's
 * header has its own selector for it.
 */
export default function ComparePanes({
  slots,
  tiles,
  onSlotsChange,
  links,
  panes,
  values,
  keyName,
  lists,
  listCount,
  columns = "auto",
  renderSlot,
  disabled,
}: Props) {
  const compact = useCompactLayout();
  const cols = galleryColumns(columns === "auto" ? slots.length : columns, slots.length, compact);
  const patch = (i: number, next: CompareSlot) => onSlotsChange(slots.map((s, j) => (j === i ? next : s)));
  return (
    <div
      className="grid min-h-0 flex-1 gap-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(160px, 1fr)" }}
      data-media-compare
    >
      {tiles.map((tile, i) => {
        const slot = slots[i]!;
        const pane = panes[tile.run];
        return (
          <div key={i} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-border-subtle">
            <div className="flex items-center gap-1 border-b border-border-subtle bg-bg-elevated px-1 py-0.5">
              {pane?.color && (
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: pane.color }} />
              )}
              {links.compareRun === "individual" ? (
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
              ) : (
                <span className="mono min-w-0 flex-1 truncate text-[11px] text-fg-muted">{pane?.label}</span>
              )}
              {links.compareStep === "individual" && (
                <select
                  aria-label={`Slot ${i + 1} ${keyName}`}
                  className={`${PICKER} w-24 shrink-0`}
                  value={String(tile.value)}
                  disabled={disabled || values.length < 2}
                  onChange={(e) => patch(i, { ...slot, value: Number(e.target.value) })}
                >
                  {!values.includes(tile.value) && <option value={String(tile.value)}>{`${keyName} ${formatNum(tile.value)}`}</option>}
                  {values.map((v) => (
                    <option key={v} value={String(v)}>{`${keyName} ${formatNum(v)}`}</option>
                  ))}
                </select>
              )}
              {lists && links.compareIndex === "individual" && (
                <select
                  aria-label={`Slot ${i + 1} index`}
                  className={`${PICKER} w-20 shrink-0`}
                  value={String(slot.index ?? 0)}
                  disabled={disabled || listCount < 2}
                  onChange={(e) => patch(i, { ...slot, index: Number(e.target.value) })}
                >
                  {Array.from({ length: Math.max(listCount, (slot.index ?? 0) + 1) }, (_, k) => (
                    <option key={k} value={String(k)}>{`Index ${k}`}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="relative min-h-0 flex-1">{renderSlot(tile, i)}</div>
          </div>
        );
      })}
    </div>
  );
}
