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
import type { Operator } from "../run-filter";
import type { RunSet } from "../run-sets";

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
  // A custom viewer (`settings.viewer`) over custom data or a built-in kind.
  "custom",
  // Workspace-level "multi-run" cards.
  "parallel",
  "scatter",
  "bar",
  "tile",
  "importance",
  "run-compare",
  "code-diff",
  "scalars",
  "config",
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

/** A filter chip's operator (= `Operator`, lib/run-filter.ts). */
export type FilterOperator =
  | "exact" | "iexact" | "gt" | "gte" | "lt" | "lte" | "in"
  | "contains" | "icontains" | "startswith" | "endswith" | "isnull";

/** A builder chip: `field op arg` (`arg` as typed, coerced on evaluation). */
export interface FilterChipSpec {
  kind: "chip";
  /** `display_name`, `status`, `tags`, `group`, `job_type`, `values.<key>` or `params.<key>`. */
  field: string;
  op: FilterOperator;
  arg: string;
}

/** A scalar expression a run matches when it is truthy. */
export interface FilterExprSpec {
  kind: "expr";
  expr: string;
}

/** And/or over children; an empty group constrains nothing. */
export interface FilterGroupSpec {
  kind: "group";
  op: "and" | "or";
  children: FilterNodeSpec[];
}

export type FilterNodeSpec = FilterChipSpec | FilterExprSpec | FilterGroupSpec;

/** One group-by level (= `GroupBy`, lib/runs-table/group.ts). */
export type GroupBySpec =
  | { source: "group" | "job_type" | "tag" }
  | { source: "param"; key: string }
  | { source: "expr"; expr: string };

/** One sort key (= `SortKey`, lib/runs-table/sort.ts). */
export interface SortKeySpec {
  /** `name`, `status`, `created_at`, `duration`, `value:<key>`, `param:<key>`. */
  column: string;
  direction: "asc" | "desc";
}

/**
 * A run set (= `RunSet`, lib/run-sets.ts): the workspace's runs table state,
 * frozen; its runs are resolved live. Every field is optional in a fence
 * (defaults: no filter, no grouping, all runs, newest first, no eyes).
 */
export interface RunSetSpec {
  name?: string;
  filter?: FilterGroupSpec;
  groupBy?: GroupBySpec[];
  latestOnly?: boolean;
  sort?: SortKeySpec[];
  /** Explicit eyes: `g:<group-by label>:<group>` / `r:<run id>` → shown. */
  eyes?: { [key: string]: boolean };
}

// Compile-time: the spec types accept every value of the runtime types.
type _AssertOperator = Operator extends FilterOperator ? (FilterOperator extends Operator ? true : never) : never;
const _operatorCheck: _AssertOperator = true;
void _operatorCheck;
const _runSetCheck = (s: RunSet): RunSetSpec => s;
void _runSetCheck;

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
  /**
   * Scalar cards: the x-axis as an expression over the run (`step`,
   * `wall_time`, `relative_time`, a metric such as `epoch`, `step * 32`).
   */
  x?: string;
  [key: string]: JSONValue | undefined;
}

/**
 * The schema root for one card entry — `ComparisonCard` (id/type/series)
 * plus the optional inline `settings` blob the ```cairn dialect carries
 * (see `CairnCardInput.settings` in lib/reports/cairn-block.ts).
 */
export type CardSpec = ComparisonCard & { settings?: CardSettingsSpec };

/** A cell's run view (mirrors `RunView` in lib/run-view.tsx). */
export interface RunViewSpec {
  /** Runs hidden from the cell's charts. */
  hidden?: string[];
  /** Runs drawn first, in this order. */
  pinned?: string[];
  /** The run the others are compared against. */
  baseline?: string | null;
}

/**
 * The ```cairn dialect's schema root. Mirrors `CairnSpec`
 * (lib/reports/cairn-block.ts), which remains the actual parser's input
 * type — this is its schema-generation counterpart, kept in sync by hand
 * (both are small and rarely change independently of each other).
 */
export interface CardsSpec {
  id?: string;
  /** The cell's run sets; the cards draw the union of their runs. */
  runSets?: RunSetSpec[];
  view?: RunViewSpec;
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
  runSet: RunSetSpec;
}
