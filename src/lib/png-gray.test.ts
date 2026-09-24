import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { base64ToBytes, decodeGrayPng, unfilterGray8 } from "./png-gray.ts";

// PIL: Image.fromarray(a, "L").save(..., "PNG", optimize=True)
const PIL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAAAAACs8akEAAAAH0lEQVR42mNggABGBgZGBob/DEwMqICRQU5OTk5ODgAc+QG5R9rvNQAAAABJRU5ErkJggg==";
const PIL_PIXELS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 60, 90, 120, 150, 180,
];

test("decodes a PIL-written grayscale PNG exactly", async () => {
  const img = await decodeGrayPng(base64ToBytes(PIL_PNG));
  assert.equal(img.width, 7);
  assert.equal(img.height, 5);
  assert.deepEqual([...img.data], PIL_PIXELS);
});

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Forward-filter `pixels` with one filter type per row. */
function filterRows(pixels: number[], width: number, filters: number[]): Uint8Array {
  const out: number[] = [];
  filters.forEach((f, y) => {
    out.push(f);
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!;
      const a = x > 0 ? pixels[y * width + x - 1]! : 0;
      const b = y > 0 ? pixels[(y - 1) * width + x]! : 0;
      const c = x > 0 && y > 0 ? pixels[(y - 1) * width + x - 1]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!;
      out.push((v - pred) & 255);
    }
  });
  return Uint8Array.from(out);
}

test("unfilters every PNG filter type", () => {
  const width = 4;
  const pixels = [9, 200, 3, 255, 0, 7, 250, 1, 128, 128, 5, 6, 77, 1, 2, 200, 3, 4, 5, 6];
  const filters = [0, 1, 2, 3, 4];
  assert.deepEqual([...unfilterGray8(filterRows(pixels, width, filters), width, 5)], pixels);
});

test("decodes multi-IDAT PNGs and rejects non-gray ones", async () => {
  const width = 3, height = 2;
  const pixels = [1, 2, 3, 4, 5, 6];
  const z = deflateSync(filterRows(pixels, width, [1, 4]));
  const chunk = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(12 + body.length);
    new DataView(b.buffer).setUint32(0, body.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(body, 8);
    return b; // CRC left zero; the decoder doesn't check it
  };
  const ihdr = (colorType: number) => {
    const h = new Uint8Array(13);
    const v = new DataView(h.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    h[8] = 8;
    h[9] = colorType;
    return h;
  };
  const png = (colorType: number) => {
    const parts = [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr(colorType)),
      chunk("IDAT", z.subarray(0, 5)),
      chunk("IDAT", z.subarray(5)),
      chunk("IEND", new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  assert.deepEqual([...(await decodeGrayPng(png(0))).data], pixels);
  await assert.rejects(decodeGrayPng(png(2)), /unsupported mask PNG/);
  await assert.rejects(decodeGrayPng(new Uint8Array(20)), /not a PNG/);
});
