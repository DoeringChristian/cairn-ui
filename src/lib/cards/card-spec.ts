/**
 * The canonical card-type vocabulary and the schema-root types for the
 * ```cairn dialect.
 *
 * `CARD_TYPES` is the one list of card types: `ComparisonCard.type` is typed
 * as `CardType`, and `CardRenderer` derives its per-metric cases from it
 * with a compile-time exhaustiveness check. The runtime guard
 * `isComparisonCard` (lib/comparisons/types.ts) stays permissive and accepts
 * any non-empty type string, so a card type this build doesn't know still
 * loads and renders `UnknownTypeCard`.
 *
 * `scripts/gen-card-spec-schema.mjs` generates
 * `docs/schemas/cairn-card-spec.schema.json` from `CardSpecSchema` below,
 * and `cairn_ui/cards/spec.py` mirrors it as pydantic models. Python never
 * re-implements `cardFromSpec` — it only builds/validates specs against this
 * shape.
 */

import type { ComparisonCard, ComparisonSeriesRef } from "../comparisons/types";
import type { RunSelector } from "../run-selector";
import type { AxisSource, XMetricRef } from "../plot-utils/x-axis";

/**
 * Every card type `CardRenderer` knows how to render. Order: per-metric
 * "series" cards first (a single metric across N runs), then the
 * workspace-level "multi-run" cards (a set of runs, not one metric — see
 * `MULTI_RUN_CARD_TYPES` in lib/comparisons/types.ts), then the
 * renderer-only types.
 */
export const CARD_TYPES = [
  // Per-metric "series" cards.
  "scalar",
  "image",
  "figure",
  "audio",
  "video",
  "histogram",
  "tensor",
  "text",
  "pointcloud",
  "mesh",
  "boxes3d",
  "volume",
  "preset",
  // Workspace-level "multi-run" cards.
  "parallel",
  "scatter",
  "bar",
  "tile",
  "importance",
  // Renderer-only types (CardRenderer.tsx's `metric.object_type` switch)
  // that predate this reconciliation without a `ComparisonCard.type` entry.
  "table",
  "html",
  "markdown",
  "artifact",
] as const;

export type CardType = (typeof CARD_TYPES)[number];

/** = `ComparisonSeriesRef` (lib/comparisons/types.ts) — one (run, metric) binding for a card. */
export type SeriesRef = ComparisonSeriesRef;

/** = `RunSelector` (lib/run-selector.ts) — a dynamic run-set binding. */
export type RunSelectorSpec = RunSelector;

/** Any valid JSON value — used to keep per-card `settings` permissive (see `CardSettingsSpec`). */
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

/**
 * Per-card `settings` (see `CairnCardInput.settings` in
 * lib/reports/cairn-block.ts): a few well-known keys, otherwise any JSON.
 * Each card type's full settings interface lives with the card.
 */
export interface CardSettingsSpec {
  version?: number;
  yScale?: "linear" | "log";
  smoothing?: number;
  smoothingKind?: "ema" | "twema" | "gaussian" | "window";
  step?: number;
  /** Scalar cards: the x-axis; `"metric"` plots against `xMetric`. */
  xAxis?: AxisSource;
  /** Scalar cards: the series an `xAxis: "metric"` card is joined to on step. */
  xMetric?: XMetricRef;
  [key: string]: JSONValue | undefined;
}

/**
 * The schema root for one card entry — `ComparisonCard` (id/type/series)
 * plus the optional inline `settings` blob the ```cairn dialect carries
 * (see `CairnCardInput.settings` in lib/reports/cairn-block.ts).
 */
export type CardSpec = ComparisonCard & { settings?: CardSettingsSpec };

/** A `runs:` block — static ids or a dynamic selector (mirrors `CairnRunsInput` in lib/reports/cairn-block.ts). */
export interface RunsSpec {
  ids?: string[];
  selector?: RunSelectorSpec;
}

/**
 * The ```cairn dialect's schema root. Mirrors `CairnSpec`
 * (lib/reports/cairn-block.ts), which remains the actual parser's input
 * type — this is its schema-generation counterpart, kept in sync by hand
 * (both are small and rarely change independently of each other).
 */
export interface CardsSpec {
  id?: string;
  runs?: RunsSpec;
  title?: string;
  cards?: CardSpec[];
}

/**
 * A report as published from Python: its markdown `source` plus
 * create-route metadata (see `ReportCreate` in the cairn server's
 * routes/reports.py).
 */
export interface ReportSpec {
  name: string;
  project?: string;
  source: string;
}

/**
 * Umbrella entry point for schema generation only — `scripts/gen-card-spec-schema.mjs`
 * generates the JSON Schema from THIS type so every card-spec root
 * (`CardsSpec`, `CardSpec`, `ReportSpec`, `CardType`, …) lands under one
 * deterministic `definitions` block with no degenerate wildcard entry.
 * Never constructed at runtime; it exists purely to anchor the generator.
 */
export interface CardSpecSchema {
  cardType: CardType;
  cardSpec: CardSpec;
  cardsSpec: CardsSpec;
  reportSpec: ReportSpec;
  seriesRef: SeriesRef;
  runSelector: RunSelectorSpec;
}
