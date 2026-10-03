/**
 * What a viewer shows: stored bytes named by their content hash, plus what is
 * known about them before they load. A card's artifact, an artifact
 * version's file and a table's media cell are all one `ViewerSource`, so
 * every surface hands the same viewer the same thing, and the bytes are
 * fetched (and cached) once by hash whichever surface asks first.
 */

import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { ArtifactEntryInfo } from "../../api/types";

export interface ViewerSource {
  /** Content hash: immutable bytes, so every cache keys on it. */
  hash: string;
  /** Where an element (`<img>`, `<video>`, a download link) loads the bytes. */
  url: string;
  /** A file name: downloads, labels, and (by its extension) the viewer and the code language. */
  name: string;
  mime: string | null;
  /** Byte size, when known. */
  size: number | null;
  /** The cairn type it was logged as, if any. */
  objectType: string | null;
  /** The handler's metadata (an image's overlays, a video's fps, an audio clip's peaks…). */
  meta: Record<string, unknown> | null;
}

/** A stored artifact by hash (a card's point, a table's media cell). */
export function hashSource(
  hash: string,
  opts: { name?: string; mime?: string | null; size?: number | null; objectType?: string | null; meta?: Record<string, unknown> | null } = {},
): ViewerSource {
  return {
    hash,
    url: api.artifactUrl(hash),
    name: opts.name ?? hash.slice(0, 12),
    mime: opts.mime ?? null,
    size: opts.size ?? null,
    objectType: opts.objectType ?? null,
    meta: opts.meta ?? null,
  };
}

/** One stored file of an artifact version (`entry.digest` must be set). */
export function entrySource(versionId: string, entry: ArtifactEntryInfo): ViewerSource {
  return {
    hash: entry.digest!,
    // Served with the entry's mime type and file name.
    url: api.artifactVersionFileUrl(versionId, entry.path),
    name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
    mime: entry.mime,
    size: entry.size,
    objectType: entry.object_type,
    meta: entry.meta && Object.keys(entry.meta).length > 0 ? entry.meta : null,
  };
}

/**
 * An artifact's bytes as text, through the query cache. The hash names
 * immutable content, so a fetched text is never refetched, and a card can
 * prefetch the steps around its slider with the very query its panes read.
 */
export const artifactTextQuery = (hash: string) => ({
  queryKey: qk.artifactText(hash),
  queryFn: async (): Promise<string> => {
    const res = await fetch(api.artifactUrl(hash));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },
  staleTime: Infinity,
});

/** The first `bytes` of an artifact as text (a Range request): the head of a file too big to show whole. */
export const artifactTextHeadQuery = (hash: string, bytes: number) => ({
  queryKey: qk.artifactTextHead(hash, bytes),
  queryFn: async (): Promise<string> => {
    const res = await fetch(api.artifactUrl(hash), { headers: { Range: `bytes=0-${bytes - 1}` } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, bytes));
  },
  staleTime: Infinity,
});

/**
 * The text query a viewer reads for `source`: the whole text (shared with
 * the cards' cache), or only its first `maxBytes` when it is known to be
 * bigger. `cut` says the text is a head.
 */
export function sourceTextQuery(
  source: Pick<ViewerSource, "hash" | "size">,
  maxBytes?: number,
): { query: { queryKey: readonly unknown[]; queryFn: () => Promise<string>; staleTime: number }; cut: boolean } {
  const cut = maxBytes != null && source.size != null && source.size > maxBytes;
  return { query: cut ? artifactTextHeadQuery(source.hash, maxBytes) : artifactTextQuery(source.hash), cut };
}
