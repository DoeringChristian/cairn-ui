import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

/** The volume card's fallback renderer (no WebGL2): the stepped media shell's settings only. */
export type VolumeSettings = SteppedMediaSettings;

export const builtin: VolumeSettings = { ...steppedMediaBuiltin, version: 1, metrics: [] };

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<VolumeSettings>;

export const meta: CardSettingsMeta<VolumeSettings> = {
  builtin,
  cascadeKeys: [...STEPPED_MEDIA_CASCADE],
  tabs: ["values", "display"],
};
