/**
 * When a cards cell should rebind (and so persist) its cards to its run
 * sets' resolved runs. Never while the runs are still loading, and never to
 * no runs at all: the run set reads as empty then, and rebinding to it would
 * save every card with `series: []` (losing its metric for good).
 */

import type { ComparisonCard } from "../comparisons/types.ts";

export function shouldAutoRebind(opts: {
  /** The cell's runs are resolved (false while the project's runs load). */
  resolved: boolean;
  cards: readonly ComparisonCard[];
  resolvedRunIds: readonly string[];
}): boolean {
  const { resolved, cards, resolvedRunIds } = opts;
  if (!resolved || cards.length === 0 || resolvedRunIds.length === 0) return false;
  const bound = new Set(cards.flatMap((c) => c.series.map((s) => s.runId)));
  const want = new Set(resolvedRunIds);
  return bound.size !== want.size || [...want].some((id) => !bound.has(id));
}
