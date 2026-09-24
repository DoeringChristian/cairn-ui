// Sizing convention: card renderers derive their size from a ResizeObserver
// on their own box, or from controlled width/height props/settings threaded
// down from CardShell — never from `window` resize listeners or a one-shot measurement
// taken once at mount. CardShell/CardResizeHandle own the outer card box
// (including the per-type minimums in ./card-min-sizes); content below that
// should react continuously to its own box, not assume a size that was true
// only when it first rendered.

export type { BaseCardSettings } from "./base-settings";
export { useCardSeries } from "./use-card-series";
export { useIframeAutoHeight } from "./use-iframe-auto-height";
export type { IframeAutoHeightOptions } from "./use-iframe-auto-height";
export { resolveAtStep } from "./resolve-at-step";
export { useOverlaySlot } from "./use-overlay-slot";
export type { OverlaySlot } from "./use-overlay-slot";
export { useStepSlider } from "./use-step-slider";
export { useRunInfo, buildRunInfoMap } from "./use-run-info";
export { default as MultiPaneGrid } from "./MultiPaneGrid";
