import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { CardSettingsMeta } from "./meta";
import {
  MEDIA_COLUMNS_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaColumnsBuiltin,
  mediaSliderBuiltin,
  type MediaColumnsSettings,
  type MediaSliderSettings,
} from "./media.ts";

export interface VolumeSettings extends BaseCardSettings, MediaSliderSettings, MediaColumnsSettings {
  metrics: SeriesRef[];
}

export const builtin: VolumeSettings = { version: 1, ...mediaSliderBuiltin, ...mediaColumnsBuiltin, metrics: [] };

export function instanceDefaults(seed: { name: string }): Partial<VolumeSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<VolumeSettings> = {
  builtin,
  cascadeKeys: [...MEDIA_SLIDER_CASCADE, ...MEDIA_COLUMNS_CASCADE],
  tabs: ["data", "display"],
};
