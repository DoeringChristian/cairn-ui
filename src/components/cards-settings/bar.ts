import type { BaseCardSettings } from "../card-kit/base-settings";
import type { BarCompareMode } from "../../charts/BarChart";
import type { CardSettingsMeta } from "./meta";

export interface BarMetricDef {
  key: string;
  source: "param" | "metric";
}
export type BarAggregation = "last" | "min" | "max" | "mean";
export type BarSortBy = "value" | "name";

export interface BarSettings extends BaseCardSettings {
  metric: BarMetricDef | null;
  aggregation: BarAggregation;
  sortBy: BarSortBy;
  sortDesc?: boolean;
  logX?: boolean;
  /**
   * How to compose multiple runs' bars against each other. Only surfaced in
   * settings (and only affects rendering) when the card has more than one
   * run; single-run cards always render a single bar regardless of this
   * setting. Undefined == "grouped" (one row per run).
   */
  compareMode?: BarCompareMode;
}

export const builtin: BarSettings = {
  version: 1,
  metric: null,
  aggregation: "last",
  sortBy: "value",
  sortDesc: true,
};

export function instanceDefaults(): Partial<BarSettings> {
  return {};
}

export const meta: CardSettingsMeta<BarSettings> = {
  builtin,
  cascadeKeys: ["aggregation", "sortBy", "sortDesc"],
  tabs: ["data", "display"],
};
