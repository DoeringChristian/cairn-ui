/**
 * Types for report documents (wandb-style reports: a vertical list of
 * markdown/cards blocks, persisted server-side as markdown source).
 */

import type { ComparisonCard } from "../comparisons";
import type { RunSet } from "../run-sets";
import type { RunView } from "../run-view";

export interface MarkdownBlock {
  id: string;
  type: "markdown";
  text: string;
}

export interface CardsBlock {
  id: string;
  type: "cards";
  title?: string;
  /**
   * The cell's run sets (lib/run-sets.ts): each a frozen runs-table state,
   * its runs resolved live; the cards draw the union of their runs.
   */
  runSets: RunSet[];
  /**
   * In-memory only: each set's runs fixed by the caller instead of resolved
   * (a share link's sets, resolved by the server).
   */
  fixedRuns?: string[][];
  /** In-memory only, with `fixedRuns`: each set's group lines (run id → line, lib/run-sets.ts `ResolvedRunSet`). */
  fixedGroups?: Record<string, string>[];
  /** Runs hidden from this cell's charts, pinned first, and its baseline (```cairn `view`). */
  runView?: RunView;
  cards: ComparisonCard[];
  /**
   * Set when this cell's ```cairn fence failed to compile (the
   * `CairnBlockError` message); the cell shows it instead of its cards.
   * In-memory only: the fence itself round-trips verbatim (rawCairnSource).
   */
  error?: string;
  /** The failed fence's body, re-compiled once the cell's metric index loads (lib/reports/recompile.ts). */
  errorSource?: string;
  /**
   * Set for a fence in the format before run sets (`runs:`): the cell shows
   * empty with this notice; its fence is kept as written until the cell is
   * edited (in-memory only).
   */
  notice?: string;
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
