import type { CardSettingsMeta } from "./meta";
import { steppedMediaInstanceDefaults, type SteppedMediaSettings } from "./stepped-media.ts";

export interface VideoSettings extends SteppedMediaSettings {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
}

export const builtin: VideoSettings = {
  version: 1,
  metrics: [],
  autoplay: false,
  loop: false,
  muted: false,
  preload: "metadata",
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<VideoSettings>;

export const meta: CardSettingsMeta<VideoSettings> = {
  builtin,
  cascadeKeys: ["autoplay", "loop", "muted", "preload"],
  tabs: ["display"],
};
