import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { AxisScale } from "../../lib/plot-utils/types";
import type { SmoothingKind } from "../../lib/plot-utils/smooth";
import type { AggKind, BandKind } from "../../lib/plot-utils/aggregate";
import type { StackMode } from "../../lib/plot-utils/stack";
import { plotCardPolicy } from "../card-kit/plot-card-policy.ts";
import type { CardSettingsMeta } from "./meta";

export interface ScalarGroupBy {
  source: "group" | "job_type" | "param";
  /** The param key (source "param" only). */
  key: string;
}

export type LineDash = "solid" | "dashed" | "dotted";

/** A per-series look; unset fields keep the automatic one. */
export type SeriesStyle = {
  color?: string;
  width?: number;
  dash?: LineDash;
};

/** A series computed from the run's metrics with an expression (`loss / step`). */
export type DerivedSeries = {
  src: string;
  /** Legend label; default the expression. */
  label?: string;
  style?: SeriesStyle;
};

export type LegendPosition = "bottom" | "top" | "right";

export interface ScalarSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  /**
   * The x-axis: an expression over the run, evaluated on each line's steps
   * (`step`, `wall_time`, `relative_time`, a metric such as `epoch`, or
   * `step * 32`). A metric is joined as of each step.
   */
  x: string;
  xScale: AxisScale;
  yScale: AxisScale;
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  smoothing: number;
  smoothingKind: SmoothingKind;
  outlierPct: [number, number];
  /** Draw at most this many runs (after hidden runs and `latestPerGroup`); null is all. */
  maxRuns: number | null;
  /** Collapse runs sharing a group / job type / param value into a centre line and band. */
  groupBy: ScalarGroupBy | null;
  /** The group's centre line. */
  agg: AggKind;
  band: BandKind;
  /** Draw only each group's centre and band, not its runs. */
  hideMembers: boolean;
  /** Keep only the newest run of each group (the `groupBy` value, else the run's group). */
  latestPerGroup: boolean;
  lineType: "linear" | "monotone" | "step" | "stepBefore" | "stepAfter";
  /** `template`: `${…}` text per run (`${run.name} lr=${config.lr}`); empty is the automatic label. */
  legend: { show: boolean; position: LegendPosition; template: string };
  /** `template`: the tooltip row's label, as the legend's. */
  tooltip: { template: string; showWallTime: boolean };
  /** Axis titles; empty draws none. */
  axisTitles: { x: string; y: string };
  /** Keep the faded raw line under a smoothed one. */
  showOriginal: boolean;
  stack: StackMode;
  /** Min/max bucketing per pixel (recomputed on zoom) with a min–max band. */
  fullFidelity: boolean;
  /** Per-series look by series key (`seriesKey` of a metric, or `expr:<i>`). */
  styles: Record<string, SeriesStyle>;
  /** Derived series (Expressions tab), drawn for every run. */
  derived: DerivedSeries[];
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
  x: "step",
  xScale: "linear",
  yScale: "linear",
  xRange: [null, null],
  yRange: [null, null],
  smoothing: 0,
  smoothingKind: "ema",
  outlierPct: [0, 100],
  maxRuns: null,
  groupBy: { source: "group", key: "" },
  agg: "mean",
  band: "std",
  hideMembers: false,
  latestPerGroup: false,
  lineType: "linear",
  legend: { show: true, position: "bottom", template: "" },
  tooltip: { template: "", showWallTime: true },
  axisTitles: { x: "", y: "" },
  showOriginal: true,
  stack: "none",
  fullFidelity: false,
  styles: {},
  derived: [],
  viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
};

export function instanceDefaults(seed: { name: string }): Partial<ScalarSettings> {
  return { metrics: [seed] };
}

export const meta: CardSettingsMeta<ScalarSettings> = {
  builtin,
  cascadeKeys: [
    "x", "xScale", "yScale", "smoothing", "smoothingKind", "outlierPct", "maxRuns",
    "groupBy", "agg", "band", "hideMembers", "latestPerGroup",
    "lineType", "legend", "tooltip", "showOriginal", "stack", "fullFidelity",
  ],
  tabs: ["data", "grouping", "display", "expressions"],
};
