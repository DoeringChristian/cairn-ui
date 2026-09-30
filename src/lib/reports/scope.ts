/**
 * The pseudo-run id under which a report's cards scope their settings
 * (their localStorage working copy, see lib/card-settings.ts).
 */

import type { CardSettingsKey } from "../card-settings";
import { cardSettingsKeyForScope, type ComparisonCard } from "../comparisons";

export function reportRunId(reportId: string): string {
  return `report:${reportId}`;
}

/**
 * The CardSettingsKey a report card's settings actually live under. Thin
 * wrapper around the same `cardSettingsKeyForScope` comparisons use — do not
 * fork the key-shape convention, see its doc comment in
 * lib/comparisons/types.ts.
 */
export function cardSettingsKeyForReport(reportId: string, card: ComparisonCard): CardSettingsKey {
  return cardSettingsKeyForScope(reportRunId(reportId), card);
}
