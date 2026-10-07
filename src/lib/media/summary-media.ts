/**
 * Media values in a run's summary document (`summary_doc`): the SDK stores
 * each `run.summary(key=cairn.Figure(...))` as a marker leaf
 * `{"$media": {hash, object_type, mime_type, caption?}}`. The Overview's
 * summary tree shows a marker as a thumbnail (lib/media/summary-series.ts has
 * the same value as a card series).
 *
 * Pure: runs under `node --test`.
 */

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

/**
 * The Overview's text for a summary media value: its kind, and for a
 * gallery the item count ("6 images", "1 figure"); "images" until the
 * gallery's items are loaded.
 */
export function summaryMediaLabel(m: SummaryMedia, items?: readonly GalleryItem[]): string {
  const kind = m.object_type === "pickle" ? "artifact" : m.object_type;
  if (!isGalleryMedia(m)) return kind;
  if (!items) return `${kind}s`;
  return `${items.length} ${kind}${items.length === 1 ? "" : "s"}`;
}
