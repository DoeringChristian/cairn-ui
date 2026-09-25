import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import { plotCardPolicy } from "../card-kit/plot-card-policy.ts";
import type { CardSettingsMeta } from "./meta";

export type HoverMode = "closest" | "x unified" | "y unified" | "none";
export type DragMode = "zoom" | "pan" | "select" | "lasso" | "none";

/**
 * Multi-run figure display mode:
 * - "panes": one figure per (run, metric) side by side (default, unchanged).
 * - "overlay": every run's figure traces merged into a single plot — only
 *   available when `checkFigureMergeable` passes (see figure-merge.ts).
 */
export type FigureCompareMode = "panes" | "overlay";

export interface FigureSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  sliderStep?: number;
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Multi-run display mode. Defaults to "panes" — behavior-preserving. */
  figureCompare?: FigureCompareMode;
}

export const builtin: FigureSettings = {
  version: 1,
  colSpan: plotCardPolicy("figure").colSpan,
  metrics: [],
  displayModeBar: false,
  scrollZoom: true,
  hoverMode: "closest",
  dragMode: "zoom",
  showLegend: true,
};

export function instanceDefaults(seed: { name: string }): Partial<FigureSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<FigureSettings> = {
  builtin,
  cascadeKeys: ["displayModeBar", "scrollZoom", "hoverMode", "dragMode", "showLegend"],
  tabs: ["display"],
};
