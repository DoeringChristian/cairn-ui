import type { BaseCardSettings } from "../card-kit/base-settings";
import { plotCardPolicy } from "../card-kit/plot-card-policy.ts";
import type { CardSettingsMeta } from "./meta";
import type { ImageRendering } from "../image/ImagePane";
import {
  MEDIA_LAYOUT_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaLayoutBuiltin,
  mediaSliderBuiltin,
  type MediaLayoutSettings,
  type MediaSliderSettings,
} from "./media.ts";

export interface ImageCardSettings extends BaseCardSettings, MediaSliderSettings, MediaLayoutSettings {
  showLabels: boolean;
  /** Upscaling: auto (nearest-neighbour once zoomed in), smooth or pixelated. */
  rendering: ImageRendering;
  /** Reference tag; every pane compares against this tag from its own run. */
  reference?: { name: string };
  /** Fixed reference step; absent follows the slider. */
  referenceStep?: number;
  /** Divider position (fraction of pane width), shared by all panes. */
  split: number;
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
  showLabels: true,
  rendering: "auto",
  split: 0.5,
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
    "rendering",
    "split",
    "showBoxes",
    "showMasks",
    "maskOpacity",
    "minScore",
    ...MEDIA_SLIDER_CASCADE,
    ...MEDIA_LAYOUT_CASCADE,
  ],
  tabs: ["data", "display"],
};
