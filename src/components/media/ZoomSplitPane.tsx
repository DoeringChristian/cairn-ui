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
import { transformToView, viewToTransform, type ZoomView, type Size } from "../../lib/media/view-geometry";

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
  /**
   * The shared zoom/pan, independent of the pane's size (see
   * lib/media/view-geometry.ts): this pane shows it through its own size and
   * fit, and reports its user's gestures as one.
   */
  view: ZoomView;
  onViewChange: (view: ZoomView) => void;
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
 * The zoom/pan comes in and goes out as a size-independent {@link ZoomView}
 * (zoom over the fit, and the media point at the pane's centre; see
 * lib/media/view-geometry.ts). The library's pixel transform is derived from
 * it and the pane's current size here, on mount and on every resize, and
 * never leaves this component: a pane of any size (a resized card, the
 * settings view, a narrower compare pane, a gallery cell) shows the same
 * point at the same zoom.
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
  contentSize, compare, referenceLabel, label, noun = "image", split, onSplitChange, view, onViewChange,
  rendering = "auto", reference, children,
}: ZoomSplitPaneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** The foreground layer: the content plus its overlays, clipped together (screen space). */
  const fgRef = useRef<HTMLDivElement>(null);
  /** Inside `fgRef`: carries the zoom library's transform. */
  const fgContentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ReactZoomPanPinchRef | null>(null);
  /** The pixel transform applied right now (the zoom library's state); never leaves this pane. */
  const own = useRef<PaneTransform>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef(contentSize);
  sizeRef.current = contentSize;
  /** The view this pane shows: the prop, or the one it just reported (until the prop catches up). */
  const viewRef = useRef(view);
  /** The pane size `own` was derived for. */
  const paneRef = useRef<Size>({ w: 0, h: 0 });
  /** Set while this pane applies a view itself: those transforms are not the user's. */
  const applying = useRef(false);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
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

  /** The pane's size now (fractional, like the media's fit inside it). */
  const measure = useCallback((): Size => {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { w: r.width, h: r.height } : { w: 0, h: 0 };
  }, []);

  /**
   * Show `viewRef` at the pane's current size and content: the only way a
   * view becomes pixels. Runs on mount, on a new view or content size, and on
   * every resize, so a resize keeps the media point at the centre.
   */
  const sync = useCallback(() => {
    const ref = zoomRef.current;
    const pane = measure();
    if (!ref || !(pane.w > 0) || !(pane.h > 0)) return;
    paneRef.current = pane;
    const t = viewToTransform(viewRef.current, pane, sizeRef.current);
    if (!sameTransform(own.current, t)) {
      applying.current = true;
      try {
        ref.setTransform(t.x, t.y, t.scale, 0);
      } finally {
        applying.current = false;
      }
    }
    updateScreenPerPx();
  }, [measure, updateScreenPerPx]);

  // Before paint: a pane mounting into a bigger box (the settings view) shows the view at once.
  useLayoutEffect(() => {
    viewRef.current = view;
    sync();
  }, [view, contentSize?.w, contentSize?.h, sync]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(sync);
    ro.observe(box);
    return () => ro.disconnect();
  }, [sync]);

  /** The zoom library moved: the user's gesture becomes the shared view; anything else is re-derived. */
  const onLibraryTransform = useCallback(() => {
    updateScreenPerPx();
    if (applying.current) return;
    const pane = measure();
    if (Math.abs(pane.w - paneRef.current.w) > 0.01 || Math.abs(pane.h - paneRef.current.h) > 0.01) {
      // The library's own alignment after a resize (in pixels): the view wins.
      sync();
      return;
    }
    const next = transformToView(own.current, pane, sizeRef.current);
    viewRef.current = next;
    onViewChangeRef.current(next);
  }, [measure, sync, updateScreenPerPx]);

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
      data-zoom-pane={noun}
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
        onTransform={onLibraryTransform}
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
