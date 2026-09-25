import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  boxCaption,
  boxToRect,
  classColor,
  colorizeMask,
  maskLut,
  visibleBoxes,
  type ImageOverlays,
  type OverlayMask,
  type OverlayView,
} from "../../lib/overlays";
import type { GrayImage } from "../../lib/png-gray";
import { decodeMask, peekMask } from "./decode-mask";

interface Props {
  overlays: ImageOverlays;
  view: OverlayView;
  /** The image's natural size; the SVG's user units are image pixels. */
  width: number;
  height: number;
}

/**
 * Boxes and masks drawn over an image, in image-pixel coordinates. It fills
 * the same box as the `object-contain` image (`meet` ≡ `contain`), so it
 * lines up at any card size and zooms with it. Strokes and label text are
 * sized by the `--overlay-px` custom property (image pixels per screen
 * pixel), which the pane updates on zoom and resize, so they stay a constant
 * screen size without re-rendering.
 */
export default function ImageOverlay({ overlays, view, width, height }: Props) {
  const boxes = useMemo(
    () => (view.showBoxes ? visibleBoxes(overlays.boxes, view) : []),
    [overlays.boxes, view],
  );
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {view.showMasks && overlays.masks.map((m) => (
        <MaskLayer key={m.name} mask={m} hiddenClasses={view.hiddenClasses} opacity={view.maskOpacity} width={width} height={height} />
      ))}
      {boxes.map((b, i) => {
        const r = boxToRect(b, width, height);
        const color = classColor(b.class_id);
        return (
          <g key={i}>
            <rect
              x={r.x} y={r.y} width={r.width} height={r.height}
              fill="none" stroke={color}
              style={{ strokeWidth: "calc(2px * var(--overlay-px, 1))" }}
            />
            <text
              x={r.x} y={r.y}
              dominantBaseline="hanging"
              fill="#fff"
              stroke={color}
              paintOrder="stroke"
              style={{
                fontSize: "calc(11px * var(--overlay-px, 1))",
                strokeWidth: "calc(3px * var(--overlay-px, 1))",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
              }}
            >
              {boxCaption(b, overlays.classLabels)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * One mask: decoded once (shared cache), recoloured when the hidden classes
 * change. It is drawn into a canvas in a layout effect, i.e. before the
 * browser paints the commit that brought it — together with the image it
 * belongs to (the image frame decoded the mask before swapping in; see
 * image-frame.ts). A data-URL `<image>` would decode asynchronously and
 * trail the image by a frame or more.
 */
function MaskLayer({ mask, hiddenClasses, opacity, width, height }: {
  mask: OverlayMask;
  hiddenClasses: number[];
  opacity: number;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Normally cached already; otherwise (evicted) decode, and draw when it lands.
  const [late, setLate] = useState<{ key: string; image: GrayImage } | null>(null);
  const current = peekMask(mask.pngB64) ?? (late?.key === mask.pngB64 ? late.image : null);
  useEffect(() => {
    if (current) return;
    let alive = true;
    decodeMask(mask.pngB64).then((image) => { if (alive) setLate({ key: mask.pngB64, image }); }, () => {});
    return () => { alive = false; };
  }, [mask.pngB64, current]);
  const hiddenKey = hiddenClasses.join(",");
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !current) return;
    if (canvas.width !== current.width) canvas.width = current.width;
    if (canvas.height !== current.height) canvas.height = current.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rgba = colorizeMask(current.data, maskLut(hiddenClasses));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), current.width, current.height), 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, hiddenKey]);
  if (!current) return null;
  return (
    <foreignObject x={0} y={0} width={width} height={height} opacity={opacity}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
      />
    </foreignObject>
  );
}
