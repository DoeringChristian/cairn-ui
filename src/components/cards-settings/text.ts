import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export interface TextSettings extends BaseCardSettings {
  fontSize: "xs" | "sm" | "base";
  wordWrap: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
}

export const builtin: TextSettings = {
  version: 1,
  fontSize: "xs",
  wordWrap: true,
};

export function instanceDefaults(_seed: { name: string }): Partial<TextSettings> {
  return {};
}

export const meta: CardSettingsMeta<TextSettings> = {
  builtin,
  cascadeKeys: ["fontSize", "wordWrap"],
  tabs: [],
};
