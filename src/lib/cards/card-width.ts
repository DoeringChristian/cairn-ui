/**
 * Card widths (pure): a card is full, 1/2, 1/3 or 1/4 of its row, like
 * wandb's panels. Underneath is a 12-column grid (ReorderableCardGrid
 * `md:grid-cols-12`), where the four widths span 12, 6, 4 and 3 columns.
 * Phones show one column whatever the width (index.css).
 *
 * A card stores its width as `settings.width` ("full" | "1/2" | "1/3" |
 * "1/4"). Anything else stored there (an older layout's value, a typo in a
 * hand-written document) is ignored: the card takes its default width, the
 * one its instance or type would give it (`resolveCardWidth`).
 *
 * Type defaults (`defaultCardWidth`) come from each type's former default
 * column span on the old 6-column grid, rounded to the nearest of the four
 * fractions of the row (`widthOfSpan6`):
 *
 *   old span (of 6)   1     2     3     4     5     6
 *   fraction          1/6   1/3   1/2   2/3   5/6   1
 *   new width         1/4   1/3   1/2   1/2   full  full
 *
 * So summary cards (scalars, config), the run comparer and the code diff
 * (span 6) are full; charts and media (span 3, or 4 for figures and 3D
 * views) are 1/2; value tiles (span 1) are 1/4.
 */

/** Columns of the card grid on wider screens. */
export const GRID_COLUMNS = 12;

/** The widths a card can have, widest first. */
export const CARD_WIDTHS = ["full", "1/2", "1/3", "1/4"] as const;
export type CardWidth = (typeof CARD_WIDTHS)[number];

/** Columns of the 12-column grid each width spans. */
export const WIDTH_SPAN: Readonly<Record<CardWidth, number>> = { full: 12, "1/2": 6, "1/3": 4, "1/4": 3 };

/** How the width setting names each width. */
export const WIDTH_LABEL: Readonly<Record<CardWidth, string>> = { full: "Full", "1/2": "1/2", "1/3": "1/3", "1/4": "1/4" };

/** The spans a card can have, narrowest first. */
export const VALID_SPANS: readonly number[] = CARD_WIDTHS.map((w) => WIDTH_SPAN[w]).sort((a, b) => a - b);

/** The width when nothing else gives one. */
export const FALLBACK_WIDTH: CardWidth = "1/2";

export function isCardWidth(v: unknown): v is CardWidth {
  return typeof v === "string" && (CARD_WIDTHS as readonly string[]).includes(v);
}

/** Grid columns a width spans. */
export function widthSpan(w: CardWidth): number {
  return WIDTH_SPAN[w];
}

/** The valid span nearest `raw` columns (of 12); a tie takes the narrower. */
export function snapSpan(raw: number): number {
  let best = VALID_SPANS[0];
  for (const s of VALID_SPANS) if (Math.abs(raw - s) < Math.abs(raw - best)) best = s;
  return best;
}

/** The narrowest valid span at least `min` columns wide (full when none). */
export function snapSpanUp(min: number): number {
  return VALID_SPANS.find((s) => s >= min) ?? GRID_COLUMNS;
}

/** The width a span (of 12) snaps to. */
export function widthOfSpan(span: number): CardWidth {
  const s = snapSpan(span);
  return CARD_WIDTHS.find((w) => WIDTH_SPAN[w] === s)!;
}

/** An old 6-column-grid span as the nearest fraction of the row (see the module doc). */
export function widthOfSpan6(span: number): CardWidth {
  const fraction = span / 6;
  let best: CardWidth = CARD_WIDTHS[0];
  for (const w of CARD_WIDTHS) {
    if (Math.abs(fraction - WIDTH_SPAN[w] / GRID_COLUMNS) < Math.abs(fraction - WIDTH_SPAN[best] / GRID_COLUMNS)) best = w;
  }
  return best;
}

/** Each card type's former default span on the 6-column grid (the default is 3). */
const OLD_DEFAULT_SPAN6: Readonly<Record<string, number>> = {
  scalars: 6,
  config: 6,
  "run-compare": 6,
  "code-diff": 6,
  figure: 4,
  pointcloud: 4,
  mesh: 4,
  boxes3d: 4,
  volume: 4,
  tile: 1,
};

/** A scalar card showing a single value (ScalarValueCard): a value tile, like `tile`. */
export const VALUE_CARD_DEFAULTS: { width: CardWidth } = { width: widthOfSpan6(1) };

/** A card type's default width. */
export function defaultCardWidth(type: string): CardWidth {
  return widthOfSpan6(OLD_DEFAULT_SPAN6[type] ?? 3);
}

/**
 * The width a card shows: what it resolved to (its own setting, else its
 * instance's or type's default) when that is a width, else the first of
 * `fallbacks` that is one, else the default width.
 */
export function resolveCardWidth(value: unknown, ...fallbacks: unknown[]): CardWidth {
  if (isCardWidth(value)) return value;
  for (const f of fallbacks) if (isCardWidth(f)) return f;
  return FALLBACK_WIDTH;
}
