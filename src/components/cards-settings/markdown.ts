import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

export type MarkdownFontSize = "xs" | "sm" | "base";

export interface MarkdownSettings extends SteppedMediaSettings {
  fontSize: MarkdownFontSize;
}

export const builtin: MarkdownSettings = {
  ...steppedMediaBuiltin,
  version: 1,
  metrics: [],
  fontSize: "sm",
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<MarkdownSettings>;

export const meta: CardSettingsMeta<MarkdownSettings> = {
  builtin,
  cascadeKeys: ["fontSize", ...STEPPED_MEDIA_CASCADE],
  tabs: [],
};
