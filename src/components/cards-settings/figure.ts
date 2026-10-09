import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import { plotCardPolicy } from "../card-kit/plot-card-policy.ts";
import type { CardSettingsMeta } from "./meta";
import {
  MEDIA_LAYOUT_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaLayoutBuiltin,
  mediaSliderBuiltin,
  type MediaLayoutSettings,
  type MediaSliderSettings,
} from "./media.ts";

export type HoverMode = "closest" | "x unified" | "y unified" | "none";
export type DragMode = "zoom" | "pan" | "select" | "lasso" | "none";

/**
 * Multi-run figure display mode:
 * - "panes": one figure per (run, metric) side by side (default, unchanged).
 * - "overlay": every run's figure traces merged into a single plot — only
 *   available when `checkFigureMergeable` passes (see figure-merge.ts).
 */
export type FigureCompareMode = "panes" | "overlay";

/**
 * Draw `scatter` traces with WebGL (`scattergl`): "auto" only for figures
 * with at least 1000 scatter points, "on" always, "off" never. Traces using
 * what scattergl lacks stay SVG; the stored figure is never changed (see
 * lib/plot-utils/webgl.ts). 3D traces always draw with WebGL.
 */
export type FigureWebGLMode = "auto" | "on" | "off";

export interface FigureSettings extends BaseCardSettings, MediaSliderSettings, MediaLayoutSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Multi-run display mode. Defaults to "panes" — behavior-preserving. */
  figureCompare?: FigureCompareMode;
  webgl: FigureWebGLMode;
}

export const builtin: FigureSettings = {
  version: 1,
  colSpan: plotCardPolicy("figure").colSpan,
  ...mediaSliderBuiltin,
  ...mediaLayoutBuiltin,
  metrics: [],
  displayModeBar: false,
  scrollZoom: true,
  hoverMode: "closest",
  dragMode: "zoom",
  showLegend: true,
  webgl: "auto",
};

export function instanceDefaults(seed: { name: string }): Partial<FigureSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<FigureSettings> = {
  builtin,
  cascadeKeys: [
    "displayModeBar",
    "scrollZoom",
    "hoverMode",
    "dragMode",
    "showLegend",
    "webgl",
    ...MEDIA_SLIDER_CASCADE,
    ...MEDIA_LAYOUT_CASCADE,
  ],
  tabs: ["values", "display"],
};
