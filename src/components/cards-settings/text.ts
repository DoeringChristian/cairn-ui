import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

export interface TextSettings extends SteppedMediaSettings {
  fontSize: "xs" | "sm" | "base";
  wordWrap: boolean;
}

export const builtin: TextSettings = {
  ...steppedMediaBuiltin,
  version: 1,
  metrics: [],
  fontSize: "xs",
  wordWrap: true,
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<TextSettings>;

export const meta: CardSettingsMeta<TextSettings> = {
  builtin,
  cascadeKeys: ["fontSize", "wordWrap", ...STEPPED_MEDIA_CASCADE],
  tabs: ["values", "display"],
};
