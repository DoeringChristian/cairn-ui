/**
 * Geometry of the A/B split view (ImagePane).
 *
 * The divider bar and the foreground's clip edge both come from `split`, as
 * a fraction of the pane's own (screen-space) width: the bar sits at
 * `left: split·100%`, the clip cuts at `inset(0 (1 − split)·100% 0 0)` on a
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

/** The foreground layer's `clip-path`: keep everything left of the bar. */
export function splitClipPath(split: number): string {
  return `inset(0 ${(1 - clampSplit(split)) * 100}% 0 0)`;
}

/** Screen-space x (pane px) of a content-space x under a zoom/pan transform (origin 0 0). */
export function contentToScreenX(contentX: number, t: PaneTransform): number {
  return t.x + contentX * t.scale;
}

/** Content-space x of a screen-space x (pane px). */
export function screenToContentX(screenX: number, t: PaneTransform): number {
  return (screenX - t.x) / t.scale;
}
