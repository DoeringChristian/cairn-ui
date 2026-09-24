// ---------------------------------------------------------------------------
// Template cards: what a template records about each card.
//
// Pure (no storage, no api, no react) so both template flavors — comparison
// templates (./templates.ts) and report templates (../reports/templates.ts) —
// and the matcher (./template-match.ts) share one definition.
// ---------------------------------------------------------------------------

import { isMultiRunCardType, type ComparisonCard } from "./types.ts";

export interface ComparisonTemplateCard {
  type: ComparisonCard["type"];
  /**
   * The metric names this card displays, in the card's own series order
   * (the `cardKeyOf` convention from lib/run-layout.ts).
   *
   * A card is not a single reference: it can overlay several metrics (chip
   * drag-drop, the settings picker), and a template restores all of them.
   * Empty for multi-run cards (parallel/scatter/bar/tile), which span the
   * run set rather than naming metrics — they match on `type` alone.
   */
  keys: string[];
  settings?: Record<string, unknown>;
}

/**
 * Capture a live card as a template card. Shared by every "save template"
 * entry point (comparisons and reports) so they agree on the key shape.
 */
export function templateCardOf(
  card: ComparisonCard,
  settings?: Record<string, unknown>,
): ComparisonTemplateCard {
  const keys = isMultiRunCardType(card.type)
    ? []
    : Array.from(new Set(card.series.map((s) => s.name)));
  return { type: card.type, keys, settings };
}

/**
 * Parse a persisted template card (localStorage, or the server's opaque
 * payload). Any non-empty string is accepted as a type — same rule as
 * `isComparisonCard` in types.ts — so a card type this build doesn't know
 * survives and renders `UnknownTypeCard`.
 */
function normalizeTemplateCard(raw: unknown): ComparisonTemplateCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { type?: unknown; keys?: unknown; settings?: unknown };
  if (typeof c.type !== "string" || c.type.length === 0 || !Array.isArray(c.keys)) return null;
  return {
    type: c.type as ComparisonTemplateCard["type"],
    keys: c.keys.filter((k): k is string => typeof k === "string"),
    settings:
      c.settings && typeof c.settings === "object"
        ? (c.settings as Record<string, unknown>)
        : undefined,
  };
}

/** Parse every card of a persisted template, dropping malformed ones. */
export function normalizeTemplateCards(cards: unknown[]): ComparisonTemplateCard[] {
  return cards
    .map(normalizeTemplateCard)
    .filter((c): c is ComparisonTemplateCard => c !== null);
}
