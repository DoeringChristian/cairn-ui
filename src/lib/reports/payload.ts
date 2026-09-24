/**
 * Report payload build/restore. Reports persist server-side only: the payload
 * is built right before a PUT and its card settings restored right after a
 * GET, rather than synced in the background like comparisons.
 */

import { cardSettingsStorageKey, loadCardSettings } from "../card-settings";
import { allReportCards, type ReportBlock, type ReportPayload } from "./types";
import { cardSettingsKeyForReport } from "./scope";
import { serializeReportToMarkdown } from "./markdown-source";

/**
 * Build the payload for server storage: `blocks` serialized to markdown with
 * each card's current settings inlined. `rawCairnSource` (from
 * `parseReportMarkdown`) keeps unedited ```cairn fences verbatim.
 */
export function buildReportPayload(
  reportId: string,
  blocks: ReportBlock[],
  rawCairnSource: Record<string, string> = {},
): ReportPayload {
  const cardSettings: Record<string, unknown> = {};
  for (const card of allReportCards(blocks)) {
    const settings = loadCardSettings(cardSettingsKeyForReport(reportId, card));
    if (settings) cardSettings[card.id] = settings;
  }
  return { source: serializeReportToMarkdown(blocks, cardSettings, rawCairnSource) };
}

/** Write a loaded report's per-card settings into localStorage under the report's scope. */
export function restoreReportCardSettings(
  reportId: string,
  blocks: ReportBlock[],
  cardSettings: Record<string, unknown>,
): void {
  for (const card of allReportCards(blocks)) {
    const settings = cardSettings[card.id];
    if (settings && typeof settings === "object") {
      const key = cardSettingsKeyForReport(reportId, card);
      try {
        localStorage.setItem(cardSettingsStorageKey(key), JSON.stringify(settings));
      } catch {
        /* ignore */
      }
    }
  }
}
