import type { BaseCardSettings } from "../card-kit/base-settings";
import type { ParallelAxis } from "../../lib/parallel-coords";
import type { CardSettingsMeta } from "./meta";

export type ParallelColor = "gradient" | "runs";

export interface ParallelSettings extends BaseCardSettings {
  /** The metric (its final value per run); null: the first metric with a goal. */
  metric: string | null;
  /** The axes; null: the config keys that vary across the runs, then the metric. */
  axes: ParallelAxis[] | null;
  /** Line colour: a gradient by the last axis, or each run's / group's colour. */
  color: ParallelColor;
}

export const builtin: ParallelSettings = { version: 1, metric: null, axes: null, color: "gradient" };

/** A fresh card's starting point, e.g. a sweep's params and metric. */
export function instanceDefaults(seed?: Partial<ParallelSettings>): Partial<ParallelSettings> {
  return seed ?? {};
}

export const meta: CardSettingsMeta<ParallelSettings> = { builtin, cascadeKeys: [], tabs: ["values", "display"] };
