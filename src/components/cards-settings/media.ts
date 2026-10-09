/**
 * Settings fragments every media card shares: the slider (its key, its
 * persisted value, following the section) and the pane layout.
 */
import type { CompareSlot, Columns, PanelMode } from "../../lib/media/panel-layout.ts";
import type { CompareLinks, GalleryContent, IndexSelection, MediaAxis } from "../../lib/media/media-plan.ts";
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

/**
 * Which items of a logged list (a gallery point) the card shows: All, One,
 * Range or First N (see media-plan.ts `selectIndices`). Per card: the
 * indices belong to the card's data.
 */
export type MediaIndexSettings = IndexSelection;

export const mediaIndexBuiltin: MediaIndexSettings = {
  indexMode: "all",
  indexOne: 0,
  indexFrom: 0,
  indexTo: 3,
  indexFirst: 4,
};

/**
 * Gallery / grid / compare and the media limit, for cards that lay out one
 * artifact per tile (see media-plan.ts for what each setting means).
 */
export interface MediaLayoutSettings extends MediaColumnsSettings, MediaIndexSettings, CompareLinks {
  panelMode: PanelMode;
  /** Gallery: what one tile is — a list item, a step, or a run. */
  galleryContent: GalleryContent;
  /** Grid: the two axes (distinct). */
  gridX: MediaAxis;
  gridY: MediaAxis;
  /** Grid: the step axis range in slider values (null: open); per card. */
  gridStepFrom: number | null;
  gridStepTo: number | null;
  /** Grid: at most this many rows. */
  gridRows: number;
  /** Compare mode's slots; per card. */
  compareSlots?: CompareSlot[];
  /** Media limit: off shows every tile, on at most `mediaLimit`. */
  limitMedia: boolean;
  mediaLimit: number;
}

export const mediaLayoutBuiltin: MediaLayoutSettings = {
  ...mediaColumnsBuiltin,
  ...mediaIndexBuiltin,
  panelMode: "gallery",
  galleryContent: "run",
  gridX: "step",
  gridY: "run",
  gridStepFrom: null,
  gridStepTo: null,
  gridRows: 30,
  compareRun: "individual",
  compareStep: "linked",
  compareIndex: "linked",
  limitMedia: false,
  mediaLimit: 25,
};

export const MEDIA_LAYOUT_CASCADE = [
  ...MEDIA_COLUMNS_CASCADE,
  "panelMode",
  "galleryContent",
  "gridX",
  "gridY",
  "gridRows",
  "compareRun",
  "compareStep",
  "compareIndex",
  "limitMedia",
  "mediaLimit",
] as const;

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
