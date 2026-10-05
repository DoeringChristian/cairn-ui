import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

/** The iframe's height bounds (auto height and the fixed-height slider). */
export const HTML_MIN_HEIGHT = 80;
export const HTML_MAX_HEIGHT = 2000;

export interface HtmlSettings extends SteppedMediaSettings {
  /** Auto-size the iframe to its content height via the resize shim. */
  autoHeight: boolean;
  /** Used when autoHeight is off, or before the first resize message. */
  fixedHeight: number;
}

export const builtin: HtmlSettings = {
  ...steppedMediaBuiltin,
  version: 1,
  metrics: [],
  autoHeight: true,
  fixedHeight: 300,
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<HtmlSettings>;

export const meta: CardSettingsMeta<HtmlSettings> = {
  builtin,
  cascadeKeys: ["autoHeight", "fixedHeight", ...STEPPED_MEDIA_CASCADE],
  tabs: ["values", "display"],
};
