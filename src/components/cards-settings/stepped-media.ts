import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { XAxisMode } from "../StepSlider";
import {
  MEDIA_LAYOUT_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaLayoutBuiltin,
  mediaSliderBuiltin,
  type MediaLayoutSettings,
  type MediaSliderSettings,
} from "./media.ts";

/** Settings fields `SteppedMediaCard` owns; audio/video/html/markdown settings extend these. */
export interface SteppedMediaSettings extends BaseCardSettings, MediaSliderSettings, MediaLayoutSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  xAxis?: XAxisMode;
}

/** Builtin values of the shell-owned fields. */
export const steppedMediaBuiltin = { ...mediaSliderBuiltin, ...mediaLayoutBuiltin };

/** Shell-owned keys that take workspace / section defaults. */
export const STEPPED_MEDIA_CASCADE = [...MEDIA_SLIDER_CASCADE, ...MEDIA_LAYOUT_CASCADE] as const;

export function steppedMediaInstanceDefaults(seed: { name: string }): Partial<SteppedMediaSettings> {
  return { metrics: [seed] };
}
