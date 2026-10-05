import type { BaseCardSettings } from "../card-kit/base-settings";
import { plotCardPolicy } from "../card-kit/plot-card-policy.ts";
import type { CardSettingsMeta } from "./meta";
import {
  MEDIA_COMPARE_CASCADE,
  MEDIA_LAYOUT_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaCompareBuiltin,
  mediaLayoutBuiltin,
  mediaSliderBuiltin,
  type MediaCompareSettings,
  type MediaLayoutSettings,
  type MediaSliderSettings,
} from "./media.ts";

export interface ImageCardSettings extends BaseCardSettings, MediaSliderSettings, MediaLayoutSettings, MediaCompareSettings {
  showLabels: boolean;
  /** Overlay annotations (boxes/masks logged with the image). */
  showBoxes: boolean;
  showMasks: boolean;
  maskOpacity: number;
  minScore: number;
  hiddenClasses: number[];
}

export const builtin: ImageCardSettings = {
  version: 1,
  colSpan: plotCardPolicy("image").colSpan,
  ...mediaSliderBuiltin,
  ...mediaLayoutBuiltin,
  ...mediaCompareBuiltin,
  showLabels: true,
  showBoxes: true,
  showMasks: true,
  maskOpacity: 0.5,
  minScore: 0,
  hiddenClasses: [],
};

export function instanceDefaults(_seed: { name: string }): Partial<ImageCardSettings> {
  return {};
}

export const meta: CardSettingsMeta<ImageCardSettings> = {
  builtin,
  cascadeKeys: [
    "showLabels",
    ...MEDIA_COMPARE_CASCADE,
    "showBoxes",
    "showMasks",
    "maskOpacity",
    "minScore",
    ...MEDIA_SLIDER_CASCADE,
    ...MEDIA_LAYOUT_CASCADE,
  ],
  tabs: ["values", "display"],
};
