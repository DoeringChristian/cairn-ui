import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { CardSettingsMeta } from "./meta";
import type { JoinHow } from "../../lib/table/combine.ts";
import type { TableOps } from "../../lib/table/pipeline.ts";
import type { TextDiffMode } from "../../lib/table/text-diff.ts";

export const DEFAULT_ROWS_PER_PAGE = 100;

/** One table fed into a combine: a series of the card at the slider's step or a fixed step. */
export interface TableCombineSource {
  runId: string;
  name: string;
  step: "slider" | number;
}

/**
 * Show one table built from several: stacked (`concat`, a leading `source`
 * column says where each row came from) or joined on a key (`join`, the first
 * two sources; see lib/table/combine.ts). No sources = the card's series, each
 * at the slider's step.
 */
export interface TableCombine {
  mode: "none" | "concat" | "join";
  sources: TableCombineSource[];
  /** Join key column; absent = the shared id-like first column, else by position. */
  on?: string;
  how?: JoinHow;
}

export interface TableSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Rows shown per page in the client-side pager. */
  rowsPerPage: number;
  /** Column names hidden by the visibility toggles. */
  hiddenColumns: string[];
  /**
   * Show red/green diff colors on numeric cells vs the other compared runs.
   * Optional — defaults (computed at render time, not persisted until the
   * user touches the toggle) to ON when exactly 2 runs are compared.
   */
  diffMode?: boolean;
  /** Flip which direction (higher/lower) renders green vs red. */
  invertDiffColors?: boolean;
  /** Derived columns, row query and group-by, applied to each table shown (lib/table/pipeline.ts). */
  ops: TableOps;
  combine: TableCombine;
  /** Text cells of compared tables (and joined `_1`/`_2` twins) show a diff against the reference. */
  textDiff: "off" | TextDiffMode;
}

export const builtin: TableSettings = {
  version: 1,
  metrics: [],
  rowsPerPage: DEFAULT_ROWS_PER_PAGE,
  hiddenColumns: [],
  ops: {},
  combine: { mode: "none", sources: [] },
  textDiff: "off",
};

export function instanceDefaults(seed: { name: string }): Partial<TableSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<TableSettings> = {
  builtin,
  cascadeKeys: ["rowsPerPage", "textDiff"],
  tabs: ["data", "grouping", "display", "expressions"],
};
