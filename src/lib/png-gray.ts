/**
 * Decode an 8-bit grayscale PNG (colour type 0, as the SDK writes class-id
 * masks) to its raw bytes, without a canvas: canvas readback is not exact in
 * every browser (anti-fingerprinting adds ±1 noise), and class ids must be.
 * Inflates with the platform `DecompressionStream` (browsers, Node ≥ 18).
 */

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, row-major. */
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo PNG scanline filters for 1 byte per pixel. `raw` holds `height` rows of [filter, ...width bytes]. */
export function unfilterGray8(raw: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (width + 1)]!;
    const src = y * (width + 1) + 1;
    const row = y * width;
    const up = row - width;
    for (let x = 0; x < width; x++) {
      const v = raw[src + x]!;
      const a = x > 0 ? out[row + x - 1]! : 0;
      const b = y > 0 ? out[up + x]! : 0;
      const c = x > 0 && y > 0 ? out[up + x - 1]! : 0;
      let r: number;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${f}`);
      }
      out[row + x] = r & 255;
    }
  }
  return out;
}

export async function decodeGrayPng(bytes: Uint8Array): Promise<GrayImage> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  const idat: Uint8Array[] = [];
  for (let off = 8; off + 8 <= bytes.length;) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      const depth = body[8], colorType = body[9], interlace = body[12];
      if (depth !== 8 || colorType !== 0 || interlace !== 0) {
        throw new Error(`unsupported mask PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of idat) { joined.set(c, at); at += c.length; }
  const raw = await inflate(joined);
  if (raw.length < height * (width + 1)) throw new Error("truncated PNG data");
  return { width, height, data: unfilterGray8(raw, width, height) };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
