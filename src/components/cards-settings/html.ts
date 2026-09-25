import type { CardSettingsMeta } from "./meta";
import { steppedMediaInstanceDefaults, type SteppedMediaSettings } from "./stepped-media.ts";

export interface HtmlSettings extends SteppedMediaSettings {
  /** Auto-size the iframe to its content height via the resize shim. */
  autoHeight: boolean;
  /** Used when autoHeight is off, or before the first resize message. */
  fixedHeight: number;
}

export const builtin: HtmlSettings = { version: 1, metrics: [], autoHeight: true, fixedHeight: 300 };

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<HtmlSettings>;

export const meta: CardSettingsMeta<HtmlSettings> = {
  builtin,
  cascadeKeys: ["autoHeight", "fixedHeight"],
  tabs: [],
};
