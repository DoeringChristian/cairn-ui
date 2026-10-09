import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export interface ScalarsSettings extends BaseCardSettings {
  /** Status, duration, created, user and host as the first columns. */
  showRunInfo: boolean;
  /** The column the rows are sorted by (`label`: the row label, else a column key); null: as listed. */
  sort: { key: string; desc: boolean } | null;
  /** Column keys hidden from the header menu ("Hide column"). */
  hidden: string[];
}

export const builtin: ScalarsSettings = {
  version: 1,
  showRunInfo: true,
  sort: null,
  hidden: [],
};

export function instanceDefaults(): Partial<ScalarsSettings> {
  return {};
}

export const meta: CardSettingsMeta<ScalarsSettings> = {
  builtin,
  cascadeKeys: ["showRunInfo"],
  tabs: ["display"],
};
