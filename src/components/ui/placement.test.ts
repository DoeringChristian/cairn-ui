import { test } from "node:test";
import assert from "node:assert/strict";
import { ANCHOR_GAP, VIEWPORT_PADDING, computePlacement } from "./placement.ts";

const vw = 1280;
const vh = 800;
const anchorAt = (left: number, top: number, w = 24, h = 24) => ({
  left, top, right: left + w, bottom: top + h,
});

test("opens below, end-aligned to the anchor", () => {
  const p = computePlacement({
    anchor: anchorAt(600, 100), viewportWidth: vw, viewportHeight: vh,
    width: 320, naturalHeight: 200, align: "end",
  });
  assert.equal(p.side, "below");
  assert.equal(p.top, 124 + ANCHOR_GAP);
  assert.equal(p.left, 624 - 320);
  assert.equal(p.width, 320);
});

test("flips above when it only fits there", () => {
  const p = computePlacement({
    anchor: anchorAt(600, 700), viewportWidth: vw, viewportHeight: vh,
    width: 320, naturalHeight: 300, align: "end",
  });
  assert.equal(p.side, "above");
  assert.equal(p.top, 700 - ANCHOR_GAP - 300);
});

test("clamps horizontally into the viewport", () => {
  const start = computePlacement({
    anchor: anchorAt(1270, 100, 8), viewportWidth: vw, viewportHeight: vh,
    width: 256, naturalHeight: 100, align: "start",
  });
  assert.equal(start.left, vw - VIEWPORT_PADDING - 256);
  const end = computePlacement({
    anchor: anchorAt(4, 100), viewportWidth: vw, viewportHeight: vh,
    width: 320, naturalHeight: 100, align: "end",
  });
  assert.equal(end.left, VIEWPORT_PADDING);
});

test("never wider than the viewport minus padding", () => {
  const p = computePlacement({
    anchor: anchorAt(100, 100), viewportWidth: 375, viewportHeight: 812,
    width: 640, naturalHeight: 100, align: "start",
  });
  assert.equal(p.width, 375 - 2 * VIEWPORT_PADDING);
  assert.equal(p.left, VIEWPORT_PADDING);
});

test("a panel taller than its side scrolls within the room on that side", () => {
  const p = computePlacement({
    anchor: anchorAt(600, 300), viewportWidth: vw, viewportHeight: vh,
    width: 320, naturalHeight: 2000, align: "end",
  });
  assert.equal(p.side, "below");
  assert.equal(p.maxHeight, vh - 324 - ANCHOR_GAP - VIEWPORT_PADDING);
});

test("an off-screen anchor still yields an on-screen panel", () => {
  const p = computePlacement({
    anchor: anchorAt(600, -500), viewportWidth: vw, viewportHeight: vh,
    width: 320, naturalHeight: 300, align: "end",
  });
  assert.ok(p.top >= VIEWPORT_PADDING);
  assert.ok(p.top + Math.min(300, p.maxHeight) <= vh - VIEWPORT_PADDING);
});
