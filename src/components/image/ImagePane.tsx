import { useState } from "react";
import type { ImageOverlays, OverlayView } from "../../lib/overlays";
import type { PixelRendering } from "../../lib/media/split-geometry";
import type { ZoomView } from "../../lib/media/view-geometry";
import type { ZoomViewSync } from "../../lib/media/zoom-view-sync";
import ZoomSplitPane, { PANE_MEDIA_CLASS } from "../media/ZoomSplitPane";
import ImageOverlay from "./ImageOverlay";

export type { ZoomView } from "../../lib/media/view-geometry";

export interface ImageSource {
  src: string;
  label?: string;
}

interface Props {
  /** The pane's own image (right of the divider when comparing; the reference is on the left). */
  image: ImageSource;
  /**
   * The image's natural size, known up front when the caller decoded it
   * before handing it over (see image-frame.ts): the overlay then draws in
   * the same commit as the image. Without it the overlay waits for `load`.
   */
  imageSize?: { w: number; h: number };
  /** Reference image; when present the pane shows an A/B divider. */
  reference?: ImageSource | null;
  /** Divider position as a fraction of the pane width. */
  split: number;
  onSplitChange?: (split: number, final: boolean) => void;
  /** Shared zoom/pan, independent of the pane's size (see lib/media/view-geometry.ts). */
  view: ZoomView;
  onViewChange: (view: ZoomView) => void;
  /** The card's live sync between its panes (see ZoomSplitPane). */
  viewSync?: ZoomViewSync;
  /** Annotations drawn over the pane's own image (never over the reference). */
  overlays?: ImageOverlays | null;
  overlayView?: OverlayView;
  /**
   * Upscaling: `auto` turns nearest-neighbour on once a source pixel covers
   * more than ~1.5 screen pixels; `smooth` and `pixelated` force one.
   */
  rendering?: ImageRendering;
}

export type ImageRendering = PixelRendering;

/**
 * One zoomable image, optionally split against a reference by a vertical
 * divider (zoom, pan, divider and rendering: see ZoomSplitPane). The overlay
 * sits in the foreground with the image, so it is clipped and zoomed with it.
 */
export default function ImagePane({
  image, imageSize, reference, split, onSplitChange, view, onViewChange, viewSync, overlays, overlayView, rendering = "auto",
}: Props) {
  // Keyed by src: a new image's overlay waits for that image's size.
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  const natural = imageSize && imageSize.w > 0
    ? { src: image.src, ...imageSize }
    : loaded?.src === image.src ? loaded : null;

  return (
    <ZoomSplitPane
      contentSize={natural}
      compare={!!reference}
      referenceLabel={reference?.label}
      label={image.label}
      split={split}
      onSplitChange={onSplitChange}
      view={view}
      onViewChange={onViewChange}
      viewSync={viewSync}
      rendering={rendering}
      reference={(imageRendering) => reference && (
        <img src={reference.src} alt={reference.label ?? "reference"} draggable={false} decoding="sync" className={PANE_MEDIA_CLASS} style={{ imageRendering }} />
      )}
    >
      {(imageRendering) => (
        <>
          <img
            src={image.src}
            alt={image.label ?? "image"}
            draggable={false}
            className={PANE_MEDIA_CLASS}
            style={{ imageRendering }}
            // A decoded frame paints in the commit that shows it (never a blank frame).
            decoding="sync"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (!imageSize) setLoaded({ src: image.src, w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          {overlays && overlayView && natural?.src === image.src && (
            <ImageOverlay overlays={overlays} view={overlayView} width={natural.w} height={natural.h} />
          )}
        </>
      )}
    </ZoomSplitPane>
  );
}
