import type { BaseCardSettings } from "../card-kit/base-settings";
import type { BarCompareMode } from "../../charts/BarChart";
import type { ScalarExprDef } from "../../lib/scalar-exprs";
import type { CardSettingsMeta } from "./meta";

export type BarSortBy = "value" | "name";
/** How each group is drawn when grouping: its mean as a bar, or its distribution. */
export type BarGroupPlot = "bar" | "box" | "violin" | "strip";

export interface BarSettings extends BaseCardSettings {
  /** One scalar per run (`last(acc)`, `min(val.loss)`, `config.lr`, …). */
  metric: ScalarExprDef | null;
  sortBy: BarSortBy;
  sortDesc?: boolean;
  logX?: boolean;
  /**
   * How to compose multiple runs' bars against each other (ungrouped bars
   * only). Only surfaced in settings (and only affects rendering) when the
   * card has more than one run. Undefined == "grouped" (one row per run).
   */
  compareMode?: BarCompareMode;
  /** Group runs by this value (`run.group`, `config.optimizer`, …); null = one bar per run. */
  groupBy: ScalarExprDef | null;
  /** Per group: the mean as a bar (± std), or a box / violin / strip of its runs. */
  groupPlot: BarGroupPlot;
}

export const builtin: BarSettings = {
  version: 1,
  metric: null,
  sortBy: "value",
  sortDesc: true,
  groupBy: null,
  groupPlot: "bar",
};

export function instanceDefaults(): Partial<BarSettings> {
  return {};
}

export const meta: CardSettingsMeta<BarSettings> = {
  builtin,
  cascadeKeys: ["sortBy", "sortDesc", "groupPlot"],
  tabs: ["data", "grouping", "display"],
};
