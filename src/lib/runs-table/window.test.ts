import assert from "node:assert/strict";
import test from "node:test";

import { longest, nextWindow, padding, prefixSums, rangeIn } from "./window.ts";

const rows = (n: number, h = 10) => prefixSums(new Array(n).fill(h));

test("prefixSums: offsets and the total", () => {
  assert.deepEqual(prefixSums([3, 5, 2]), [0, 3, 8, 10]);
  assert.deepEqual(prefixSums([]), [0]);
});

test("rangeIn: the items overlapping a span", () => {
  const o = prefixSums([10, 20, 10, 30]); // 0 10 30 40 70
  assert.deepEqual(rangeIn(o, 0, 10), { start: 0, end: 1 });
  assert.deepEqual(rangeIn(o, 5, 31), { start: 0, end: 3 });
  assert.deepEqual(rangeIn(o, 10, 30), { start: 1, end: 2 });
  assert.deepEqual(rangeIn(o, -50, 5), { start: 0, end: 1 });
  assert.deepEqual(rangeIn(o, 65, 500), { start: 3, end: 4 });
  // Past the end, or empty: nothing.
  assert.deepEqual(rangeIn(o, 100, 200), { start: 4, end: 4 });
  assert.deepEqual(rangeIn(o, 20, 20), { start: 1, end: 1 });
  assert.deepEqual(rangeIn([0], 0, 100), { start: 0, end: 0 });
});

test("nextWindow: the visible rows plus the overscan", () => {
  const o = rows(1000);
  assert.deepEqual(nextWindow(o, 0, 100, 50, null), { start: 0, end: 15 });
  assert.deepEqual(nextWindow(o, 5000, 5100, 50, null), { start: 495, end: 515 });
  assert.deepEqual(nextWindow(o, 9950, 10400, 50, null), { start: 990, end: 1000 });
});

test("nextWindow keeps the rendered range while it covers the view", () => {
  const o = rows(1000);
  const cur = nextWindow(o, 5000, 5100, 50, null);
  // Scrolled within the overscan: the same object (nothing re-renders).
  assert.equal(nextWindow(o, 5030, 5130, 50, cur), cur);
  // Scrolled past it: a new range around the view.
  assert.deepEqual(nextWindow(o, 5100, 5200, 50, cur), { start: 505, end: 525 });
  // A range far larger than needed (e.g. after a jump) is replaced.
  assert.deepEqual(nextWindow(o, 5000, 5100, 50, { start: 0, end: 1000 }), { start: 495, end: 515 });
  // Fewer rows than the range: recomputed.
  assert.deepEqual(nextWindow(rows(10), 0, 100, 50, { start: 0, end: 15 }), { start: 0, end: 10 });
});

test("nextWindow always includes the row to keep (focus)", () => {
  const o = rows(1000);
  assert.deepEqual(nextWindow(o, 5000, 5100, 50, null, 3), { start: 3, end: 515 });
  assert.deepEqual(nextWindow(o, 5000, 5100, 50, null, 600), { start: 495, end: 601 });
  assert.deepEqual(nextWindow(o, 5000, 5100, 50, null, 5000), { start: 495, end: 515 });
});

test("padding: the spacers stand in for the rows not rendered", () => {
  const o = prefixSums([10, 20, 10, 30]);
  assert.deepEqual(padding(o, { start: 1, end: 3 }), { before: 10, after: 30 });
  assert.deepEqual(padding(o, { start: 0, end: 4 }), { before: 0, after: 0 });
  assert.deepEqual(padding([0], { start: 0, end: 0 }), { before: 0, after: 0 });
});

test("longest: the k longest items, the earlier one on ties, empty ones never", () => {
  const items = ["bb", "a", "dddd", "", "cc", "eeee", "ffff"];
  assert.deepEqual(longest(items, (s) => s.length, 3), ["dddd", "eeee", "ffff"]);
  assert.deepEqual(longest(items, (s) => s.length, 5), ["dddd", "eeee", "ffff", "bb", "cc"]);
  assert.deepEqual(longest(["", ""], (s) => s.length), []);
  assert.deepEqual(longest([], (s: string) => s.length), []);
});
