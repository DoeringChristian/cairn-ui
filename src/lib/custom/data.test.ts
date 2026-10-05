/** Custom data decoding (npz → typed arrays, json, bytes). Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import { zipStore } from "../zip.ts";
import { decodeForViewer, decodeNpz, parseCustomMeta } from "./data.ts";

/** A v1.0 `.npy` exactly as numpy.save writes it (data on a 64-byte boundary). */
function npy(descr: string, payload: Uint8Array, shape: number[], fortran = false): Uint8Array {
  const dict = `{'descr': '${descr}', 'fortran_order': ${fortran ? "True" : "False"}, 'shape': (${shape.map((n) => `${n},`).join(" ")}), }`;
  const pad = (64 - ((10 + dict.length + 1) % 64)) % 64;
  const header = `${dict}${" ".repeat(pad)}\n`;
  const bytes = new Uint8Array(10 + header.length + payload.length);
  bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  new DataView(bytes.buffer).setUint16(8, header.length, true);
  for (let i = 0; i < header.length; i++) bytes[10 + i] = header.charCodeAt(i);
  bytes.set(payload, 10 + header.length);
  return bytes;
}
const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

function npz(): ArrayBuffer {
  const be = new Uint8Array(8);
  new DataView(be.buffer).setInt32(0, 7, false);
  new DataView(be.buffer).setInt32(4, -2, false);
  const i64 = new BigInt64Array([5n, -3n]);
  const half = new Uint16Array([0x3c00, 0xc000]); // 1, -2
  const z = zipStore([
    { name: "mu.npy", data: npy("<f4", u8(new Float32Array([1, 2, 3, 4, 5, 6])), [2, 3]) },
    { name: "w.npy", data: npy("<f8", u8(new Float64Array([0.25])), [1]) },
    { name: "idx.npy", data: npy(">i4", be, [2]) },
    { name: "big.npy", data: npy("<i8", u8(i64), [2]) },
    { name: "h.npy", data: npy("<f2", u8(half), [2]) },
    { name: "mask.npy", data: npy("|b1", new Uint8Array([1, 0, 1]), [3], true) },
    { name: "s.npy", data: npy("<u2", u8(new Uint16Array([9])), []) },
  ]);
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

test("npz → native typed arrays with shape, dtype and order", async () => {
  const out = await decodeNpz(npz());
  assert.ok(out.mu!.data instanceof Float32Array);
  assert.deepEqual([...out.mu!.data], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(out.mu!.shape, [2, 3]);
  assert.equal(out.mu!.dtype, "float32");
  assert.equal(out.mu!.order, "C");
  assert.ok(out.w!.data instanceof Float64Array);
  assert.ok(out.idx!.data instanceof Int32Array);
  assert.deepEqual([...out.idx!.data], [7, -2], "big-endian converted");
  assert.ok(out.big!.data instanceof Float64Array, "int64 widens to float64");
  assert.deepEqual([...out.big!.data], [5, -3]);
  assert.equal(out.big!.dtype, "int64");
  assert.ok(out.h!.data instanceof Float32Array);
  assert.deepEqual([...out.h!.data], [1, -2]);
  assert.ok(out.mask!.data instanceof Uint8Array);
  assert.equal(out.mask!.dtype, "bool");
  assert.equal(out.mask!.order, "F");
  assert.deepEqual(out.s!.shape, []);
  assert.deepEqual([...out.s!.data], [9]);
});

test("every array owns its buffer (transferable without detaching the others)", async () => {
  const out = await decodeNpz(npz());
  const buffers = Object.values(out).map((a) => a.data.buffer);
  assert.equal(new Set(buffers).size, buffers.length);
  for (const a of Object.values(out)) assert.equal(a.data.byteLength, a.data.buffer.byteLength);
});

test("decodeForViewer: by format, else sniffed", async () => {
  const json = new TextEncoder().encode(`{"a":[1,2]}`).buffer as ArrayBuffer;
  assert.deepEqual(await decodeForViewer(json, "json"), { a: [1, 2] });
  const raw = new Uint8Array([1, 2, 3]).buffer;
  const bytes = (await decodeForViewer(raw, "bytes")) as ArrayBuffer;
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  assert.notEqual(bytes, raw, "a copy: the cached blob stays usable");
  const merged = (await decodeForViewer(npz(), "npz", { n: 3, mu: "shadowed" })) as Record<string, unknown>;
  assert.equal(merged.n, 3);
  assert.ok((merged.mu as { data: unknown }).data instanceof Float32Array, "arrays win over values");
  const sniffed = (await decodeForViewer(npz(), null)) as Record<string, unknown>;
  assert.ok("mu" in sniffed);
  const one = npy("<f4", u8(new Float32Array([1, 2])), [2]);
  const arr = (await decodeForViewer(one.buffer as ArrayBuffer, undefined)) as { array: { data: Float32Array } };
  assert.deepEqual([...arr.array.data], [1, 2]);
});

test("parseCustomMeta", () => {
  assert.deepEqual(parseCustomMeta(JSON.stringify({ kind: "guiding/vmf", format: "npz", meta: { lobes: 3 }, arrays: { mu: { shape: [3, 3], dtype: "float32" } } })), {
    kind: "guiding/vmf", format: "npz", meta: { lobes: 3 }, arrays: { mu: { shape: [3, 3], dtype: "float32" } }, values: {},
  });
  assert.deepEqual(parseCustomMeta({ kind: "x", format: "json" }), { kind: "x", format: "json", meta: {}, arrays: {}, values: {} });
  assert.equal(parseCustomMeta("not json"), null);
  assert.equal(parseCustomMeta({ format: "npz" }), null);
  assert.equal(parseCustomMeta(null), null);
});
