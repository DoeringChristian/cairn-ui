/**
 * Decode a base64 class-id mask PNG (lib/png-gray — exact bytes, no canvas
 * readback). Results are cached by the PNG text, so every pane and the
 * class legend share one decode per mask.
 */

import { base64ToBytes, decodeGrayPng, type GrayImage } from "../../lib/png-gray";

const CACHE_LIMIT = 64;
const cache = new Map<string, Promise<GrayImage>>();

export function decodeMask(pngB64: string): Promise<GrayImage> {
  const hit = cache.get(pngB64);
  if (hit) {
    // Refresh recency.
    cache.delete(pngB64);
    cache.set(pngB64, hit);
    return hit;
  }
  const p = decodeGrayPng(base64ToBytes(pngB64));
  p.catch(() => cache.delete(pngB64));
  cache.set(pngB64, p);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return p;
}

/** Colourised mask pixels (RGBA) → a PNG data URL for an SVG `<image>`. */
export function maskDataUrl(width: number, height: number, rgba: Uint8ClampedArray): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}
