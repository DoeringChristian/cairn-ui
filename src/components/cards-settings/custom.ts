import type { CardSettingsMeta } from "./meta";

import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

/** Settings of a custom viewer card (`custom`): which viewer, its own settings, the shared view. */
export interface CustomSettings extends SteppedMediaSettings {
  /** The viewer's name; absent: the default viewer of the data's kind (lib/custom/viewers.ts defaultViewerName). */
  viewer?: string;
  /** Pin a published version (`vN`); absent/null follows `latest` (or a live dev source). */
  viewer_version?: number | null;
  /** A viewer setting's value: `vs:<viewer>:<key>` (lib/custom/manifest.ts viewerSettingKey). */
  [viewerSetting: `vs:${string}`]: string | number | boolean | undefined;
  /** The view (camera) the card's panes share, as the viewer reported it. */
  view?: unknown;
  /** Reference tag: compare viewers get it as input B, others show it as a pane beside A. */
  reference?: { name: string };
  /** Fixed reference step; absent follows the slider. */
  referenceStep?: number;
}

export const builtin: CustomSettings = {
  ...steppedMediaBuiltin,
  version: 1,
  metrics: [],
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<CustomSettings>;

export const meta: CardSettingsMeta<CustomSettings> = {
  builtin,
  // Viewer settings take section/workspace defaults per viewer and setting (`vs:<viewer>:<key>`);
  // the viewer itself is per card (different kinds want different viewers).
  cascadeKeys: ["vs:*" as keyof CustomSettings & string, ...STEPPED_MEDIA_CASCADE],
  tabs: [],
};
