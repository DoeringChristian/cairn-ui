// ---------------------------------------------------------------------------
// Grow a card set from a run set's current sequences, or rebind an existing
// one to a changed run set. Shared by the runs table's "Compare", the Smart
// Wizard, smart-filter / RunSelector refreshes and report cards blocks.
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { buildMetricIndex, type MetricIndex } from "../reports/metric-index";
import { newId } from "../reports/ids";
import { isMultiRunCardType } from "./types";
import type { ComparisonCard, ComparisonSeriesRef } from "./types";

/**
 * Fetch each run's current sequences and group same-named series (across
 * runs) into one card per (name, object_type), one series per run. Runs
 * with no matching series simply contribute nothing.
 */
export async function cardsForRuns(runIds: string[]): Promise<Omit<ComparisonCard, "id">[]> {
  if (runIds.length === 0) return [];
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));

  const cardMap = new Map<
    string,
    { name: string; object_type: string; series: ComparisonSeriesRef[] }
  >();
  seqResults.forEach((result, idx) => {
    const runId = runIds[idx]!;
    for (const seq of result.sequences) {
      const key = `${seq.name}::${seq.object_type}`;
      const existing = cardMap.get(key);
      if (existing) {
        if (!existing.series.some((s) => s.runId === runId && s.name === seq.name)) {
          existing.series.push({ runId, name: seq.name });
        }
      } else {
        cardMap.set(key, {
          name: seq.name,
          object_type: seq.object_type,
          series: [{ runId, name: seq.name }],
        });
      }
    }
  });

  return Array.from(cardMap.values()).map((c) => ({
    type: c.object_type as ComparisonCard["type"],
    series: c.series,
  }));
}

/** `cardsForRuns` with fresh card ids — a full replace, not a merge. */
export async function rebuildCardsFromRuns(runIds: string[]): Promise<ComparisonCard[]> {
  return (await cardsForRuns(runIds)).map((card) => ({ id: newId(), ...card }));
}

/**
 * Re-resolve an existing card set against a (possibly changed) run set —
 * unlike `rebuildCardsFromRuns`, this does NOT discard/regrow cards. Each
 * existing card keeps its identity (`id`, `type`, curated series order) and
 * only has its `series` re-derived against `runIds`:
 *   - series entries whose `runId` fell out of the set are dropped;
 *   - for "simple" per-metric cards (every series entry shares one
 *     `name`/`object_type` — i.e. not a curated overlay of differing
 *     metrics), entries are added back for any newly-included run that
 *     carries that same metric.
 * Multi-run card types (parallel/scatter/bar/tile) don't key off `name`
 * (`ComparisonCardView` hands them the distinct `runId` set only), so their
 * series is simply re-pointed at `runIds` while preserving the card's label.
 *
 * A `RunSelector`-bound cards block whose resolved runs changed rebinds its
 * curated cards this way instead of replacing the whole card set.
 */
export async function rebindCardsToRuns(
  cards: ComparisonCard[],
  runIds: string[],
): Promise<ComparisonCard[]> {
  if (cards.length === 0) return cards;
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));
  const metricIndex = buildMetricIndex(
    runIds.map((runId, idx) => ({ runId, sequences: seqResults[idx]!.sequences })),
  );
  return rebindCardsToMetricIndex(cards, runIds, metricIndex);
}

/** Pure (no fetch) core of `rebindCardsToRuns` — reused where a metric index is already on hand. */
export function rebindCardsToMetricIndex(
  cards: ComparisonCard[],
  runIds: string[],
  metricIndex: MetricIndex,
): ComparisonCard[] {
  const runIdSet = new Set(runIds);
  return cards.map((card) => {
    if (isMultiRunCardType(card.type)) {
      const label = card.series[0]?.name ?? "";
      return { ...card, series: runIds.map((runId) => ({ runId, name: label })) };
    }

    const kept = card.series.filter((s) => runIdSet.has(s.runId));
    const keptRunIds = new Set(kept.map((s) => s.runId));
    // Only "simple" per-metric cards (single shared name across all series —
    // i.e. not a manual/curated overlay of differing metrics) grow into
    // newly-included runs automatically.
    const names = new Set(card.series.map((s) => s.name));
    const added: ComparisonSeriesRef[] = [];
    if (names.size === 1) {
      const [name] = names;
      const entry = metricIndex.get(`${name}::${card.type}`);
      if (entry) {
        for (const r of entry.runs) {
          if (runIdSet.has(r.runId) && !keptRunIds.has(r.runId)) {
            added.push({ runId: r.runId, name: name! });
          }
        }
      }
    }

    return { ...card, series: [...kept, ...added] };
  });
}
