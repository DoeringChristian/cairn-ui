import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { Normalize } from "../../lib/plot-utils/preset";
import type { CardSettingsMeta } from "./meta";
import {
  MEDIA_COLUMNS_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaColumnsBuiltin,
  mediaSliderBuiltin,
  type MediaColumnsSettings,
  type MediaSliderSettings,
} from "./media.ts";

export interface PresetSettings extends BaseCardSettings, MediaSliderSettings, MediaColumnsSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Confusion matrix cells: raw counts, or rows/columns scaled to sum to 1. */
  normalize: Normalize;
}

export const builtin: PresetSettings = {
  version: 1,
  ...mediaSliderBuiltin,
  ...mediaColumnsBuiltin,
  metrics: [],
  normalize: "none",
};

export function instanceDefaults(seed: { name: string }): Partial<PresetSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<PresetSettings> = {
  builtin,
  cascadeKeys: ["normalize", ...MEDIA_SLIDER_CASCADE, ...MEDIA_COLUMNS_CASCADE],
  tabs: ["data", "display"],
};
