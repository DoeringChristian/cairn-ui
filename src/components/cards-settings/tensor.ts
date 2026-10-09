import type { Colormap } from "../../charts/colormaps";
import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

export type TensorViewMode = "stats" | "histogram" | "heatmap";

export interface TensorSettings extends SteppedMediaSettings {
  viewMode: TensorViewMode;
  colormap: Colormap;
  logY: boolean;
  bins: number;
  /** Indices for all-but-last-two dimensions when slicing an ND tensor. */
  sliceIndices?: number[];
}

export const builtin: TensorSettings = {
  ...steppedMediaBuiltin,
  version: 1,
  metrics: [],
  viewMode: "heatmap",
  colormap: "turbo",
  logY: false,
  bins: 64,
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<TensorSettings>;

export const meta: CardSettingsMeta<TensorSettings> = {
  builtin,
  cascadeKeys: ["viewMode", "colormap", "logY", "bins", ...STEPPED_MEDIA_CASCADE],
  tabs: ["values", "display"],
};
