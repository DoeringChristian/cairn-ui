import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { CardSettingsMeta } from "./meta";

export interface VolumeSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  sliderStep?: number;
}

export const builtin: VolumeSettings = { version: 1, metrics: [] };

export function instanceDefaults(seed: { name: string }): Partial<VolumeSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<VolumeSettings> = { builtin, cascadeKeys: [], tabs: [] };
