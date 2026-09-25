import { useEffect, useMemo, useState } from "react";

import { api } from "../../api/client";
import { describeEncoding, isBrowserDisplayable } from "../../lib/artifact-format";
import { artifactFilename } from "../../lib/download";
import { pointCaption } from "../../lib/caption";
import UnsupportedArtifact from "../UnsupportedArtifact";
import {
  maskClassIds,
  parseOverlays,
  summarizeOverlays,
  type ImageOverlays,
  type OverlaySummary,
  type OverlayView,
} from "../../lib/overlays";
import ImagePane, { type ImageRendering, type PaneTransform } from "./ImagePane";
import { decodeMask } from "./decode-mask";
import type { ImageFrame, ImageItem } from "./image-frame";

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
  transform: PaneTransform;
  onTransformChange: (t: PaneTransform) => void;
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
  metricName, frame, refLabel, split, onSplitChange, transform, onTransformChange, loadingHint,
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
        transform={transform}
        onTransformChange={onTransformChange}
        overlays={overlays[i]}
        overlayView={overlayView}
        rendering={rendering}
      />
    );
    // Keyed by position with one tree shape, so a step change reuses the
    // pane (and its zoom state) instead of remounting it.
    return (
      <div key={i} className="relative h-full w-full">
        {pane}
        {item.caption && <Caption text={item.caption} />}
      </div>
    );
  };

  if (!gallery) return cell(items[0]!, 0);
  // Near-square grid of equal cells.
  const cols = Math.ceil(Math.sqrt(items.length));
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
      {galleryCaption && (
        <div className="truncate px-1 pb-1 text-center text-xs text-fg-muted" title={galleryCaption}>
          {galleryCaption}
        </div>
      )}
      {grid}
    </div>
  );
}

/** A caption over the top of an image, clear of the A/B labels at the bottom. */
function Caption({ text }: { text: string }) {
  return (
    <span
      className="pointer-events-none absolute left-1/2 top-1 z-10 max-w-[90%] -translate-x-1/2 truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg"
    >
      {text}
    </span>
  );
}
