/**
 * Card references (types.ts), growing/rebinding them from runs
 * (rebuild-cards.ts) and card templates (template-cards.ts) — the card
 * vocabulary reports and embeds share. Comparisons themselves are workspace
 * documents (lib/workspace).
 */

export type { ComparisonSeriesRef, ComparisonCard, MultiRunCardType } from "./types";
export {
  cardSettingsKeyForScope,
  MULTI_RUN_CARD_TYPES,
  MULTI_RUN_CARD_LABELS,
  isMultiRunCardType,
} from "./types";

export { cardsForRuns, rebuildCardsFromRuns, rebindCardsToRuns, rebindCardsToMetricIndex } from "./rebuild-cards";

export type { ComparisonTemplateCard } from "./template-cards";
export { templateCardOf } from "./template-cards";
