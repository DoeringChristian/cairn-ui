/**
 * Types for report documents (wandb-style reports: a vertical list of
 * markdown/cards blocks, persisted server-side as markdown source).
 */

import type { ComparisonCard } from "../comparisons";
import type { RunSelector } from "../run-selector";

export interface MarkdownBlock {
  id: string;
  type: "markdown";
  text: string;
}

export interface CardsBlock {
  id: string;
  type: "cards";
  title?: string;
  /** Static run ids this block's cards are bound to (used when `runSelector` is absent). */
  runIds?: string[];
  /** Dynamic run selector — when present, resolved live and takes precedence over `runIds`. */
  runSelector?: RunSelector;
  cards: ComparisonCard[];
}

export type ReportBlock = MarkdownBlock | CardsBlock;

/** What the server stores for a report. */
export interface ReportPayload {
  /**
   * The report as markdown: prose plus ```cairn fences carrying each card
   * and its inline settings (see lib/reports/markdown-source.ts). The editor
   * parses it into `blocks[]` on load and re-serializes on save.
   */
  source: string;
}

export function isMarkdownBlock(b: ReportBlock): b is MarkdownBlock {
  return b.type === "markdown";
}

export function isCardsBlock(b: ReportBlock): b is CardsBlock {
  return b.type === "cards";
}

/** Every ComparisonCard across every cards-block in a report, in order. */
export function allReportCards(blocks: ReportBlock[]): ComparisonCard[] {
  const out: ComparisonCard[] = [];
  for (const b of blocks) {
    if (isCardsBlock(b)) out.push(...b.cards);
  }
  return out;
}
