import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

export interface AudioSettings extends SteppedMediaSettings {
  autoplay: boolean;
}

export const builtin: AudioSettings = {
  ...steppedMediaBuiltin,
  version: 1,
  metrics: [],
  autoplay: false,
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<AudioSettings>;

export const meta: CardSettingsMeta<AudioSettings> = {
  builtin,
  cascadeKeys: ["autoplay", ...STEPPED_MEDIA_CASCADE],
  tabs: [],
};
