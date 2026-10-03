import { useEffect, useMemo, useState } from "react";

import { api } from "../../api/client";
import { describeEncoding, isBrowserDisplayable } from "../../lib/artifact-format";
import { artifactFilename } from "../../lib/download";
import { pointCaption } from "../../lib/caption";
import { ItemCaption, RunChip, usePaneLabelInline } from "../card-kit/pane-label";
import UnsupportedArtifact from "../UnsupportedArtifact";
import {
  maskClassIds,
  parseOverlays,
  summarizeOverlays,
  type ImageOverlays,
  type OverlaySummary,
  type OverlayView,
} from "../../lib/overlays";
import type { ZoomViewSync } from "../../lib/media/zoom-view-sync";
import ImagePane, { type ImageRendering, type ZoomView } from "./ImagePane";
import { decodeMask } from "./decode-mask";
import type { ImageFrame, ImageItem } from "./image-frame";
import { galleryGridColumns } from "../../lib/media/gallery";

const EMPTY_ITEMS: ImageItem[] = [];

interface Props {
  metricName: string;
  /**
   * What the pane paints, decoded and complete (see image-frame.ts; a gallery
   * reference pairs with the point's images by index): `null` when the run has
   * no image here, `undefined` before the card's first frame is ready.
   */
  frame: ImageFrame | null | undefined;
  refLabel?: string;
  split: number;
  onSplitChange: (split: number, final: boolean) => void;
  view: ZoomView;
  onViewChange: (view: ZoomView) => void;
  /** The card's live sync between its panes (see ZoomSplitPane). */
  viewSync?: ZoomViewSync;
  loadingHint: boolean;
  overlayView: OverlayView;
  /** Reports the overlays this point's images carry (for the card's overlay settings). */
  onOverlays?: (summary: OverlaySummary) => void;
  rendering?: ImageRendering;
}

/**
 * Parse each item's overlays, and report their summary — including the class
 * ids found in decoded masks, which is the only place a mask without
 * `class_labels` names its classes.
 */
function useItemOverlays(items: ImageItem[], onOverlays?: (summary: OverlaySummary) => void): Array<ImageOverlays | null> {
  const itemsKey = items.map((i) => i.hash).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overlays = useMemo(() => items.map((i) => parseOverlays(i.metadata)), [itemsKey]);
  const [maskIds, setMaskIds] = useState<number[]>([]);
  useEffect(() => {
    const masks = overlays.flatMap((o) => o?.masks ?? []);
    let alive = true;
    if (masks.length === 0) {
      setMaskIds([]);
      return;
    }
    Promise.allSettled(masks.map((m) => decodeMask(m.pngB64))).then((results) => {
      if (!alive) return;
      const ids = new Set<number>();
      for (const r of results) if (r.status === "fulfilled") for (const id of maskClassIds(r.value.data)) ids.add(id);
      setMaskIds([...ids].sort((a, b) => a - b));
    });
    return () => { alive = false; };
  }, [overlays]);
  const summary = useMemo(() => summarizeOverlays(overlays, maskIds), [overlays, maskIds]);
  const summaryKey = JSON.stringify(summary);
  useEffect(() => {
    onOverlays?.(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey, onOverlays]);
  return overlays;
}

/**
 * Everything one run shows at the current step: an image, or a gallery of
 * images in a grid. Every image shares the card's zoom and divider. It only
 * renders the frame it is handed; the card decides when frames swap.
 */
export default function ImagePointView({
  metricName, frame, refLabel, split, onSplitChange, view, onViewChange, viewSync, loadingHint,
  overlayView, onOverlays, rendering,
}: Props) {
  const items = frame?.items ?? EMPTY_ITEMS;
  const overlays = useItemOverlays(items, onOverlays);

  // Before the card's first frame is decoded (afterwards it holds its last one).
  if (frame === undefined) return <div className="h-full motion-safe:animate-pulse bg-bg-hover" />;
  if (!frame?.point || items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
        {loadingHint ? "Loading…" : "No image logged"}
      </div>
    );
  }
  const shown = frame.point;
  const refs = { items: frame.refItems };

  const gallery = items.length > 1;
  // A gallery's own caption heads the grid; each image shows its entry's.
  const galleryCaption = gallery ? pointCaption(shown.metadata) : null;
  const cell = (item: ImageItem, i: number) => {
    const url = api.artifactUrl(item.hash);
    const base = gallery ? `${metricName} · ${shown.step} · #${i}` : `${metricName} · ${shown.step}`;
    const label = item.caption ? `${base} · ${item.caption}` : base;
    if (!isBrowserDisplayable(item.mime)) {
      return (
        <UnsupportedArtifact
          key={i}
          label={`${describeEncoding(item.mime, item.metadata)} — not viewable in the browser`}
          detail={gallery ? `step ${shown.step} · #${i}` : `step ${shown.step}`}
          previewSrc={typeof item.metadata?.preview === "string" ? item.metadata.preview : undefined}
          downloadUrl={url}
          filename={artifactFilename(gallery ? `${metricName}_${i}` : metricName, shown.step, item.mime)}
        />
      );
    }
    const refItem = refs.items.length > 1 ? refs.items[i] : refs.items[0];
    const refShown = refItem && isBrowserDisplayable(refItem.mime)
      ? { src: api.artifactUrl(refItem.hash), label: `${refLabel ?? "reference"}${refs.items.length > 1 ? ` · #${i}` : ""}` }
      : null;
    const pane = (
      <ImagePane
        image={{ src: url, label }}
        imageSize={frame.sizes[url]}
        reference={refShown}
        split={split}
        onSplitChange={onSplitChange}
        view={view}
        onViewChange={onViewChange}
        viewSync={viewSync}
        overlays={overlays[i]}
        overlayView={overlayView}
        rendering={rendering}
      />
    );
    // Keyed by position with one tree shape, so a step change reuses the
    // pane (and its zoom state) instead of remounting it.
    return (
      <div key={i} className="group/item relative h-full w-full">
        {pane}
        {item.caption && <Caption text={item.caption} />}
      </div>
    );
  };

  if (!gallery) return cell(items[0]!, 0);
  // Near-square grid of equal cells (the layout every gallery shares).
  const cols = galleryGridColumns(items.length);
  const grid = (
    <div
      className="grid min-h-0 w-full flex-1 gap-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
    >
      {items.map((item, i) => (
        <div key={i} className="relative min-h-0 min-w-0 overflow-hidden">
          {cell(item, i)}
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex h-full w-full flex-col">
      {galleryCaption && <GalleryCaption text={galleryCaption} />}
      {grid}
    </div>
  );
}

/** A gallery's caption line, shared with the pane's run chip in a multi-run card. */
function GalleryCaption({ text }: { text: string }) {
  const run = usePaneLabelInline(true);
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 pb-1 text-xs text-fg-muted" data-pane-header>
      {run && <RunChip {...run} className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate text-center" title={text}>{text}</span>
      {run && <span aria-hidden="true" className="invisible shrink-0"><RunChip {...run} /></span>}
    </div>
  );
}

/** A caption over an image's top-right corner (the run chip owns top-left, the A/B labels the bottom). */
function Caption({ text }: { text: string }) {
  return <ItemCaption text={text} />;
}
