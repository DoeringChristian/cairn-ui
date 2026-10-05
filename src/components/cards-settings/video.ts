import type { CardSettingsMeta } from "./meta";
import { MEDIA_COMPARE_CASCADE, mediaCompareBuiltin, type MediaCompareSettings } from "./media.ts";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

export interface VideoSettings extends SteppedMediaSettings, MediaCompareSettings {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
  /** Several panes play, pause and seek together on one transport bar. */
  syncPlayback: boolean;
}

export const builtin: VideoSettings = {
  ...steppedMediaBuiltin,
  ...mediaCompareBuiltin,
  version: 1,
  metrics: [],
  autoplay: false,
  loop: false,
  muted: false,
  preload: "metadata",
  syncPlayback: true,
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<VideoSettings>;

export const meta: CardSettingsMeta<VideoSettings> = {
  builtin,
  cascadeKeys: ["autoplay", "loop", "muted", "preload", "syncPlayback", ...MEDIA_COMPARE_CASCADE, ...STEPPED_MEDIA_CASCADE],
  tabs: ["values", "display"],
};
