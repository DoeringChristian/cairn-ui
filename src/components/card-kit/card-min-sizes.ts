/**
 * Per-card-type minimum sizes and the collection-aware clamp helpers.
 *
 * A single source of truth: each card declares its `cardKind` to CardShell,
 * which stamps `data-cairn-min-h` / `data-cairn-min-span` on the card root.
 * The resize handle then reads those attributes off sibling cards to enforce
 * "no smaller than the largest minimum in the collection" — row-scoped for
 * height (cards sharing a visual row adopt one height) and section-scoped for
 * column span (a width syncs across the whole grid section).
 */

import { snapSpanUp } from "../../lib/cards/card-width";

/** `minSpan`: columns of the 12-column grid (a width's span: 3, 4, 6 or 12; lib/cards/card-width.ts). */
export type CardMinSize = { minHeight: number; minSpan: 3 | 4 | 6 | 12 };

/** Fallback when a card kind isn't in the table (or none is declared). */
const DEFAULT_MIN_SIZE: CardMinSize = { minHeight: 150, minSpan: 3 };

/**
 * Minimum height (px) and column span each card type stays usable at. Values
 * are deliberately conservative — small enough not to fight normal use, large
 * enough that controls (sliders, legends, axes, settings rows) don't collapse.
 */
const CARD_MIN_SIZES: Record<string, CardMinSize> = {
  scalar: { minHeight: 200, minSpan: 3 },
  image: { minHeight: 220, minSpan: 3 },
  figure: { minHeight: 300, minSpan: 4 },
  table: { minHeight: 220, minSpan: 4 },
  parallel: { minHeight: 250, minSpan: 4 },
  scatter: { minHeight: 220, minSpan: 3 },
  histogram: { minHeight: 180, minSpan: 3 },
  preset: { minHeight: 240, minSpan: 3 },
  tensor: { minHeight: 200, minSpan: 3 },
  pointcloud: { minHeight: 280, minSpan: 4 },
  mesh: { minHeight: 280, minSpan: 4 },
  boxes3d: { minHeight: 280, minSpan: 4 },
  volume: { minHeight: 280, minSpan: 4 },
  bar: { minHeight: 200, minSpan: 3 },
  tile: { minHeight: 120, minSpan: 3 },
  importance: { minHeight: 220, minSpan: 3 },
  "run-compare": { minHeight: 200, minSpan: 4 },
  "code-diff": { minHeight: 280, minSpan: 6 },
  scalars: { minHeight: 140, minSpan: 4 },
  config: { minHeight: 140, minSpan: 4 },
  html: { minHeight: 150, minSpan: 3 },
  markdown: { minHeight: 150, minSpan: 3 },
  text: { minHeight: 150, minSpan: 3 },
  audio: { minHeight: 120, minSpan: 3 },
  video: { minHeight: 180, minSpan: 3 },
  artifact: { minHeight: 120, minSpan: 3 },
  custom: { minHeight: 220, minSpan: 3 },
};

export function cardMinSize(kind?: string): CardMinSize {
  return (kind ? CARD_MIN_SIZES[kind] : undefined) ?? DEFAULT_MIN_SIZE;
}


function readMinHeight(el: Element): number {
  const v = Number((el as HTMLElement).getAttribute("data-cairn-min-h"));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_SIZE.minHeight;
}

function readMinSpan(el: Element): number {
  const v = Number((el as HTMLElement).getAttribute("data-cairn-min-span"));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_SIZE.minSpan;
}

/**
 * The largest per-card minimum height among the cards sharing `card`'s visual
 * row (top edges within `epsilonPx`). Includes `card` itself.
 */
export function rowMinHeight(card: HTMLElement, gridEl: HTMLElement, epsilonPx = 2): number {
  const top = card.getBoundingClientRect().top;
  let min = readMinHeight(card);
  for (const el of gridEl.querySelectorAll("[data-cairn-card]")) {
    if (Math.abs((el as HTMLElement).getBoundingClientRect().top - top) < epsilonPx) {
      min = Math.max(min, readMinHeight(el));
    }
  }
  return min;
}

/** The largest per-card minimum span among all cards in the grid section (widths sync section-wide). */
export function sectionMinSpan(gridEl: HTMLElement): number {
  let min = DEFAULT_MIN_SIZE.minSpan as number;
  for (const el of gridEl.querySelectorAll("[data-cairn-card]")) {
    min = Math.max(min, readMinSpan(el));
  }
  return snapSpanUp(min);
}

/** This card's own minimum height, read off its root data attribute. */
export function ownMinHeight(card: HTMLElement | null): number {
  return card ? readMinHeight(card) : DEFAULT_MIN_SIZE.minHeight;
}

/** This card's own minimum span, read off its root data attribute. */
export function ownMinSpan(card: HTMLElement | null): number {
  return card ? readMinSpan(card) : DEFAULT_MIN_SIZE.minSpan;
}
