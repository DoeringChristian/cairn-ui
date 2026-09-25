/**
 * Galleries: several media values of one kind logged under one name and
 * step (`run.track([a, b, c], name, step)`). The point's artifact is a JSON
 * manifest naming each item's own artifact:
 *
 *     {"items": [{"hash", "mime_type", "metadata", "caption"?}, ...]}
 *
 * under `GALLERY_MIME`, and the point's `object_type` is the items' kind, so
 * the kind's card shows it. Every card turns a gallery point into ITEM
 * points (`galleryItemPoints`) and renders each one exactly as it renders a
 * plain point of its kind.
 *
 * Pure: runs under `node --test`.
 */

import type { SequencePoint } from "../../api/types.ts";

/** A gallery point's artifact (cairn.sdk.gallery.GALLERY_MIME). */
export const GALLERY_MIME = "application/vnd.cairn.gallery+json";

export interface GalleryItem {
  hash: string;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  /** The item's own caption (its wrapper's `caption=`). */
  caption: string | null;
}

export function isGalleryPoint(point: SequencePoint | null | undefined): boolean {
  return point?.artifact_mime === GALLERY_MIME && !!point.artifact_hash;
}

/** How many items a gallery point holds, from its metadata (1 for a plain point, 0 for none). */
export function galleryCount(point: SequencePoint | null | undefined): number {
  if (!point?.artifact_hash) return 0;
  if (!isGalleryPoint(point)) return 1;
  try {
    const n = (JSON.parse(point.artifact_metadata ?? "{}") as { gallery?: unknown }).gallery;
    return typeof n === "number" && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/** The manifest's items; malformed entries are dropped, a malformed manifest has none. */
export function parseGalleryManifest(raw: unknown): GalleryItem[] {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((i): GalleryItem[] => {
    if (!i || typeof i !== "object" || typeof (i as { hash?: unknown }).hash !== "string") return [];
    const e = i as { hash: string; mime_type?: unknown; metadata?: unknown; caption?: unknown };
    return [{
      hash: e.hash,
      mime_type: typeof e.mime_type === "string" ? e.mime_type : null,
      metadata: e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>) : null,
      caption: typeof e.caption === "string" && e.caption !== "" ? e.caption : null,
    }];
  });
}

/**
 * Each item as a point of its own: the gallery point's step and kind, the
 * item's artifact. Captions are not carried (a gallery shows each item's
 * caption itself, see `GalleryItem.caption`), so a renderer that labels a
 * point by its caption does not label an item twice.
 */
export function galleryItemPoints(point: SequencePoint, items: readonly GalleryItem[]): SequencePoint[] {
  return items.map((item) => ({
    ...point,
    artifact_hash: item.hash,
    artifact_mime: item.mime_type,
    artifact_size: null,
    artifact_metadata: JSON.stringify(item.metadata ?? {}),
    metadata: null,
  }));
}

/**
 * Columns of a gallery's grid: `columns` when set (capped at the item
 * count), else a near-square grid (at most `max` wide).
 */
export function galleryGridColumns(count: number, columns: number | "auto" = "auto", max = Infinity): number {
  if (count <= 1) return 1;
  if (columns !== "auto" && columns > 0) return Math.min(columns, count);
  return Math.min(max, Math.ceil(Math.sqrt(count)));
}
