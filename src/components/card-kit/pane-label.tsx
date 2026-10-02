import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

/**
 * A pane's run label: a small chip (colour swatch + short run name) laid
 * over the pane's top-left corner, taking no room of its own. Media that
 * already has a header line (a gallery's caption) takes the chip into that
 * line instead (`usePaneLabelInline`), so the two never overlap.
 */

export interface PaneLabel {
  label: string;
  color?: string;
}

interface PaneLabelSlot extends PaneLabel {
  /** Show the chip inline (in the content's header); returns the release. */
  claim: () => () => void;
}

const PaneLabelContext = createContext<PaneLabelSlot | null>(null);

export function RunChip({ label, color, className = "" }: PaneLabel & { className?: string }) {
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] leading-none text-fg-muted backdrop-blur-sm ${className}`}
      title={label}
      data-run-chip
    >
      {color && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** One pane with its run chip: overlaid on the corner unless the content takes it inline. */
export function LabelledPane({ label, color, children }: { label?: string; color?: string; children: ReactNode }) {
  const [inline, setInline] = useState(0);
  if (!label) return <>{children}</>;
  const slot: PaneLabelSlot = {
    label,
    color,
    claim: () => {
      setInline((n) => n + 1);
      return () => setInline((n) => n - 1);
    },
  };
  return (
    <PaneLabelContext.Provider value={slot}>
      {children}
      {inline === 0 && <RunChip label={label} color={color} className="pointer-events-none absolute left-1 top-1 z-10" />}
    </PaneLabelContext.Provider>
  );
}

/**
 * The pane's run label, for content that shows it in its own header line
 * (`active`: the header exists); the corner chip steps aside meanwhile.
 * Null outside a labelled pane.
 */
export function usePaneLabelInline(active: boolean): PaneLabel | null {
  const slot = useContext(PaneLabelContext);
  const claim = slot?.claim;
  // Before paint: the corner chip never flashes over the header.
  useLayoutEffect(() => (active && claim ? claim() : undefined), [active, !!claim]); // eslint-disable-line react-hooks/exhaustive-deps
  return active && slot ? { label: slot.label, color: slot.color } : null;
}

/** Item caption chip over a media item's top-right corner (the run chip owns top-left). */
export function ItemCaption({ text }: { text: string }) {
  return (
    <span
      className="absolute right-1 top-1 z-10 max-w-[calc(100%-0.5rem)] truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] leading-none text-fg backdrop-blur-sm transition-opacity group-hover/item:opacity-40 hover:!opacity-100"
      title={text}
      data-item-caption
    >
      {text}
    </span>
  );
}
