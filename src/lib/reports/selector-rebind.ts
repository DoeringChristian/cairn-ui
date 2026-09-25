/**
 * When a selector-bound cards cell should rebind (and so persist) its cards
 * to the selector's resolved run set. Never while the selector is still
 * resolving: the run set reads as empty then, and rebinding to it would save
 * every card with `series: []` (emptying it for good).
 */

import type { ComparisonCard } from "../comparisons/types.ts";

export function shouldAutoRebind(opts: {
  /** The selector's run query has data (false while it's loading). */
  resolved: boolean;
  cards: readonly ComparisonCard[];
  resolvedRunIds: readonly string[];
}): boolean {
  const { resolved, cards, resolvedRunIds } = opts;
  if (!resolved || cards.length === 0) return false;
  const bound = new Set(cards.flatMap((c) => c.series.map((s) => s.runId)));
  const want = new Set(resolvedRunIds);
  return bound.size !== want.size || [...want].some((id) => !bound.has(id));
}
