/** Map an artifact mime type to cairn-plot's raw-buffer `format` hint. */
const FORMAT_BY_MIME: Record<string, "exr" | "npy"> = {
  "image/x-exr": "exr",
  "image/aces": "exr",
  "application/x-npy": "npy",
};

export function artifactFormat(mime: string | null | undefined): "exr" | "npy" | undefined {
  const value = mime?.toLowerCase() ?? "";
  const exact = FORMAT_BY_MIME[value];
  if (exact) return exact;
  if (value.includes("openexr") || value.endsWith("/exr")) return "exr";
  if (value.includes("numpy") || value.includes("npy")) return "npy";
  return undefined;
}

/** Image mime types every current browser decodes in an `<img>`. */
const BROWSER_IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
  "image/avif", "image/svg+xml", "image/bmp",
]);

export function isBrowserDisplayable(mime: string | null | undefined): boolean {
  return BROWSER_IMAGE_MIMES.has(mime?.toLowerCase() ?? "");
}

/**
 * Human label for how an artifact is stored, e.g. "EXR (dwab, half)".
 * Prefers the SDK's canonical `metadata.encoding` ("exr:dwab:half"), falling
 * back to the mime subtype.
 */
export function describeEncoding(mime: string | null | undefined, metadata?: { encoding?: unknown } | null): string {
  const encoding = typeof metadata?.encoding === "string" ? metadata.encoding : null;
  if (encoding) {
    const [container, ...options] = encoding.split(":").filter(Boolean);
    const name = container!.toUpperCase();
    return options.length ? `${name} (${options.join(", ")})` : name;
  }
  const subtype = mime?.split("/")[1]?.replace(/^x-/, "") ?? "unknown";
  return subtype.toUpperCase();
}
