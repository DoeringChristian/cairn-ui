/**
 * One image pane's frame: everything it paints at one step, loaded as a unit.
 *
 * A frame is the point's images (itself, or a gallery's entries), the
 * reference's images, every one of them decoded, and every overlay mask
 * decoded. `resolveImageFrame` loads all of it; `peekImageFrame` returns it
 * synchronously when all of it is already cached. The pane swaps to a frame
 * only once it is complete (see lib/media/use-settled-frame.ts), so the image
 * and its reference always change together — the reference can never show
 * through where the image is still loading — and an overlay is always drawn
 * over the very image it belongs to.
 */

import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequencePoint } from "../../api/types";
import { isBrowserDisplayable } from "../../lib/artifact-format";
import { isGalleryPoint, type GalleryItem } from "../../lib/media/gallery";
import { galleryQuery } from "../../lib/media/gallery-query";
import { pointCaption } from "../../lib/caption";
import { decodeImage, peekDecoded } from "../../lib/media/decoded-image";
import { parseOverlays } from "../../lib/overlays";
import { decodeMask, peekMask } from "./decode-mask";

/** One stored image: a single point's artifact, or one entry of a gallery. */
export interface ImageItem {
  hash: string;
  mime: string | null | undefined;
  metadata: Record<string, unknown> | null;
  /** The point's caption, or — in a gallery — the entry's own. */
  caption: string | null;
}

export interface ImageFrame {
  point: SequencePoint | null;
  items: ImageItem[];
  refItems: ImageItem[];
  /** Natural size per artifact URL (0×0 when it failed to decode). */
  sizes: Record<string, { w: number; h: number }>;
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function itemsOf(point: SequencePoint | null, manifest: GalleryItem[] | undefined): ImageItem[] | undefined {
  if (!point?.artifact_hash) return [];
  if (!isGalleryPoint(point)) {
    return [{
      hash: point.artifact_hash,
      mime: point.artifact_mime,
      metadata: parseMetadata(point.artifact_metadata),
      caption: pointCaption(point.metadata),
    }];
  }
  if (!manifest) return undefined;
  return manifest.map((i) => ({ hash: i.hash, mime: i.mime_type, metadata: i.metadata, caption: i.caption }));
}

/** The frame's identity: what it shows, not when it was asked for. */
export function imageFrameKey(point: SequencePoint | null, refPoint: SequencePoint | null): string | null {
  if (!point) return null;
  return `${point.artifact_hash ?? "-"}|${refPoint?.artifact_hash ?? "-"}`;
}

const displayable = (items: ImageItem[]) => items.filter((i) => isBrowserDisplayable(i.mime));
/** Thumbnails of the images the browser can't show (EXR…), drawn in their placeholder. */
const previews = (items: ImageItem[]) => items.flatMap((i) =>
  !isBrowserDisplayable(i.mime) && typeof i.metadata?.preview === "string" ? [i.metadata.preview] : []);
const masksOf = (items: ImageItem[]) => items.flatMap((i) => parseOverlays(i.metadata)?.masks ?? []);

/** The complete frame, when everything it paints is cached and decoded. */
export function peekImageFrame(qc: QueryClient, point: SequencePoint | null, refPoint: SequencePoint | null): ImageFrame | undefined {
  const manifest = (p: SequencePoint | null) =>
    p && isGalleryPoint(p)
      ? qc.getQueryData<GalleryItem[]>(qk.gallery(p.artifact_hash))
      : undefined;
  const items = itemsOf(point, manifest(point));
  const refItems = itemsOf(refPoint, manifest(refPoint));
  if (!items || !refItems) return undefined;
  const sizes: ImageFrame["sizes"] = {};
  for (const item of [...displayable(items), ...displayable(refItems)]) {
    const url = api.artifactUrl(item.hash);
    const d = peekDecoded(url);
    if (!d) return undefined;
    sizes[url] = { w: d.width, h: d.height };
  }
  for (const p of previews(items)) if (!peekDecoded(p)) return undefined;
  for (const m of masksOf(items)) if (!peekMask(m.pngB64)) return undefined;
  return { point, items, refItems, sizes };
}

/**
 * Load everything the frame paints. A failed piece is shown failed; rejects
 * only with `LoadAborted` when `signal` aborts.
 */
export async function resolveImageFrame(
  qc: QueryClient,
  point: SequencePoint | null,
  refPoint: SequencePoint | null,
  signal?: AbortSignal,
): Promise<ImageFrame> {
  const itemsFor = async (p: SequencePoint | null): Promise<ImageItem[]> => {
    if (p && isGalleryPoint(p)) {
      try {
        return itemsOf(p, await qc.fetchQuery(galleryQuery(p.artifact_hash!))) ?? [];
      } catch {
        return [];
      }
    }
    return itemsOf(p, undefined) ?? [];
  };
  const [items, refItems] = await Promise.all([itemsFor(point), itemsFor(refPoint)]);
  const urls = [...displayable(items), ...displayable(refItems)].map((i) => api.artifactUrl(i.hash));
  const [decoded] = await Promise.all([
    Promise.all(urls.map((url) => decodeImage(url, signal))),
    Promise.all(previews(items).map((p) => decodeImage(p, signal))),
    Promise.allSettled(masksOf(items).map((m) => decodeMask(m.pngB64))),
  ]);
  const sizes: ImageFrame["sizes"] = {};
  for (const d of decoded) sizes[d.src] = { w: d.width, h: d.height };
  return { point, items, refItems, sizes };
}
