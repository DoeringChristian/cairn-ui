import type { BaseCardSettings } from "../card-kit/base-settings";
import type { ParallelColumn } from "../../charts/ParallelChart";
import type { CardSettingsMeta } from "./meta";

export interface ParallelSettings extends BaseCardSettings {
  columns: ParallelColumn[];
}

export const builtin: ParallelSettings = { version: 1, columns: [] };

/** A fresh card's starting point, e.g. a sweep's params and metric. */
export function instanceDefaults(seed?: Partial<ParallelSettings>): Partial<ParallelSettings> {
  return seed ?? {};
}

export const meta: CardSettingsMeta<ParallelSettings> = { builtin, cascadeKeys: [], tabs: ["data"] };
