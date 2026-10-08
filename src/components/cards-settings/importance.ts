import type { BaseCardSettings } from "../card-kit/base-settings";
import type { ImportanceSort } from "../../lib/plot-utils/importance";
import type { CardSettingsMeta } from "./meta";

export interface ImportanceSettings extends BaseCardSettings {
  /** The metric the params should explain (its final value per run); null: the first metric with a goal. */
  metric: string | null;
  /** The rows' order (descending): by importance or by the correlation's strength. */
  sort: ImportanceSort;
}

export const builtin: ImportanceSettings = {
  version: 1,
  metric: null,
  sort: "importance",
};

export const meta: CardSettingsMeta<ImportanceSettings> = {
  builtin,
  cascadeKeys: [],
  tabs: ["values"],
};
