import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { CardSettingsMeta } from "./meta";
import {
  MEDIA_LAYOUT_CASCADE,
  MEDIA_SLIDER_CASCADE,
  mediaLayoutBuiltin,
  mediaSliderBuiltin,
  type MediaLayoutSettings,
  type MediaSliderSettings,
} from "./media.ts";

/** Settings shared by the pointcloud / mesh / boxes3d cards; `view` holds the kind's own view options. */
export interface Scene3DSettings<V = Record<string, unknown>>
  extends BaseCardSettings, MediaSliderSettings, MediaLayoutSettings {
  metrics: SeriesRef[];
  syncCameras: boolean;
  view: Partial<V>;
}

export function scene3dMeta(): CardSettingsMeta<Scene3DSettings> {
  return {
    builtin: { version: 1, ...mediaSliderBuiltin, ...mediaLayoutBuiltin, galleryContent: "run", metrics: [], syncCameras: true, view: {} },
    cascadeKeys: ["syncCameras", ...MEDIA_SLIDER_CASCADE, ...MEDIA_LAYOUT_CASCADE],
    tabs: ["values", "display"],
  };
}

export function scene3dInstanceDefaults(seed: { name: string }): Partial<Scene3DSettings> {
  return { metrics: [seed] };
}
