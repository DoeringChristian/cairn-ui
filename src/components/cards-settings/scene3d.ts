import type { BaseCardSettings } from "../card-kit/base-settings";
import type { SeriesRef } from "../card-kit/use-card-series";
import type { CardSettingsMeta } from "./meta";

/** Settings shared by the pointcloud / mesh / boxes3d cards; `view` holds the kind's own view options. */
export interface Scene3DSettings<V = Record<string, unknown>> extends BaseCardSettings {
  metrics: SeriesRef[];
  sliderStep?: number;
  syncCameras: boolean;
  view: Partial<V>;
}

export function scene3dMeta(): CardSettingsMeta<Scene3DSettings> {
  return {
    builtin: { version: 1, metrics: [], syncCameras: true, view: {} },
    cascadeKeys: ["syncCameras"],
    tabs: ["display"],
  };
}

export function scene3dInstanceDefaults(seed: { name: string }): Partial<Scene3DSettings> {
  return { metrics: [seed] };
}
