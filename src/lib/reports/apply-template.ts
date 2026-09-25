// ---------------------------------------------------------------------------
// Apply a report template to a set of runs — creates a new report with one
// markdown header block and one cards block.
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { saveCardOverrides, type CardOverrides } from "../card-settings";
import type { ComparisonCard } from "../comparisons";
import { matchTemplateToRuns } from "../templates/apply";
import type { ReportTemplate } from "./templates";
import type { CardsBlock, MarkdownBlock, ReportBlock } from "./types";
import { newId } from "./ids";
import { cardSettingsKeyForReport } from "./scope";
import { buildReportPayload } from "./payload";

export interface ApplyReportTemplateResult {
  /** Newly created report's id, or null when nothing matched (no report was created). */
  reportId: string | null;
  matchedCount: number;
  totalCount: number;
}

/**
 * Apply `template` to `runIds`, creating a brand-new report. Only matched
 * cards are added, with their saved settings; nothing is created when no
 * card matches.
 */
export async function applyReportTemplateToRuns(
  projectId: string,
  template: ReportTemplate,
  runIds: string[],
): Promise<ApplyReportTemplateResult> {
  const totalCount = template.cards.length;
  const matched = await matchTemplateToRuns(template, runIds);

  if (matched.length === 0) {
    return { reportId: null, matchedCount: 0, totalCount };
  }

  const cards: ComparisonCard[] = matched.map((m) => ({ id: newId(), type: m.tc.type, series: m.series }));
  const headerBlock: MarkdownBlock = {
    id: newId(),
    type: "markdown",
    text: `# ${template.name}\n\nApplied to ${runIds.length} run(s): ${runIds.join(", ")}`,
  };
  const cardsBlock: CardsBlock = { id: newId(), type: "cards", runIds, cards };
  const blocks: ReportBlock[] = [headerBlock, cardsBlock];

  const created = await api.createReport(projectId, template.name, { source: "" });

  // Restore saved settings from the template into the new report's scope,
  // then fold them into the payload (reports are server-native — settings
  // must be pushed explicitly, there's no background sync like comparisons).
  matched.forEach((m, i) => {
    if (m.tc.settings) {
      const card = cards[i];
      if (card) saveCardOverrides(cardSettingsKeyForReport(created.id, card), m.tc.settings as CardOverrides);
    }
  });
  const fullPayload = buildReportPayload(created.id, blocks);
  await api.updateReport(projectId, created.id, { payload: fullPayload as unknown as Record<string, unknown> });

  return { reportId: created.id, matchedCount: matched.length, totalCount };
}
