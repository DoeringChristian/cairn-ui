import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  TransformComponent,
  TransformWrapper,
  getTransformStyles,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { useInteract } from "../../lib/use-interact";
import {
  AUTO_PIXELATED_ABOVE,
  MAX_SCALE,
  MIN_SCALE,
  clampSplit,
  cssImageRendering,
  sameTransform,
  screenPerSourcePixel,
  splitBarLeft,
  splitClipPath,
  wheelZoom,
  type PaneTransform,
  type PixelRendering,
} from "../../lib/media/split-geometry";

export interface ZoomSplitPaneProps {
  /**
   * The content's natural size in source pixels (an image's, a video's
   * frame): with `rendering="auto"` it decides when upscaled pixels turn
   * crisp. `null` while unknown.
   */
  contentSize: { w: number; h: number } | null | undefined;
  /** Show the reference split against the content by a vertical divider. */
  compare: boolean;
  /** Labels in the bottom corners while comparing. */
  referenceLabel?: string;
  label?: string;
  /** What the content is called in the divider's tooltip ("image", "video"). */
  noun?: string;
  /** Divider position as a fraction of the pane width. */
  split: number;
  onSplitChange?: (split: number, final: boolean) => void;
  /** Shared zoom/pan: applied when it differs from the pane's own. */
  transform: PaneTransform;
  onTransformChange: (t: PaneTransform) => void;
  rendering?: PixelRendering;
  /**
   * The reference, rendered inside the zoomed layer (left of the divider).
   * Gets the CSS `image-rendering` to apply. Rendered whether or not the
   * pane compares (a video pane loads its next reference hidden there); the
   * foreground covers it all while not comparing.
   */
  reference?: (imageRendering: "pixelated" | "auto") => ReactNode;
  /** The content (right of the divider while comparing), rendered in the clipped foreground layer. */
  children: (imageRendering: "pixelated" | "auto") => ReactNode;
}

/** Class for a media element filling a pane (`object-contain`, both layers alike). */
export const PANE_MEDIA_CLASS = "absolute inset-0 h-full w-full object-contain select-none";

/**
 * One zoomable pane, optionally split against a reference by a vertical
 * divider; image and video panes share it. The zoom library transforms the
 * reference; the foreground (the content and anything drawn over it) is a
 * layer above it that receives the very same transform string in the same
 * call (`customTransform`), so both zoom and pan together. The foreground's
 * clip sits on that layer OUTSIDE the transform, in the pane's screen space,
 * from the same `split` as the divider bar (see lib/media/split-geometry.ts):
 * the bar is always exactly on the clip edge.
 *
 * Wheel zoom is multiplicative and cursor-anchored, drag pans, pinch zooms,
 * double-click resets to the fitted view; ← / → flip the divider. While not
 * interactive (a touch device with the card's interact toggle off, see
 * lib/use-interact) zoom, pan and the divider ignore input, so a finger
 * scrolls the page.
 *
 * The foreground layer carries `--overlay-px` (source pixels per screen
 * pixel), for overlays that keep their strokes a constant screen width.
 */
