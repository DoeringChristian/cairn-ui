import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { AxisSource, XMetricRef } from "../../lib/plot-utils/x-axis";
import type { AxisScale } from "../../lib/plot-utils/types";
import type { SmoothingKind } from "../../lib/plot-utils/smooth";
import type { BandKind } from "../../lib/plot-utils/aggregate";
import { plotCardPolicy } from "../card-kit/plot-card-policy.ts";
import type { CardSettingsMeta } from "./meta";

export interface ScalarGroupBy {
  source: "group" | "job_type" | "param";
  /** The param key (source "param" only). */
  key: string;
}

export interface ScalarSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  xAxis: AxisSource;
  /** The series an `xAxis: "metric"` card plots against (joined on step). */
  xMetric?: XMetricRef;
  xScale: AxisScale;
  yScale: AxisScale;
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  smoothing: number;
  smoothingKind: SmoothingKind;
  outlierPct: [number, number];
  lineType: "linear" | "monotone" | "step" | "stepBefore" | "stepAfter";
  showLegend: boolean;
  tooltip: { showWallTime: boolean };
  /** Collapse runs sharing a group / job type / param value into mean ± band. */
  groupBy: ScalarGroupBy | null;
  band: BandKind;
  /** Draw only each group's mean and band, not its runs. */
  hideMembers: boolean;
  viewport: {
    xMin: number | null;
    xMax: number | null;
    yMin: number | null;
    yMax: number | null;
  };
}

export const builtin: ScalarSettings = {
  version: 1,
  colSpan: plotCardPolicy("scalar").colSpan,
  metrics: [],
  xAxis: "step",
  xScale: "linear",
  yScale: "linear",
  xRange: [null, null],
  yRange: [null, null],
  smoothing: 0,
  smoothingKind: "ema",
  outlierPct: [0, 100],
  lineType: "linear",
  showLegend: true,
  tooltip: { showWallTime: true },
  groupBy: { source: "group", key: "" },
  band: "std",
  hideMembers: false,
  viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
};

export function instanceDefaults(seed: { name: string }): Partial<ScalarSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<ScalarSettings> = {
  builtin,
  cascadeKeys: [
    "xAxis", "xScale", "yScale", "smoothing", "smoothingKind", "outlierPct", "lineType",
    "showLegend", "tooltip", "groupBy", "band", "hideMembers",
  ],
  tabs: ["data", "grouping", "display"],
};
