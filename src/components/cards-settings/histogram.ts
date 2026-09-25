import type { BaseCardSettings } from "../card-kit/base-settings";
import type { Colormap } from "../../charts/colormaps";
import type { CardSettingsMeta } from "./meta";

export interface HistogramSettings extends BaseCardSettings {
  viewMode: "bars" | "heatmap";
  logY: boolean;
  colormap: Colormap;
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

export const builtin: HistogramSettings = {
  version: 1,
  viewMode: "bars",
  logY: false,
  colormap: "turbo",
};

export function instanceDefaults(_seed: { name: string }): Partial<HistogramSettings> {
  return {};
}

export const meta: CardSettingsMeta<HistogramSettings> = {
  builtin,
  cascadeKeys: ["viewMode", "logY", "colormap"],
  tabs: ["data", "display"],
};
