// ---------------------------------------------------------------------------
// Template matching: which template cards can be reconstructed from a run set.
//
// Pure (no api, no storage) — lib/templates/apply.ts fetches the sequences;
// this decides what a comparison or report template resolves to.
// ---------------------------------------------------------------------------

import { isMultiRunCardType, MULTI_RUN_CARD_LABELS } from "./types.ts";
import type { ComparisonTemplateCard } from "./template-cards.ts";

export interface SeriesEntry {
  runId: string;
  name: string;
}

export interface MatchedTemplateCard {
  tc: ComparisonTemplateCard;
  series: SeriesEntry[];
}

/**
 * metric name -> series entries available across the given runs, one entry per
 * run — see `buildSeqMap` in lib/templates/apply.ts.
 */
export type SeqMap = Map<string, SeriesEntry[]>;

/** A template minus everything matching doesn't look at. */
export interface MatchableTemplate {
  cards: ComparisonTemplateCard[];
}

/**
 * Decide which template cards can be reconstructed from `runIds` given
 * `seqMap`.
 *
 * - Multi-run cards (parallel/scatter/bar/tile) span the run set directly —
 *   they don't correspond to a metric name, so they always match as long as
 *   at least one run is given (they carry no `keys`; we branch on `tc.type`).
 * - Per-metric cards resolve each of their `keys` (metric names) against
 *   `seqMap`, concatenating the resulting series — a card that overlaid
 *   several metrics is restored as an overlay, not just its first series.
 *   The card matches when at least one key resolves.
 */
export function matchTemplateCards(
  template: MatchableTemplate,
  runIds: string[],
  seqMap: SeqMap,
): MatchedTemplateCard[] {
  const matched: MatchedTemplateCard[] = [];
  for (const tc of template.cards) {
    if (isMultiRunCardType(tc.type)) {
      if (runIds.length === 0) continue;
      const label = MULTI_RUN_CARD_LABELS[tc.type];
      matched.push({
        tc,
        series: runIds.map((runId) => ({ runId, name: label })),
      });
      continue;
    }

    const series: SeriesEntry[] = [];
    const seen = new Set<string>();
    for (const name of tc.keys) {
      if (name.startsWith("system.")) continue;
      const candidates = seqMap.get(name);
      if (!candidates?.length) continue;
      for (const s of candidates) {
        const id = `${s.runId}::${s.name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        series.push(s);
      }
    }
    if (series.length === 0) continue;
    matched.push({ tc, series });
  }
  return matched;
}
