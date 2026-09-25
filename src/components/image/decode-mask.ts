/**
 * Decode a base64 class-id mask PNG (lib/png-gray — exact bytes, no canvas
 * readback). Results are cached by the PNG text, so every pane and the
 * class legend share one decode per mask.
 */

import { base64ToBytes, decodeGrayPng, type GrayImage } from "../../lib/png-gray";
import { AsyncCache, LruCache } from "../../lib/media/frame-loader";

const cache = new AsyncCache<GrayImage>(new LruCache<GrayImage>({ maxEntries: 256 }));

export function decodeMask(pngB64: string): Promise<GrayImage> {
  return cache.load(pngB64, () => decodeGrayPng(base64ToBytes(pngB64)));
}

/** The decoded mask, when it is ready now (an image frame decodes its masks before it swaps in). */
export function peekMask(pngB64: string): GrayImage | undefined {
  return cache.peek(pngB64);
}
