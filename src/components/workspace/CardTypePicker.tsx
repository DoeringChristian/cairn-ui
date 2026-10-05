/**
 * The one card type picker of a workspace card (the card editor's "Card
 * type", while adding and in the gear alike), in two halves that pick the
 * same way:
 *
 * - `CardTypePicker` (the editor's column): every type that can show the
 *   data — custom viewers included — with its icon and hint, and why one
 *   cannot be picked now (too few runs, too many series);
 * - `CardTypeTiles` (the modal's left side, while choosing): each pickable
 *   type as a live card of the data.
 *
 * Hovering or focusing an entry in one highlights it in the other; clicking
 * either picks it.
 */

import { useMemo, type ReactNode } from "react";
import CardPreview from "./CardPreview";
import { newCards, type CardData, type NewCard, type TypeOption } from "../../lib/workspace/card-builder";
import type { MetricInfo } from "../../lib/workspace/layout";

interface Pick {
  options: TypeOption[];
  /** The edited card's option (marked; picking it again changes nothing). */
  current?: string | null;
  focus: string | null;
  onFocus: (key: string) => void;
  onPick: (key: string) => void;
  busy?: boolean;
}

export default function CardTypePicker({ options, reason, current, focus, onFocus, onPick, busy }: Pick & { reason: string | null }) {
  return (
    <div data-testid="card-type-picker">
      {reason && <p className="mb-2 text-sm text-fg-muted">{reason}</p>}
      <ul className="divide-y divide-border-subtle rounded border border-border-subtle" aria-label="Card types">
        {options.map((o) => (
          <li key={o.key}>
            <button
              type="button"
              className={`block w-full px-3 py-2 text-left disabled:cursor-not-allowed touch:min-h-10 ${focus === o.key ? "bg-bg-hover" : "hover:bg-bg-hover"}`}
              disabled={(o.unavailable != null && o.key !== current) || busy}
              onClick={() => onPick(o.key)}
              onMouseEnter={() => onFocus(o.key)}
              onFocus={() => onFocus(o.key)}
              aria-current={o.key === current ? "true" : undefined}
              data-testid="card-type"
              data-type={o.key}
            >
              <span className={`flex items-center text-sm font-medium ${o.unavailable && o.key !== current ? "text-fg-subtle" : "text-fg"}`}>
                {o.icon && <i className={`fa-solid fa-${o.icon} mr-1.5 text-fg-muted`} aria-hidden="true" />}
                <span className="min-w-0 flex-1">{o.label}</span>
                {o.key === current && <span className="ml-2 shrink-0 text-[11px] font-normal text-accent">current</span>}
              </span>
              <span className="block text-[11px] text-fg-muted">{o.hint}</span>
              {o.unavailable && <span className="block text-[11px] text-status-failed">{o.unavailable}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** At most this many cards preview at once (one per group, before a type is picked). */
export const MAX_PREVIEWS = 12;

export function CardTypeTiles({
  options,
  current,
  focus,
  onFocus,
  onPick,
  busy,
  data,
  metrics,
  runIds,
}: Pick & { data: CardData; metrics: readonly MetricInfo[]; runIds: readonly string[] }) {
  const first = useMemo(() => {
    const out = new Map<string, NewCard>();
    for (const o of options) {
      const c = o.unavailable == null || o.key === current ? newCards(data, [o.key], metrics)[0] : undefined;
      if (c) out.set(o.key, c);
    }
    return out;
  }, [options, current, data, metrics]);
  const avail = options.filter((o) => first.has(o.key));
  if (avail.length === 0) return <Hint>No card type shows this data.</Hint>;
  return (
    <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Card type previews" data-testid="card-type-tiles">
      {avail.map((o) => {
        const c = first.get(o.key)!;
        return (
          <li key={o.key}>
            <button
              type="button"
              className={`block w-full overflow-hidden rounded-lg border text-left transition-colors disabled:cursor-wait ${
                focus === o.key || o.key === current ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent"
              }`}
              onClick={() => onPick(o.key)}
              onMouseEnter={() => onFocus(o.key)}
              onFocus={() => onFocus(o.key)}
              disabled={busy}
              aria-label={o.key === current ? `${o.label} (current)` : `Show as ${o.label}`}
              data-type-preview={o.key}
            >
              <span className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-1.5 text-sm font-medium text-fg">
                {o.icon && <i className={`fa-solid fa-${o.icon} text-fg-muted`} aria-hidden="true" />}
                <span className="min-w-0 flex-1">{o.label}</span>
                {o.key === current && <span className="text-[11px] font-normal text-accent">current</span>}
              </span>
              <span className="block h-64 bg-bg">
                <CardPreview
                  draftKey={`type:${o.key}`}
                  type={c.type}
                  selector={c.selector}
                  settings={c.settings}
                  metrics={metrics}
                  runIds={runIds}
                  scale={0.75}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-40 items-center justify-center p-6 text-center text-sm text-fg-muted">{children}</div>;
}
