/** The viewer frame protocol. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import { decodeFrameMessage, hostMessage, PROTOCOL_VERSION, transferables } from "./protocol.ts";

test("host messages carry the version", () => {
  assert.deepEqual(hostMessage({ type: "cairn:view", view: { a: 1 } }), { type: "cairn:view", view: { a: 1 }, v: PROTOCOL_VERSION });
});

test("frame messages: known fields kept, unknown fields dropped", () => {
  assert.deepEqual(decodeFrameMessage({ type: "cairn:ready", sdk: "1", extra: 1, v: 7 }), { type: "cairn:ready", sdk: "1" });
  assert.deepEqual(decodeFrameMessage({ type: "cairn:rendered", seq: 3, future: true }), { type: "cairn:rendered", seq: 3 });
  assert.deepEqual(decodeFrameMessage({ type: "cairn:size", height: 120, width: 9 }), { type: "cairn:size", height: 120 });
  assert.deepEqual(decodeFrameMessage({ type: "cairn:error", message: "boom", stack: "at x", code: 1 }), { type: "cairn:error", message: "boom", stack: "at x" });
  assert.deepEqual(decodeFrameMessage({ type: "cairn:error" }), { type: "cairn:error", message: "viewer error" });
});

test("unknown types and malformed messages are null", () => {
  for (const m of [null, 1, "cairn:ready", [], {}, { type: "cairn:hack" }, { type: "cairn:rendered" }, { type: "cairn:size", height: -1 }, { type: "cairn:size", height: NaN }, { type: "cairn:view" }]) {
    assert.equal(decodeFrameMessage(m), null, JSON.stringify(m));
  }
});

test("views are JSON copies; non-JSON views are refused", () => {
  const view = { position: [1, 2, 3], target: [0, 0, 0] };
  const m = decodeFrameMessage({ type: "cairn:view", view, final: true });
  assert.deepEqual(m, { type: "cairn:view", view, final: true });
  assert.notEqual((m as { view: unknown }).view, view);
  assert.deepEqual(decodeFrameMessage({ type: "cairn:view", view: 2 }), { type: "cairn:view", view: 2, final: false });
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  assert.equal(decodeFrameMessage({ type: "cairn:view", view: cyc }), null);
  assert.equal(decodeFrameMessage({ type: "cairn:view", view: { s: "x".repeat(70_000) } }), null);
});

test("snapshots accept image data URLs only", () => {
  assert.deepEqual(decodeFrameMessage({ type: "cairn:snapshot", id: 1, url: "data:image/png;base64,AAAA" }), { type: "cairn:snapshot", id: 1, url: "data:image/png;base64,AAAA" });
  assert.deepEqual(decodeFrameMessage({ type: "cairn:snapshot", id: 1, url: "javascript:alert(1)" }), { type: "cairn:snapshot", id: 1, url: null });
  assert.deepEqual(decodeFrameMessage({ type: "cairn:snapshot", id: 1, url: "data:text/html;base64,AAAA" }), { type: "cairn:snapshot", id: 1, url: null });
  assert.equal(decodeFrameMessage({ type: "cairn:snapshot", url: "data:image/png;base64,AAAA" }), null);
});

test("transferables: every buffer once", () => {
  const a = new Float32Array(4);
  const b = new ArrayBuffer(8);
  const list = transferables([{ data: { x: { data: a }, y: { data: new Uint8Array(a.buffer) } } }, { data: b }, "s", 1, null]);
  assert.deepEqual(list, [a.buffer, b]);
});
