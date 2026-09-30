/**
 * Geometry of the zoomable A/B split view (ZoomSplitPane, used by image and
 * video panes): the divider, the cursor-anchored wheel zoom, and when
 * upscaled pixels turn crisp.
 *
 * The divider bar and the foreground's clip edge both come from `split`, as
 * a fraction of the pane's own (screen-space) width: the bar sits at
 * `left: split·100%`, the clip cuts at `inset(0 0 0 split·100%)` on a
 * layer OUTSIDE the zoom/pan transform. The zoomed content is transformed
 * inside that layer, so no zoom level, pan offset, letterbox or rounding can
 * move one without the other. (The old clip lived inside the transform in
 * content pixels, computed from a copy of the transform state; at high zoom
 * any difference between that copy and the applied transform, or between
 * integer `clientWidth` and the true width, was magnified by the scale.)
 *
 * Pure: tested in `split-geometry.test.ts`.
 */

export interface PaneTransform {
  scale: number;
  x: number;
  y: number;
}

export const clampSplit = (split: number): number => Math.min(1, Math.max(0, Number.isFinite(split) ? split : 0.5));

/** The divider bar's CSS `left`, in the pane's coordinates. */
export function splitBarLeft(split: number): string {
  return `${clampSplit(split) * 100}%`;
}

/**
 * The foreground layer's `clip-path`: keep everything right of the bar. The
 * reference shows on the left, the image (the method) on the right.
 */
export function splitClipPath(split: number): string {
  return `inset(0 0 0 ${clampSplit(split) * 100}%)`;
}

/** Screen-space x (pane px) of a content-space x under a zoom/pan transform (origin 0 0). */
export function contentToScreenX(contentX: number, t: PaneTransform): number {
  return t.x + contentX * t.scale;
}

/** Content-space x of a screen-space x (pane px). */
export function screenToContentX(screenX: number, t: PaneTransform): number {
  return (screenX - t.x) / t.scale;
}

/** Zoom range of a pane (1 = fitted). */
export const MIN_SCALE = 1;
export const MAX_SCALE = 64;
/** Zoom factor per wheel pixel: one mouse notch (~100px) ≈ ×1.35, trackpads stay smooth. */
export const WHEEL_ZOOM = 0.003;

/**
 * The transform after one wheel event at pane point (`mx`, `my`) of a
 * `width`×`height` pane: multiplicative zoom by `exp(-deltaY·WHEEL_ZOOM)`,
 * clamped to [MIN_SCALE, MAX_SCALE], keeping the content point under the
 * cursor fixed, then panned back inside the content bounds. `null` when the
 * scale is already at its limit in that direction (nothing to do).
 */
export function wheelZoom(
  t: PaneTransform,
  deltaY: number,
  mx: number,
  my: number,
  width: number,
  height: number,
): PaneTransform | null {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * Math.exp(-deltaY * WHEEL_ZOOM)));
  if (next === t.scale) return null;
  const clampPos = (p: number, size: number) => Math.min(0, Math.max(size - size * next, p));
  return {
    scale: next,
    x: clampPos(mx - ((mx - t.x) * next) / t.scale, width),
    y: clampPos(my - ((my - t.y) * next) / t.scale, height),
  };
}

/** Two transforms are the same view (sub-pixel pan differences ignored). */
export function sameTransform(a: PaneTransform, b: PaneTransform): boolean {
  return Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

/**
 * Upscaling: `auto` turns nearest-neighbour on once a source pixel covers
 * more than ~1.5 screen pixels; `smooth` and `pixelated` force one.
 */
export type PixelRendering = "auto" | "smooth" | "pixelated";

/**
 * Screen pixels one source pixel covers: `object-contain` fit of a
 * `natural` source in a `box`, times the zoom. 0 while either is unknown.
 */
export function screenPerSourcePixel(
  box: { w: number; h: number },
  natural: { w: number; h: number } | null | undefined,
  scale: number,
): number {
  if (!natural || !(natural.w > 0) || !(natural.h > 0) || !(box.w > 0) || !(box.h > 0)) return 0;
  return Math.min(box.w / natural.w, box.h / natural.h) * scale;
}

/** Auto's threshold: nearest-neighbour above this many screen px per source px. */
export const AUTO_PIXELATED_ABOVE = 1.5;

/** The CSS `image-rendering` for a rendering mode at a screen-per-source-pixel ratio. */
export function cssImageRendering(rendering: PixelRendering, screenPerPx: number): "pixelated" | "auto" {
  if (rendering === "pixelated") return "pixelated";
  if (rendering === "smooth") return "auto";
  return screenPerPx > AUTO_PIXELATED_ABOVE ? "pixelated" : "auto";
}
