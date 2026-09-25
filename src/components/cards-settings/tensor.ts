import type { BaseCardSettings } from "../card-kit/base-settings";
import type { Colormap } from "../../charts/colormaps";
import type { CardSettingsMeta } from "./meta";

export type TensorViewMode = "stats" | "histogram" | "heatmap";

export interface TensorSettings extends BaseCardSettings {
  viewMode: TensorViewMode;
  colormap: Colormap;
  logY: boolean;
  bins: number;
  /** Indices for all-but-last-two dimensions when slicing an ND tensor. */
  sliceIndices?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

export const builtin: TensorSettings = {
  version: 1,
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
  cascadeKeys: ["viewMode", "colormap", "logY", "bins"],
  tabs: ["data", "display"],
};
