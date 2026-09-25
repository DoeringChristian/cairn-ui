/**
 * Snapshot cards into a new report: a markdown header and one cards block
 * with copies of the cards (new ids), each card's settings overrides copied
 * into the report's scope. The source (a comparison, a run section) is left
 * untouched. Returns the new report's id.
 */

import { api } from "../../api/client";
import { loadCardOverrides, saveCardOverrides, type CardSettingsKey } from "../card-settings";
import type { ComparisonCard } from "../comparisons";
import { buildReportPayload, cardSettingsKeyForReport, newId } from "../reports";

export async function sendCardsToReport(opts: {
  projectId: string;
  name: string;
  /** Markdown under the report's title. */
  intro: string;
  runIds: string[];
  cards: ComparisonCard[];
  /** Where each source card's settings overrides live. */
  settingsKeyOf: (card: ComparisonCard) => CardSettingsKey;
}): Promise<string> {
  const { projectId, name, intro, runIds, cards, settingsKeyOf } = opts;
  const newCards: ComparisonCard[] = cards.map((card) => ({ ...card, id: newId() }));
  const blocks = [
    { id: newId(), type: "markdown" as const, text: `# ${name}\n\n${intro}` },
    { id: newId(), type: "cards" as const, runIds, cards: newCards },
  ];
  const created = await api.createReport(projectId, name, { source: "" });
  cards.forEach((card, i) => {
    const overrides = loadCardOverrides(settingsKeyOf(card));
    if (overrides) saveCardOverrides(cardSettingsKeyForReport(created.id, newCards[i]!), overrides);
  });
  const payload = buildReportPayload(created.id, blocks);
  await api.updateReport(projectId, created.id, { payload: payload as unknown as Record<string, unknown> });
  return created.id;
}
