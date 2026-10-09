import type { BaseCardSettings } from "../card-kit/base-settings";
import type { Colormap } from "../../charts/colormaps";
import type { CardSettingsMeta } from "./meta";
import { mediaIndexBuiltin, type MediaIndexSettings } from "./media.ts";

export interface HistogramSettings extends BaseCardSettings, MediaIndexSettings {
  /**
   * Heatmap: the histograms over the x axis (one strip per run, or per
   * innermost group when the workspace is grouped; colour = density).
   * Bars: one step's histograms, picked with the step slider.
   */
  viewMode: "heatmap" | "bars";
  logY: boolean;
  colormap: Colormap;
  sliderStep?: number;
  /** The heatmap's x axis, and the slider's labels. */
  xAxis: "step" | "relative_time" | "wall_time";
}

export const builtin: HistogramSettings = {
  version: 1,
  ...mediaIndexBuiltin,
  viewMode: "heatmap",
  logY: false,
  colormap: "blues",
  xAxis: "step",
};

export function instanceDefaults(_seed: { name: string }): Partial<HistogramSettings> {
  return {};
}

export const meta: CardSettingsMeta<HistogramSettings> = {
  builtin,
  cascadeKeys: ["viewMode", "logY", "colormap", "xAxis"],
  tabs: ["values", "display"],
};
