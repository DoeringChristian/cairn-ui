/**
 * Media values in a run's summary document (`summary_doc`): the SDK stores
 * each `run.summary(key=cairn.Figure(...))` as a marker leaf
 * `{"$media": {hash, object_type, mime_type, caption?}}`. The Overview's
 * summary tree shows a marker as a thumbnail (lib/media/summary-series.ts has
 * the same value as a card series).
 *
 * Pure: runs under `node --test`.
 */

import { isBrowserDisplayable } from "../artifact-format.ts";
import { GALLERY_MIME, type GalleryItem } from "./gallery.ts";

export interface SummaryMedia {
  hash: string;
  mime_type: string;
  object_type: string;
  caption: string | null;
}

/** The media marker `v` is, or null for any other value. */
export function summaryMediaOf(v: unknown): SummaryMedia | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== "$media") return null;
  const m = (v as Record<string, unknown>)["$media"];
  if (m === null || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  if (typeof r.hash !== "string" || typeof r.object_type !== "string") return null;
  return {
    hash: r.hash,
    mime_type: typeof r.mime_type === "string" ? r.mime_type : "",
    object_type: r.object_type,
    caption: typeof r.caption === "string" ? r.caption : null,
  };
}

export function isGalleryMedia(m: SummaryMedia): boolean {
  return m.mime_type === GALLERY_MIME;
}

/** Most thumbnails a gallery shows before "+N". */
export const GALLERY_THUMBS = 4;

export type SummaryThumb =
  /** Small images (one for a value, up to `GALLERY_THUMBS` for a gallery) and how many more there are. */
  | { kind: "images"; hashes: string[]; more: number }
  /** A kind with no picture: its icon and name. */
  | { kind: "icon"; objectType: string };

/**
 * What the summary tree shows for a media value: an image or figure as a
 * thumbnail; a gallery of them as up to four thumbnails plus "+N" (`items`:
 * its manifest, undefined while it loads); anything else as an icon and its
 * kind's name.
 */
export function summaryThumb(m: SummaryMedia, items?: readonly GalleryItem[]): SummaryThumb {
  if (isGalleryMedia(m)) {
    if (!items) return { kind: "images", hashes: [], more: 0 };
    const pictures = items.filter((i) => isBrowserDisplayable(i.mime_type));
    if (pictures.length === 0) return { kind: "icon", objectType: m.object_type };
    return {
      kind: "images",
      hashes: pictures.slice(0, GALLERY_THUMBS).map((i) => i.hash),
      more: Math.max(0, items.length - GALLERY_THUMBS),
    };
  }
  if (isBrowserDisplayable(m.mime_type)) return { kind: "images", hashes: [m.hash], more: 0 };
  return { kind: "icon", objectType: m.object_type };
}

/** The leaves of a summary document, a media marker counting as one. */
export function summaryLeafCount(doc: unknown): number {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return 0;
  let n = 0;
  for (const v of Object.values(doc)) {
    if (summaryMediaOf(v) || v === null || typeof v !== "object" || Array.isArray(v)) n += 1;
    else n += summaryLeafCount(v);
  }
  return n;
}
