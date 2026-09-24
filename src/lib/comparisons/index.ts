/**
 * Named, persisted multi-comparison storage — public surface.
 *
 * See store.ts (CRUD), templates.ts (comparison templates), sync.ts (server
 * sync), events.ts (in-tab pubsub + the useComparisons hook), and types.ts
 * (shared types/guards) for implementation.
 */

export type {
  ComparisonSeriesRef,
  ComparisonCard,
  MultiRunCardType,
  SmartFilterEntry,
  SmartFilters,
  Comparison,
} from "./types";
export {
  compareRunId,
  comparisonRunIds,
  cardSettingsKeyForScope,
  MULTI_RUN_CARD_TYPES,
  MULTI_RUN_CARD_LABELS,
  isMultiRunCardType,
} from "./types";

export {
  loadComparisons,
  saveComparisons,
  createComparison,
  renameComparison,
  deleteComparison,
  addCardToComparison,
  addCardsToComparison,
  addRunsToComparison,
  removeRunFromComparison,
  reorderComparisonCards,
  removeCardFromComparison,
  setComparisonRunSelector,
  updateComparison,
} from "./store";

export { cardsForRuns, rebuildCardsFromRuns, rebindCardsToRuns, rebindCardsToMetricIndex } from "./rebuild-cards";

export { useComparisons } from "./events";

export type { ComparisonTemplate } from "./templates";
export type { ComparisonTemplateCard } from "./template-cards";
export { templateCardOf } from "./template-cards";
export { createTemplate, deleteTemplate, useTemplates } from "./templates";

export {
  syncComparisonToServer,
  deleteComparisonFromServer,
  syncComparisonsFromServer,
  cardSettingsKeyFor,
} from "./sync";

export type { ApplyTemplateResult } from "./apply-template";
export { applyTemplateToRuns } from "./apply-template";
