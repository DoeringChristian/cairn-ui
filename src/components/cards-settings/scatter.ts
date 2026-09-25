import type { BaseCardSettings } from "../card-kit/base-settings";
import type { Better } from "../../lib/plot-utils/pareto";
import type { CardSettingsMeta } from "./meta";

export interface ScatterAxisDef {
  key: string;
  source: "param" | "metric";
}

export interface ScatterSettings extends BaseCardSettings {
  xAxis: ScatterAxisDef | null;
  yAxis: ScatterAxisDef | null;
  colorAxis: ScatterAxisDef | null;
  xLog?: boolean;
  yLog?: boolean;
  showPareto?: boolean;
  /** Which way is better on each axis; unset = from the metric's summary rule, else "min". */
  paretoX?: Better;
  paretoY?: Better;
}

export const builtin: ScatterSettings = {
  version: 1,
  xAxis: null,
  yAxis: null,
  colorAxis: null,
};

/** A fresh card's starting point, e.g. a sweep's params and metric. */
export function instanceDefaults(seed?: Partial<ScatterSettings>): Partial<ScatterSettings> {
  return seed ?? {};
}

export const meta: CardSettingsMeta<ScatterSettings> = { builtin, cascadeKeys: [], tabs: ["data", "display"] };
