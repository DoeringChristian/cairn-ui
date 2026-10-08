import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export interface ConfigSettings extends BaseCardSettings {
  /** Hide the keys that are the same in every column. */
  onlyDiffs: boolean;
}

export const builtin: ConfigSettings = {
  version: 1,
  onlyDiffs: false,
  colSpan: 6,
};

export function instanceDefaults(): Partial<ConfigSettings> {
  return {};
}

export const meta: CardSettingsMeta<ConfigSettings> = {
  builtin,
  cascadeKeys: ["onlyDiffs"],
  tabs: ["display"],
};
