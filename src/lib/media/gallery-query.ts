/**
 * A gallery point's manifest through the query cache (see gallery.ts), and
 * its items as points: synchronously when cached (`peekGalleryItems`), or
 * loaded (`loadGalleryItems`).
 */

import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequencePoint } from "../../api/types";
import { galleryItemPoints, isGalleryPoint, parseGalleryManifest, type GalleryItem } from "./gallery";

export const galleryQuery = (hash: string) => ({
  queryKey: qk.gallery(hash),
  queryFn: async (): Promise<GalleryItem[]> => {
    const res = await fetch(api.artifactUrl(hash));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return parseGalleryManifest(await res.json());
  },
  staleTime: Infinity,
});

/** A point with its gallery items (as points) and their manifest entries. */
export interface GalleryFrame {
  point: SequencePoint;
  items: GalleryItem[];
  itemPoints: SequencePoint[];
}

const frameOf = (point: SequencePoint, items: GalleryItem[]): GalleryFrame =>
  ({ point, items, itemPoints: galleryItemPoints(point, items) });

/** The gallery's items when its manifest is cached. */
export function peekGalleryItems(qc: QueryClient, point: SequencePoint): GalleryFrame | undefined {
  if (!isGalleryPoint(point)) return undefined;
  const items = qc.getQueryData<GalleryItem[]>(qk.gallery(point.artifact_hash));
  return items ? frameOf(point, items) : undefined;
}

/** Fetch the gallery's manifest; a manifest that fails to load has no items. */
export async function loadGalleryItems(qc: QueryClient, point: SequencePoint): Promise<GalleryFrame> {
  try {
    return frameOf(point, await qc.fetchQuery(galleryQuery(point.artifact_hash!)));
  } catch {
    return frameOf(point, []);
  }
}

/**
 * Warm one point for a card: its manifest and every item through `item`
 * when it is a gallery, else the point itself.
 */
export async function prefetchPointOrGallery(
  qc: QueryClient,
  point: SequencePoint,
  item: ((p: SequencePoint, signal: AbortSignal) => Promise<unknown>) | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (!isGalleryPoint(point)) {
    await item?.(point, signal);
    return;
  }
  const frame = await loadGalleryItems(qc, point);
  if (item) await Promise.allSettled(frame.itemPoints.map((p) => item(p, signal)));
}
