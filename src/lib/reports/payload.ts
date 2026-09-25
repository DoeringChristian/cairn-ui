/**
 * Report payload build/restore. Reports persist server-side only: the payload
 * is built right before a PUT and its card settings restored right after a
 * GET, rather than synced in the background like comparisons.
 */

import { loadCardOverrides, saveCardOverrides, type CardOverrides } from "../card-settings";
import { allReportCards, type ReportBlock, type ReportPayload } from "./types";
import { cardSettingsKeyForReport } from "./scope";
import { serializeReportToMarkdown } from "./markdown-source";

/**
 * Build the payload for server storage: `blocks` serialized to markdown with
 * each card's settings overrides inlined. `rawCairnSource` (from
 * `parseReportMarkdown`) keeps unedited ```cairn fences verbatim.
 */
export function buildReportPayload(
  reportId: string,
  blocks: ReportBlock[],
  rawCairnSource: Record<string, string> = {},
): ReportPayload {
  const cardSettings: Record<string, unknown> = {};
  for (const card of allReportCards(blocks)) {
    const overrides = loadCardOverrides(cardSettingsKeyForReport(reportId, card));
    if (overrides) cardSettings[card.id] = overrides;
  }
  return { source: serializeReportToMarkdown(blocks, cardSettings, rawCairnSource) };
}

/** Write a loaded report's per-card settings overrides into localStorage under the report's scope. */
export function restoreReportCardSettings(
  reportId: string,
  blocks: ReportBlock[],
  cardSettings: Record<string, unknown>,
): void {
  for (const card of allReportCards(blocks)) {
    const overrides = cardSettings[card.id];
    if (overrides && typeof overrides === "object") {
      saveCardOverrides(cardSettingsKeyForReport(reportId, card), overrides as CardOverrides);
    }
  }
}
