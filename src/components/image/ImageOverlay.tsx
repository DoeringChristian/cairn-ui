import { useEffect, useMemo, useState } from "react";
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
import { decodeMask, maskDataUrl } from "./decode-mask";

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

/** One mask: decoded once (shared cache), recoloured when the hidden classes change. */
function MaskLayer({ mask, hiddenClasses, opacity, width, height }: {
  mask: OverlayMask;
  hiddenClasses: number[];
  opacity: number;
  width: number;
  height: number;
}) {
  const [decoded, setDecoded] = useState<Awaited<ReturnType<typeof decodeMask>> | null>(null);
  useEffect(() => {
    let alive = true;
    setDecoded(null);
    decodeMask(mask.pngB64).then((d) => { if (alive) setDecoded(d); }, () => {});
    return () => { alive = false; };
  }, [mask.pngB64]);
  const hiddenKey = hiddenClasses.join(",");
  const href = useMemo(() => {
    if (!decoded) return null;
    const rgba = colorizeMask(decoded.data, maskLut(hiddenClasses));
    return maskDataUrl(decoded.width, decoded.height, rgba);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, hiddenKey]);
  if (!href) return null;
  return (
    <image
      href={href}
      x={0} y={0} width={width} height={height}
      preserveAspectRatio="none"
      opacity={opacity}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
