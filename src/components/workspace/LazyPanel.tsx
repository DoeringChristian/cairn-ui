/**
 * A workspace panel that mounts its card only once it is on or near the
 * screen (lib/near-viewport.ts). Until then a placeholder holds the card's
 * place: its column span, height and collapsed state come from the card's
 * own settings (the same cascade the card resolves), so the grid does not
 * reflow when the card arrives. Once mounted, a card stays.
 *
 * The placeholder stands in for the card where the page reaches cards it
 * has not rendered:
 * - resizing a sibling card sets this card's span (and, in its row, height)
 *   as it would the mounted card's;
 * - ←/→ in a detail modal can step onto it: it mounts the card and opens
 *   the card's modal (`OpenOnMountContext`).
 */

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CardMutationContext, useCardSettings, resolveCardHeight, type CardSettingsKey } from "../../lib/card-settings";
import type { CardType } from "../../lib/cards/card-spec";
import { OpenOnMountContext, useCardNavRegistration } from "../../lib/card-nav";
import { whenNearViewport } from "../../lib/near-viewport";
import { cardMinSize } from "../card-kit/card-min-sizes";
import { useGridSizeSync } from "../CardResizeHandle";

/** Height a card of `type` takes when its settings set none (what the card passes CardShell). */
const DEFAULT_HEIGHTS: Partial<Record<CardType, number>> = {
  scalar: 300,
  image: 360,
  figure: 400,
  pointcloud: 400,
  mesh: 400,
  boxes3d: 400,
  volume: 400,
  video: 350,
  histogram: 280,
  tensor: 300,
  text: 250,
  table: 320,
  html: 360,
  markdown: 300,
  preset: 340,
  parallel: 350,
  scatter: 350,
  bar: 350,
  tile: 170,
  importance: 350,
  "run-compare": 420,
  "code-diff": 480,
};
/** For a card whose height follows its content (audio, artifact): a guess. */
const AUTO_HEIGHT_GUESS = 200;
/** A collapsed card is its header. */
const COLLAPSED_HEIGHT = 58;

interface Props {
  type: CardType;
  settingsKey: CardSettingsKey;
  title: string;
  /** The card renders as a single value (a one-point scalar): 120 px, no detail modal. */
  valueCard?: boolean;
  /** Mount at once (a card that must scroll into view or open on mount). */
  eager?: boolean;
  children: ReactNode;
}

export default function LazyPanel({ type, settingsKey, title, valueCard, eager, children }: Props) {
  const [mounted, setMounted] = useState(!!eager);
  const [openOnMount, setOpenOnMount] = useState(false);
  if (mounted) return <OpenOnMountContext.Provider value={openOnMount}>{children}</OpenOnMountContext.Provider>;
  return (
    <Placeholder
      type={type}
      settingsKey={settingsKey}
      title={title}
      valueCard={valueCard}
      onMount={(open) => {
        if (open) setOpenOnMount(true);
        setMounted(true);
      }}
    />
  );
}

function Placeholder({
  type,
  settingsKey,
  title,
  valueCard,
  onMount,
}: Omit<Props, "children" | "eager"> & { onMount: (open: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ctl = useCardSettings<{ colSpan?: number; height?: number; collapsed?: boolean; title?: string }>(settingsKey, type);
  const s = ctl.value;
  const min = cardMinSize(valueCard ? "scalar-value" : type);
  const collapsed = !!s.collapsed;
  const height = collapsed
    ? COLLAPSED_HEIGHT
    : (resolveCardHeight(s, valueCard ? 120 : DEFAULT_HEIGHTS[type], min.minHeight) ?? AUTO_HEIGHT_GUESS);

  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return whenNearViewport(el, () => onMountRef.current(false));
  }, []);

  // A sibling's resize applies to this card too (as CardShell's handle would).
  const setRef = useRef(ctl.set);
  setRef.current = ctl.set;
  const spanCb = useRef((span: number) => setRef.current({ colSpan: span }, { mergeKey: "resize", label: "Resize card" }));
  const heightCb = useRef((h: number | undefined) => setRef.current({ height: h }, { mergeKey: "resize", label: "Resize card" }));
  // Only where CardShell would have a resize handle (an editable card).
  useGridSizeSync(ref, spanCb, heightCb, useContext(CardMutationContext));

  // A detail modal stepping onto this card mounts it, open.
  useCardNavRegistration(!collapsed && !valueCard ? () => onMountRef.current(true) : undefined);

  return (
    <div
      ref={ref}
      data-cairn-card
      data-cairn-placeholder
      data-cairn-min-h={min.minHeight}
      data-cairn-min-span={min.minSpan}
      data-cairn-fixed-h=""
      className="card flex min-w-0 flex-col p-4"
      style={{ gridColumn: `span ${s.colSpan ?? 3}`, height, "--cairn-card-h": `${height}px` } as React.CSSProperties}
      aria-busy="true"
    >
      <h3 className="mono truncate text-sm font-semibold text-fg-muted">{s.title ?? title}</h3>
      {!collapsed && <div className="mt-3 flex-1 rounded bg-bg-hover" />}
    </div>
  );
}
