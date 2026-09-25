import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export type ImportanceMethod = "importance" | "correlation";

export interface ImportanceSettings extends BaseCardSettings {
  metric: string | null;
  method: ImportanceMethod;
}

export const builtin: ImportanceSettings = {
  version: 1,
  metric: null,
  method: "importance",
};

export function instanceDefaults(): Partial<ImportanceSettings> {
  return {};
}

export const meta: CardSettingsMeta<ImportanceSettings> = {
  builtin,
  cascadeKeys: ["method"],
  tabs: ["data"],
};
