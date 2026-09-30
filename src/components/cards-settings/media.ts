/**
 * Settings fragments every media card shares: the slider (its key, its
 * persisted value, following the section) and the pane layout.
 */
import type { CompareSlot, Columns, PanelMode } from "../../lib/media/panel-layout.ts";
import type { PixelRendering } from "../../lib/media/split-geometry.ts";

export interface MediaSliderSettings {
  /** The slider's persisted VALUE (a step, or the slider key's value); per card. */
  sliderStep?: number;
  /** `step`, or a scalar metric such as `epoch` looked up as of each step. */
  sliderKey: string;
  /** Follow the section's media slider when the section provides one. */
  followSection: boolean;
}

export const mediaSliderBuiltin: Pick<MediaSliderSettings, "sliderKey" | "followSection"> = {
  sliderKey: "step",
  followSection: true,
};

export const MEDIA_SLIDER_CASCADE = ["sliderKey", "followSection"] as const;

/** Pane grid columns and how many runs a multi-run card shows. */
export interface MediaColumnsSettings {
  columns: Columns;
  /** Show only the first N runs; 0 shows all. */
  maxRuns: number;
}

export const mediaColumnsBuiltin: MediaColumnsSettings = { columns: "auto", maxRuns: 0 };

export const MEDIA_COLUMNS_CASCADE = ["columns", "maxRuns"] as const;

/** Gallery / grid / compare, for cards that lay out one artifact per pane. */
export interface MediaLayoutSettings extends MediaColumnsSettings {
  panelMode: PanelMode;
  /** Compare mode's slots; per card. */
  compareSlots?: CompareSlot[];
  /** Compare slots follow the slider; per card. */
  compareLinked: boolean;
}

export const mediaLayoutBuiltin: MediaLayoutSettings = {
  ...mediaColumnsBuiltin,
  panelMode: "gallery",
  compareLinked: true,
};

export const MEDIA_LAYOUT_CASCADE = [...MEDIA_COLUMNS_CASCADE, "panelMode"] as const;

/**
 * A/B split against a reference, zoom rendering: cards whose panes are
 * zoomable split views (images, videos; see ZoomSplitPane).
 */
export interface MediaCompareSettings {
  /** Upscaling: auto (nearest-neighbour once zoomed in), smooth or pixelated. */
  rendering: PixelRendering;
  /** Reference tag; every pane compares against this tag from its own run. */
  reference?: { name: string };
  /** Fixed reference step; absent follows the slider. */
  referenceStep?: number;
  /** Divider position (fraction of pane width), shared by all panes. */
  split: number;
}

export const mediaCompareBuiltin: Pick<MediaCompareSettings, "rendering" | "split"> = {
  rendering: "auto",
  split: 0.5,
};

export const MEDIA_COMPARE_CASCADE = ["rendering", "split"] as const;
