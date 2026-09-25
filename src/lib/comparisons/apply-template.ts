// ---------------------------------------------------------------------------
// Apply a comparison template to a set of runs — creates a new comparison.
// Used by RunsTablePage's "From template" and ComparePage's template sidebar.
// ---------------------------------------------------------------------------

import { saveCardOverrides, type CardOverrides } from "../card-settings";
import { matchTemplateToRuns } from "../templates/apply";
import { addCardsToComparison, createComparison, loadComparisons } from "./store";
import { cardSettingsKeyFor } from "./sync";
import type { ComparisonTemplate } from "./templates";

export interface ApplyTemplateResult {
  /** Newly created comparison's id, or null when nothing matched (no comparison was created). */
  comparisonId: string | null;
  matchedCount: number;
  totalCount: number;
}

/**
 * Apply `template` to `runIds`. Only matched cards are added, with their
 * saved settings overrides; nothing is created when no card matches.
 */
export async function applyTemplateToRuns(
  projectId: string,
  template: ComparisonTemplate,
  runIds: string[],
): Promise<ApplyTemplateResult> {
  const totalCount = template.cards.length;
  const matched = await matchTemplateToRuns(template, runIds);
  if (matched.length === 0) {
    return { comparisonId: null, matchedCount: 0, totalCount };
  }

  const cmp = createComparison(projectId, template.name, runIds.length > 0 ? runIds : undefined);
  addCardsToComparison(
    projectId,
    cmp.id,
    matched.map((m) => ({ type: m.tc.type, series: m.series })),
  );

  const cards = loadComparisons(projectId).find((c) => c.id === cmp.id)?.cards ?? [];
  matched.forEach((m, i) => {
    const card = cards[i];
    if (m.tc.settings && card) saveCardOverrides(cardSettingsKeyFor(cmp.id, card), m.tc.settings as CardOverrides);
  });

  return { comparisonId: cmp.id, matchedCount: matched.length, totalCount };
}
