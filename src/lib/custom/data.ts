/**
 * Custom viewers: decoding a logged value for a viewer (pure; tested in
 * data.test.ts). `cairn.Data` stores a dict of arrays as `.npz`, JSON-able
 * values as JSON and `bytes` as they are; its artifact metadata says which
 * (`{kind, format, meta, arrays}`). The host decodes, so a viewer gets
 * `{name: {data: TypedArray, shape, dtype, order}}` without a zip reader.
 */

import { npzMembers } from "../parse-npz.ts";
import { parseNpyTyped, type TypedNpyArray } from "../parse-npy.ts";

export type CustomFormat = "npz" | "json" | "bytes";

export interface CustomMeta {
  kind: string;
  format: CustomFormat;
  meta: Record<string, unknown>;
  /** Shapes and dtypes of an npz's arrays, known before the blob loads. */
  arrays: Record<string, { shape: number[]; dtype: string }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

/** A point's artifact metadata (the JSON string or parsed) as custom-data metadata; null when it is none. */
export function parseCustomMeta(raw: unknown): CustomMeta | null {
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || typeof v.kind !== "string") return null;
  const format: CustomFormat = v.format === "json" || v.format === "bytes" ? v.format : "npz";
  const arrays: CustomMeta["arrays"] = {};
  if (isObj(v.arrays)) {
    for (const [k, a] of Object.entries(v.arrays)) {
      if (isObj(a) && Array.isArray(a.shape)) arrays[k] = { shape: a.shape.map(Number), dtype: String(a.dtype ?? "") };
    }
  }
  return { kind: v.kind, format, meta: isObj(v.meta) ? v.meta : {}, arrays };
}

const isZip = (b: ArrayBuffer) => {
  const h = new Uint8Array(b, 0, Math.min(2, b.byteLength));
  return h[0] === 0x50 && h[1] === 0x4b;
};
const isNpy = (b: ArrayBuffer) => {
  const h = new Uint8Array(b, 0, Math.min(6, b.byteLength));
  return h[0] === 0x93 && h[1] === 0x4e && h[2] === 0x55 && h[3] === 0x4d;
};

/** An `.npz` as `{name: {data, shape, dtype, order}}`, each array in its own buffer. */
export async function decodeNpz(buffer: ArrayBuffer): Promise<Record<string, TypedNpyArray>> {
  const members = await npzMembers(buffer);
  const out: Record<string, TypedNpyArray> = {};
  for (const [k, b] of Object.entries(members)) out[k] = parseNpyTyped(b);
  return out;
}

/**
 * The value a viewer gets for a blob of `format`. Fresh on every call (the
 * caller transfers its buffers to the frame). Without a format the bytes
 * decide: zip → npz, `.npy` → `{array: …}`, else raw bytes.
 */
export async function decodeForViewer(buffer: ArrayBuffer, format: string | null | undefined): Promise<unknown> {
  switch (format) {
    case "npz":
      return decodeNpz(buffer);
    case "json":
      return JSON.parse(new TextDecoder().decode(buffer));
    case "bytes":
      return buffer.slice(0);
    default:
      if (isZip(buffer)) return decodeNpz(buffer);
      if (isNpy(buffer)) return { array: parseNpyTyped(buffer) };
      return buffer.slice(0);
  }
}
