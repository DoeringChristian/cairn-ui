/**
 * Card references shared by reports, embeds and the report/comparison
 * "send to report" flows: a card type plus the (run, metric) series it
 * shows. Workspaces (the run page and comparisons) do not store these —
 * their panels are written in metric names (lib/workspace/doc.ts).
 */

import type { CardSettingsKey } from "../card-settings";
import type { CardType } from "../cards/card-spec";

export interface ComparisonSeriesRef {
  runId: string;
  /** Metric name. */
  name: string;
}

export interface ComparisonCard {
  /** Stable uuid. Distinct from the settings storage key — see lib/card-settings.ts. */
  id: string;
  /** The canonical `CardType` (lib/cards/card-spec.ts) every dispatch site agrees on. */
  type: CardType;
  series: ComparisonSeriesRef[];
}

/**
 * Card types that render as a workspace-level "multi-run" card — a *set of
 * runs* rather than a single metric. They flow through CardRenderer's
 * `kind: "multi-run"` union and key their settings on `card.type` (see
 * `cardSettingsKeyFor`), unlike per-metric cards which key on `card.id`.
 *
 * Centralized here so every dispatch site (CardRenderer, ComparePage,
 * AddCardModal, sync.cardSettingsKeyFor) agrees on the same list.
 */
export const MULTI_RUN_CARD_TYPES = ["parallel", "scatter", "bar", "tile", "importance", "run-compare", "code-diff"] as const;
export type MultiRunCardType = (typeof MULTI_RUN_CARD_TYPES)[number];
export function isMultiRunCardType(t: string): t is MultiRunCardType {
  return (MULTI_RUN_CARD_TYPES as readonly string[]).includes(t);
}

/**
 * Human label per multi-run card type — mirrors AddCardModal's
 * `multiRunDefaults` fallback entries. Used when reconstructing a
 * multi-run card's series (e.g. applying a comparison template), where
 * there's no real metric name to draw from.
 */
export const MULTI_RUN_CARD_LABELS: Record<MultiRunCardType, string> = {
  parallel: "Parallel Coordinates",
  scatter: "Scatter Plot",
  bar: "Bar Chart",
  tile: "Scalar Tile",
  importance: "Parameter Importance",
  "run-compare": "Run Comparer",
  "code-diff": "Code Diff",
};

/**
 * The CardSettingsKey shape a card's settings live under, given the
 * pseudo-run id of its scope (a report via `reportRunId` in lib/reports, or
 * the embed scope).
 *
 * Multi-run cards (parallel/scatter/bar/tile, rendered via CardRenderer's
 * "multi-run" kind) key on `{runId: scopeRunId, metricName:
 * "<card.type>:<card.id>"}`; every other card type keys on `{runId:
 * scopeRunId, metricName: card.id}` (the `settingsKeyOverride` shape).
 *
 * Single source of truth for this key-shape so every scope (reports,
 * embeds) agrees on the same convention — see `lib/reports`'s
 * `cardSettingsKeyForReport`, a thin wrapper around this function.
 */
export function cardSettingsKeyForScope(scopeRunId: string, card: ComparisonCard): CardSettingsKey {
  if (isMultiRunCardType(card.type)) {
    return { runId: scopeRunId, metricName: `${card.type}:${card.id}` };
  }
  return { runId: scopeRunId, metricName: card.id };
}

export function isComparisonCard(x: unknown): x is ComparisonCard {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<ComparisonCard>;
  if (typeof c.id !== "string") return false;
  // Accept any non-empty string as type — don't hardcode a set that
  // silently drops entire comparisons when a new card type is added.
  if (typeof c.type !== "string" || c.type.length === 0) return false;
  if (!Array.isArray(c.series)) return false;
  return c.series.every((s) => {
    if (!s || typeof s !== "object") return false;
    const r = s as Partial<ComparisonSeriesRef>;
    return (
      typeof r.runId === "string" &&
      typeof r.name === "string"
    );
  });
}

/** Runs a multi-run card needs before it can show anything (others: 1). */
const MULTI_RUN_MIN_RUNS: Partial<Record<MultiRunCardType, number>> = {
  parallel: 2,
  scatter: 2,
  importance: 2,
  "run-compare": 2,
  "code-diff": 2,
};

/** The fewest bound runs a card of `type` can show anything with. */
export function minRunsFor(type: string): number {
  return isMultiRunCardType(type) ? (MULTI_RUN_MIN_RUNS[type] ?? 1) : 1;
}