export default function ZoomSplitPane({
  contentSize, compare, referenceLabel, label, noun = "image", split, onSplitChange, transform, onTransformChange,
  rendering = "auto", reference, children,
}: ZoomSplitPaneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** The foreground layer: the content plus its overlays, clipped together (screen space). */
  const fgRef = useRef<HTMLDivElement>(null);
  /** Inside `fgRef`: carries the zoom library's transform. */
  const fgContentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ReactZoomPanPinchRef | null>(null);
  const own = useRef<PaneTransform>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef(contentSize);
  sizeRef.current = contentSize;
  /** Auto rendering's verdict: a source pixel covers more than ~1.5 screen pixels. */
  const [upscaled, setUpscaled] = useState(false);
  const interactive = useInteract();
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  /**
   * Every transform the zoom library applies to the reference goes through
   * here: the foreground gets the identical string, and `own` the applied state.
   */
  const applyTransform = useCallback((x: number, y: number, scale: number) => {
    const t = getTransformStyles(x, y, scale);
    own.current = { scale, x, y };
    if (fgContentRef.current) fgContentRef.current.style.transform = t;
    return t;
  }, []);

  const updateScreenPerPx = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const ratio = screenPerSourcePixel({ w: box.clientWidth, h: box.clientHeight }, sizeRef.current, own.current.scale);
    if (ratio <= 0) return;
    setUpscaled(ratio > AUTO_PIXELATED_ABOVE);
    fgRef.current?.style.setProperty("--overlay-px", String(1 / ratio));
  }, []);

  // New content of a different size changes the screen-per-source-pixel ratio.
  useLayoutEffect(updateScreenPerPx, [contentSize?.w, contentSize?.h, updateScreenPerPx]);

  // Apply the shared transform from sibling panes.
  useEffect(() => {
    const ref = zoomRef.current;
    if (!ref) return;
    if (!sameTransform(own.current, transform)) ref.setTransform(transform.x, transform.y, transform.scale, 0);
  }, [transform]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(updateScreenPerPx);
    ro.observe(box);
    return () => ro.disconnect();
  }, [updateScreenPerPx]);

  // Non-passive, so the page doesn't scroll while zooming.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const ref = zoomRef.current;
      if (!ref || !interactiveRef.current) return;
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      const next = wheelZoom(own.current, e.deltaY, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      if (next) ref.setTransform(next.x, next.y, next.scale, 0);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!compare || !onSplitChange) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // Flip the divider to the edge the arrow points at: ← shows all of the
    // content (right side), → all of the reference (left side).
    onSplitChange(e.key === "ArrowLeft" ? 0 : 1, true);
  };

  const dragDivider = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box || !onSplitChange) return;
    e.preventDefault();
    e.stopPropagation();
    box.focus();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const at = (clientX: number) => {
      const rect = box.getBoundingClientRect();
      return clampSplit((clientX - rect.left) / rect.width);
    };
    const move = (ev: PointerEvent) => onSplitChange(at(ev.clientX), false);
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      onSplitChange(at(ev.clientX), true);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const imageRendering = cssImageRendering(rendering, upscaled ? Infinity : 0);

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // The zoom library cancels mousedown, which would keep focus (and the arrow keys) away.
      onPointerDownCapture={() => boxRef.current?.focus({ preventScroll: true })}
      onDoubleClick={() => {
        if (interactive) zoomRef.current?.setTransform(0, 0, 1, 0);
      }}
      className="cairn-checkerboard relative h-full w-full overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-accent"
      title={compare ? `Drag the divider; ← / → flip to the reference / the ${noun}` : undefined}
    >
      <TransformWrapper
        ref={zoomRef}
        // Input only: `disabled` would also block setTransform (sibling sync, reset view).
        panning={{ disabled: !interactive }}
        pinch={{ disabled: !interactive }}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        // Wheel zoom is ours (multiplicative, cursor-anchored); the library's is additive.
        wheel={{ disabled: true }}
        limitToBounds
        centerZoomedOut
        // Double-click is ours (onDoubleClick above): reset to the fitted view.
        doubleClick={{ disabled: true }}
        customTransform={applyTransform}
        onTransform={() => {
          updateScreenPerPx();
          onTransformChange(own.current);
        }}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
          <div className="relative h-full w-full">
            {reference?.(imageRendering)}
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* The foreground: above the reference, clipped in screen space, transformed like it.
          It never takes input; pans and pinches reach the zoom wrapper below. */}
      <div
        ref={fgRef}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ clipPath: compare ? splitClipPath(split) : undefined }}
      >
        <div
          ref={fgContentRef}
          className="absolute left-0 top-0 h-full w-full"
          style={{ transformOrigin: "0 0", transform: getTransformStyles(own.current.x, own.current.y, own.current.scale) }}
        >
          {children(imageRendering)}
        </div>
      </div>

      {compare && (
        <>
          {/* 16px hit strip with a mouse, 32px for a finger. */}
          <div
            className={`absolute inset-y-0 z-10 w-4 touch:w-8 -translate-x-1/2 ${
              interactive ? "cursor-ew-resize touch-none" : "pointer-events-none"
            }`}
            style={{ left: splitBarLeft(split) }}
            onPointerDown={interactive ? dragDivider : undefined}
            data-split-bar=""
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
            <div className="absolute left-1/2 top-1/2 flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full bg-white px-1 text-[9px] text-neutral-700 shadow">
              <i className="fa-solid fa-caret-left" aria-hidden="true" />
              <i className="fa-solid fa-caret-right" aria-hidden="true" />
            </div>
          </div>
          <span className="pointer-events-none absolute bottom-1 left-1 z-10 max-w-[45%] truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted">
            {referenceLabel ?? "B"}
          </span>
          <span className="pointer-events-none absolute bottom-1 right-1 z-10 max-w-[45%] truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted">
            {label ?? "A"}
          </span>
        </>
      )}
    </div>
  );
}
