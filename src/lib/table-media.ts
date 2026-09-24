/**
 * Media cells of a logged table. The SDK uploads each `cairn.Image` /
 * `Audio` / `Video` cell as its own artifact and stores
 * `{"$media": {hash, mime_type, object_type}}` in the cell.
 */

import { isBrowserDisplayable } from "./artifact-format.ts";

export interface MediaCell {
  hash: string;
  mime_type: string;
  object_type?: string | null;
}

/** The media reference in a cell, or null for any other value. */
export function mediaOf(v: unknown): MediaCell | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const m = (v as Record<string, unknown>)["$media"];
  if (m === null || typeof m !== "object") return null;
  const hash = (m as Record<string, unknown>).hash;
  if (typeof hash !== "string") return null;
  const mime = (m as Record<string, unknown>).mime_type;
  const objectType = (m as Record<string, unknown>).object_type;
  return {
    hash,
    mime_type: typeof mime === "string" ? mime : "",
    object_type: typeof objectType === "string" ? objectType : null,
  };
}

/** How a media cell displays: a browser-native image, audio, video, or a download. */
export function mediaKind(m: MediaCell): "image" | "audio" | "video" | "file" {
  const mime = m.mime_type.toLowerCase();
  if (isBrowserDisplayable(mime)) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}
