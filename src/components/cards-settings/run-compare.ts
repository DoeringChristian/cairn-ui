import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export type RunCompareSection = "metrics" | "params" | "env";

export interface RunCompareSettings extends BaseCardSettings {
  /** The tables shown, in this order. */
  sections: RunCompareSection[];
  /** Hide rows that are the same in every run. */
  onlyDiffs: boolean;
  /** Case-insensitive key substring; empty shows every key. */
  filter: string;
  /** Keys shown first in every table, whatever the filters say. */
  pinnedKeys: string[];
}

export const builtin: RunCompareSettings = {
  version: 1,
  sections: ["metrics", "params", "env"],
  onlyDiffs: true,
  filter: "",
  pinnedKeys: [],
  colSpan: 6,
};

export function instanceDefaults(): Partial<RunCompareSettings> {
  return {};
}

export const meta: CardSettingsMeta<RunCompareSettings> = {
  builtin,
  cascadeKeys: ["sections", "onlyDiffs"],
  tabs: ["data", "display"],
};
