import type { CardSettingsMeta } from "./meta";
import {
  STEPPED_MEDIA_CASCADE,
  steppedMediaBuiltin,
  steppedMediaInstanceDefaults,
  type SteppedMediaSettings,
} from "./stepped-media.ts";

/** Settings of a custom viewer card (`custom`): which viewer, its own settings, the shared view. */
export interface CustomSettings extends SteppedMediaSettings {
  /** The viewer's name; absent picks the most specific viewer accepting the data. */
  viewer?: string;
  /** Pin a published version (`vN`); absent/null follows `latest` (or a live dev source). */
  viewer_version?: number | null;
  /** Values of the viewer's manifest settings, by key (kept per card; foreign keys are ignored). */
  viewerSettings: Record<string, string | number | boolean>;
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
  viewerSettings: {},
};

export const instanceDefaults = steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<CustomSettings>;

export const meta: CardSettingsMeta<CustomSettings> = {
  builtin,
  // The viewer and its settings carry over as section/workspace defaults like any card setting.
  cascadeKeys: ["viewer", "viewerSettings", ...STEPPED_MEDIA_CASCADE],
  tabs: [],
};
