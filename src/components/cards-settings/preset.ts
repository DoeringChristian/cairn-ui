import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { Normalize } from "../../lib/plot-utils/preset";
import type { CardSettingsMeta } from "./meta";

export interface PresetSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Confusion matrix cells: raw counts, or rows/columns scaled to sum to 1. */
  normalize?: Normalize;
}

export const builtin: PresetSettings = { version: 1, metrics: [] };

export function instanceDefaults(seed: { name: string }): Partial<PresetSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<PresetSettings> = { builtin, cascadeKeys: [], tabs: ["data", "display"] };
