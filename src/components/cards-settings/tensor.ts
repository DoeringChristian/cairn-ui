import type { BaseCardSettings } from "../card-kit/base-settings";
import type { Colormap } from "../../charts/colormaps";
import type { CardSettingsMeta } from "./meta";
import { MEDIA_SLIDER_CASCADE, mediaSliderBuiltin, type MediaSliderSettings } from "./media.ts";

export type TensorViewMode = "stats" | "histogram" | "heatmap";

export interface TensorSettings extends BaseCardSettings, MediaSliderSettings {
  viewMode: TensorViewMode;
  colormap: Colormap;
  logY: boolean;
  bins: number;
  /** Indices for all-but-last-two dimensions when slicing an ND tensor. */
  sliceIndices?: number[];
  xAxis?: "step" | "relative_time" | "wall_time";
}

export const builtin: TensorSettings = {
  version: 1,
  ...mediaSliderBuiltin,
  viewMode: "heatmap",
  colormap: "turbo",
  logY: false,
  bins: 64,
};

export function instanceDefaults(_seed: { name: string }): Partial<TensorSettings> {
  return {};
}

export const meta: CardSettingsMeta<TensorSettings> = {
  builtin,
  cascadeKeys: ["viewMode", "colormap", "logY", "bins", ...MEDIA_SLIDER_CASCADE],
  tabs: ["data", "display"],
};
