/**
 * Decoded images, shared by every media card.
 *
 * `decodeImage(src)` loads an image off-DOM and waits for `img.decode()`, so
 * the pixels are ready to paint. The `HTMLImageElement` is kept in a bounded
 * LRU: holding it keeps the resource in the browser's memory cache, which is
 * what makes a later `<img src>` with the same URL complete synchronously —
 * the pane can then swap to it within one commit, with no blank frame.
 *
 * Artifact URLs are content addressed (`/api/artifacts/<sha256>`, served
 * `immutable`), so a URL is a cache key for its bytes: every card that shows
 * the same artifact shares one decode and one HTTP cache entry.
 */

import { AsyncCache, LoadAborted, LruCache } from "./frame-loader.ts";

export interface DecodedImage {
  src: string;
  width: number;
  height: number;
  /** False when the image failed to load or decode (the pane shows it broken). */
  ok: boolean;
}

/** Decoded RGBA budget: ~512 MB, a few hundred full-HD frames. */
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 600;
/** A load that never answers stops holding the previous frame after this long. */
const LOAD_TIMEOUT_MS = 15_000;

const elements = new Map<string, HTMLImageElement>();
const cache = new AsyncCache<DecodedImage>(
  new LruCache<DecodedImage>({
    maxEntries: MAX_ENTRIES,
    maxWeight: MAX_BYTES,
    weigh: (d) => Math.max(1, d.width * d.height * 4),
    onEvict: (src) => elements.delete(src),
  }),
);

/** The decoded image, when `src` is ready to paint right now. */
export function peekDecoded(src: string): DecodedImage | undefined {
  return cache.peek(src);
}

function load(src: string, signal: AbortSignal): Promise<DecodedImage> {
  return new Promise<DecodedImage>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    let done = false;
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
    // Nobody wants it any more: cancel the request so it stops taking bandwidth.
    const onAbort = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.removeAttribute("src");
      reject(new LoadAborted());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (!ok) {
        reject(new Error(`image ${src} failed to load`));
        return;
      }
      elements.set(src, img);
      resolve({ src, width: img.naturalWidth, height: img.naturalHeight, ok: true });
    };
    img.src = src;
    img.decode().then(
      () => finish(img.naturalWidth > 0),
      // decode() rejects for some valid images (e.g. an SVG without a size); trust `load`.
      () => {
        if (img.complete) finish(img.naturalWidth > 0);
        else {
          img.onload = () => finish(img.naturalWidth > 0);
          img.onerror = () => finish(false);
        }
      },
    );
  });
}

/**
 * Load and decode `src`. A failure resolves `ok: false` (and is not cached,
 * so the next request retries) — the frame still swaps, and the pane shows
 * the broken image instead of holding the previous one forever. Rejects only
 * with `LoadAborted` when `signal` aborts; the request itself is cancelled
 * once every caller waiting on it has aborted.
 */
export function decodeImage(src: string, signal?: AbortSignal): Promise<DecodedImage> {
  return cache.load(src, (sig) => load(src, sig), signal).catch((err: unknown) => {
    if (err instanceof LoadAborted) throw err;
    return { src, width: 0, height: 0, ok: false };
  });
}
