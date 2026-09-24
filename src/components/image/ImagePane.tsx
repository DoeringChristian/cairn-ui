import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { useInteract } from "../../lib/use-interact";
import type { ImageOverlays, OverlayView } from "../../lib/overlays";
import ImageOverlay from "./ImageOverlay";

export interface PaneTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ImageSource {
  src: string;
  label?: string;
}

interface Props {
  /** The pane's own image (left of the divider when comparing). */
  image: ImageSource;
  /** Reference image; when present the pane shows an A/B divider. */
  reference?: ImageSource | null;
  /** Divider position as a fraction of the pane width. */
  split: number;
  onSplitChange?: (split: number, final: boolean) => void;
  /** Shared zoom/pan: applied when it differs from the pane's own. */
  transform: PaneTransform;
  onTransformChange: (t: PaneTransform) => void;
  /** Annotations drawn over the pane's own image (never over the reference). */
  overlays?: ImageOverlays | null;
  overlayView?: OverlayView;
}

const MIN_SCALE = 1;
const MAX_SCALE = 64;
/** Zoom factor per wheel pixel: one mouse notch (~100px) ≈ ×1.35, trackpads stay smooth. */
const WHEEL_ZOOM = 0.003;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * One zoomable image, optionally split against a reference by a vertical
 * divider. Both images live inside ONE transform, so they zoom and pan
 * together by construction; the divider is a screen-space overlay, and the
 * foreground's clip is recomputed in content space on every transform.
 * While not interactive (a touch device with the card's interact toggle off,
 * see lib/use-interact) zoom, pan and the divider ignore input, so a finger
 * scrolls the page.
 */
export default function ImagePane({
  image, reference, split, onSplitChange, transform, onTransformChange, overlays, overlayView,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** The foreground layer: the image plus its overlay, clipped together. */
  const fgRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Keyed by src: a new image's overlay waits for that image's size.
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const zoomRef = useRef<ReactZoomPanPinchRef | null>(null);
  const own = useRef<PaneTransform>({ scale: 1, x: 0, y: 0 });
  const [pixelated, setPixelated] = useState(false);
  const interactive = useInteract();
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  // Keep the foreground's clip in content coordinates: X = (dividerX − panX) / scale.
  const updateClip = useCallback(() => {
    const fg = fgRef.current;
    const box = boxRef.current;
    if (!fg) return;
    if (!reference || !box) {
      fg.style.clipPath = "";
      return;
    }
    const { scale, x } = own.current;
    const contentWidth = box.clientWidth;
    const dividerX = split * box.clientWidth;
    const clipLeft = (dividerX - x) / scale;
    fg.style.clipPath = `inset(0 ${Math.max(0, contentWidth - clipLeft)}px 0 0)`;
  }, [reference, split]);

  // Nearest-neighbour once a source pixel covers more than ~1.5 screen pixels;
  // the overlay's strokes and labels scale by the inverse (see ImageOverlay).
  const updatePixelated = useCallback(() => {
    const img = imgRef.current;
    const box = boxRef.current;
    if (!img || !box || !img.naturalWidth) return;
    const fit = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
    const screenPerImagePx = fit * own.current.scale;
    setPixelated(screenPerImagePx > 1.5);
    if (screenPerImagePx > 0) fgRef.current?.style.setProperty("--overlay-px", String(1 / screenPerImagePx));
  }, []);

  useLayoutEffect(updateClip, [updateClip]);

  // Apply the shared transform from sibling panes.
  useEffect(() => {
    const ref = zoomRef.current;
    const cur = own.current;
    if (!ref) return;
    const same = Math.abs(cur.scale - transform.scale) < 1e-6
      && Math.abs(cur.x - transform.x) < 0.5
      && Math.abs(cur.y - transform.y) < 0.5;
    if (!same) ref.setTransform(transform.x, transform.y, transform.scale, 0);
  }, [transform]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      updateClip();
      updatePixelated();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [updateClip, updatePixelated]);

  // Non-passive, so the page doesn't scroll while zooming.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const ref = zoomRef.current;
      if (!ref || !interactiveRef.current) return;
      e.preventDefault();
      const { scale, x, y } = own.current;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * Math.exp(-e.deltaY * WHEEL_ZOOM)));
      if (next === scale) return;
      const rect = box.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Keep the content point under the cursor fixed, then stay inside the image bounds.
      const clampPos = (p: number, size: number) => Math.min(0, Math.max(size - size * next, p));
      const nx = clampPos(mx - ((mx - x) * next) / scale, rect.width);
      const ny = clampPos(my - ((my - y) * next) / scale, rect.height);
      ref.setTransform(nx, ny, next, 0);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!reference || !onSplitChange) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // Flip: ← shows all of the reference, → all of the image.
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
      return clamp01((clientX - rect.left) / rect.width);
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

  const imgClass = "absolute inset-0 h-full w-full object-contain select-none";
  const imgStyle = { imageRendering: pixelated ? "pixelated" : "auto" } as const;

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
      title={reference ? "Drag the divider; ← / → flip to the reference / the image" : undefined}
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
        // Double-click is ours (onDoubleClick below): reset to the fitted view.
        doubleClick={{ disabled: true }}
        onTransform={(_ref, state) => {
          own.current = { scale: state.scale, x: state.positionX, y: state.positionY };
          updateClip();
          updatePixelated();
          onTransformChange(own.current);
        }}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
          <div className="relative h-full w-full">
            {reference && (
              <img src={reference.src} alt={reference.label ?? "reference"} draggable={false} className={imgClass} style={imgStyle} />
            )}
            <div ref={fgRef} className="absolute inset-0">
              <img
                ref={imgRef}
                src={image.src}
                alt={image.label ?? "image"}
                draggable={false}
                className={imgClass}
                style={imgStyle}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNatural({ src: image.src, w: img.naturalWidth, h: img.naturalHeight });
                  updatePixelated();
                  updateClip();
                }}
              />
              {overlays && overlayView && natural?.src === image.src && (
                <ImageOverlay overlays={overlays} view={overlayView} width={natural.w} height={natural.h} />
              )}
            </div>
          </div>
        </TransformComponent>
      </TransformWrapper>

      {reference && (
        <>
          {/* 16px hit strip with a mouse, 32px for a finger. */}
          <div
            className={`absolute inset-y-0 z-10 w-4 touch:w-8 -translate-x-1/2 ${
              interactive ? "cursor-ew-resize touch-none" : "pointer-events-none"
            }`}
            style={{ left: `${split * 100}%` }}
            onPointerDown={interactive ? dragDivider : undefined}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
            <div className="absolute left-1/2 top-1/2 flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full bg-white px-1 text-[9px] text-neutral-700 shadow">
              <i className="fa-solid fa-caret-left" aria-hidden="true" />
              <i className="fa-solid fa-caret-right" aria-hidden="true" />
            </div>
          </div>
          <span className="pointer-events-none absolute bottom-1 left-1 z-10 max-w-[45%] truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted">
            {image.label ?? "A"}
          </span>
          <span className="pointer-events-none absolute bottom-1 right-1 z-10 max-w-[45%] truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted">
            {reference.label ?? "B"}
          </span>
        </>
      )}
    </div>
  );
}
