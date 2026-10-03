import { useMemo, useState } from "react";
import { describeEncoding, isBrowserDisplayable } from "../../lib/artifact-format";
import { useDecodedSrc } from "../../lib/media/use-settled-frame";
import { FIT_VIEW, isFitView, type ZoomView } from "../../lib/media/view-geometry";
import { parseOverlays, type OverlayView } from "../../lib/overlays";
import { extensionOf } from "../../lib/viewers/kind";
import type { ViewerSource } from "../../lib/viewers/source";
import { builtin as IMAGE_DEFAULTS } from "../cards-settings/image";
import ImagePane, { type ImageRendering } from "../image/ImagePane";
import UnsupportedArtifact from "../UnsupportedArtifact";
import ViewerToolbar from "./ViewerToolbar";

/** What the image card draws over an image by default (its built-in overlay settings). */
const DEFAULT_OVERLAYS: OverlayView = {
  showBoxes: IMAGE_DEFAULTS.showBoxes,
  showMasks: IMAGE_DEFAULTS.showMasks,
  maskOpacity: IMAGE_DEFAULTS.maskOpacity,
  minScore: IMAGE_DEFAULTS.minScore,
  hiddenClasses: IMAGE_DEFAULTS.hiddenClasses,
};

const BROWSER_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
};

/** Whether a browser can draw the image: by its mime, else (no mime) by its extension. */
export function browserImage(source: Pick<ViewerSource, "mime" | "name">): boolean {
  return isBrowserDisplayable(source.mime ?? BROWSER_EXT[extensionOf(source.name)]);
}

/**
 * One image on its own, in the image card's pane: wheel zoom about the
 * cursor, drag pan, double-click back to the fitted view, a checkerboard
 * under transparency, crisp pixels once upscaled (`rendering="auto"`), and
 * the overlays (boxes, masks) logged with it. An image the browser cannot
 * decode (EXR, TIFF) shows its logged preview and a download.
 */
export default function ImageViewer({
  source,
  rendering = IMAGE_DEFAULTS.rendering,
  label,
  toolbar = true,
}: {
  source: ViewerSource;
  rendering?: ImageRendering;
  label?: string;
  /** Corner controls (reset view, download); off where the surface has its own. */
  toolbar?: boolean;
}) {
  const [view, setView] = useState<ZoomView>(FIT_VIEW);
  const shown = browserImage(source);
  // The last decoded image stays until the next one is ready (never a blank pane).
  const decoded = useDecodedSrc(shown ? source.url : null);
  const overlays = useMemo(() => parseOverlays(source.meta), [source.meta]);
  if (!shown) {
    return (
      <UnsupportedArtifact
        label={`${describeEncoding(source.mime, source.meta)} — not viewable in the browser`}
        previewSrc={typeof source.meta?.preview === "string" ? source.meta.preview : undefined}
        downloadUrl={source.url}
        filename={source.name}
      />
    );
  }
  if (!decoded.image) return <div className="h-full min-h-[8rem] w-full motion-safe:animate-pulse bg-bg-hover" data-viewer="image" />;
  const img = decoded.image;
  return (
    <div className="relative h-full w-full" data-viewer="image">
      <ImagePane
        image={{ src: img.src, label: label ?? source.name }}
        imageSize={img.ok ? { w: img.width, h: img.height } : undefined}
        split={0.5}
        view={view}
        onViewChange={setView}
        overlays={overlays}
        overlayView={DEFAULT_OVERLAYS}
        rendering={rendering}
      />
      {toolbar && (
        <ViewerToolbar
          onResetView={isFitView(view) ? undefined : () => setView(FIT_VIEW)}
          download={{ url: source.url, name: source.name }}
        />
      )}
    </div>
  );
}
