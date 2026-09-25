import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { XAxisMode } from "../StepSlider";

/** Settings fields `SteppedMediaCard` owns; audio/video/html/markdown settings extend these. */
export interface SteppedMediaSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: XAxisMode;
}

export function steppedMediaInstanceDefaults(seed: { name: string }): Partial<SteppedMediaSettings> {
  return { metrics: [seed] };
}
