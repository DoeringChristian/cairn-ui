import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { CardSettingsMeta } from "./meta";

export const DEFAULT_ROWS_PER_PAGE = 100;

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
}

export const builtin: TableSettings = {
  version: 1,
  metrics: [],
  rowsPerPage: DEFAULT_ROWS_PER_PAGE,
  hiddenColumns: [],
};

export function instanceDefaults(seed: { name: string }): Partial<TableSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<TableSettings> = {
  builtin,
  cascadeKeys: ["rowsPerPage"],
  tabs: ["data", "display"],
};
