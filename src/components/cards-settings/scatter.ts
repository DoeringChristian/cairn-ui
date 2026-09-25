import type { BaseCardSettings } from "../card-kit/base-settings";
import type { Better } from "../../lib/plot-utils/pareto";
import type { RefLine, RunningStat } from "../../lib/plot-utils/scatter-extras";
import type { ScalarExprDef } from "../../lib/scalar-exprs";
import type { RangeValue } from "../settings/palette/logic";
import type { CardSettingsMeta } from "./meta";

export interface ScatterSettings extends BaseCardSettings {
  /** One scalar per run for each axis (`config.lr`, `min(val.loss)`, …). */
  x: ScalarExprDef | null;
  y: ScalarExprDef | null;
  /** Colours the points by value (a colour scale); null = each run's colour. */
  color: ScalarExprDef | null;
  /** Axis bounds (null = auto) and log scale. */
  xRange: RangeValue;
  yRange: RangeValue;
  showPareto: boolean;
  /** Which way is better on each axis; unset = from the metric's summary rule, else "min". */
  paretoX?: Better;
  paretoY?: Better;
  /** With the Pareto front: fade the points off the front. */
  dimNonFrontier: boolean;
  /** Running min / max / mean of y as x grows, as lines. */
  running: RunningStat[];
  /** A least-squares line (fitted in log space on log axes). */
  regression: boolean;
  /** Up to 5 dotted reference lines. */
  refLines: RefLine[];
  /** A point's name in its tooltip, e.g. `${run.name} lr=${config.lr}`; empty = the run label. */
  labelTemplate: string;
  /** Extra scalar expressions listed in the tooltip. */
  tooltipFields: string[];
}

const AUTO_RANGE: RangeValue = { min: null, max: null, log: false };

export const builtin: ScatterSettings = {
  version: 1,
  x: null,
  y: null,
  color: null,
  xRange: AUTO_RANGE,
  yRange: AUTO_RANGE,
  showPareto: false,
  dimNonFrontier: false,
  running: [],
  regression: false,
  refLines: [],
  labelTemplate: "",
  tooltipFields: [],
};

/** A fresh card's starting point, e.g. a sweep's params and metric. */
export function instanceDefaults(seed?: Partial<ScatterSettings>): Partial<ScatterSettings> {
  return seed ?? {};
}

export const meta: CardSettingsMeta<ScatterSettings> = {
  builtin,
  cascadeKeys: ["showPareto", "dimNonFrontier", "running", "regression"],
  tabs: ["data", "display"],
};
