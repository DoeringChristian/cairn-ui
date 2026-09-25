import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketPoints } from "./bucket.ts";
import type { SeriesPoint } from "./types.ts";

const line = (n: number, f: (i: number) => number): SeriesPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: f(i) }));

test("few points: returned unchanged, no band", () => {
  const pts = line(5, (i) => i);
  const out = bucketPoints(pts, { lo: null, hi: null, buckets: 10 });
  assert.equal(out.bucketed, false);
  assert.deepEqual(out.line, pts);
  assert.deepEqual(out.lo, []);
});

test("dense points: one mean per bucket with its min and max", () => {
  // 0..99 over 10 buckets of width 9.9: bucket 0 holds x 0..9.
  const out = bucketPoints(line(100, (i) => (i % 2 ? 10 : 0)), { lo: null, hi: null, buckets: 10 });
  assert.equal(out.bucketed, true);
  assert.equal(out.line.length, 10);
  assert.deepEqual([out.lo[0]!.y, out.hi[0]!.y], [0, 10]);
  assert.equal(out.line[0]!.y, 5);
  // Every bucket sits at its centre, shared by lo / hi.
  assert.deepEqual(out.line.map((p) => p.x), out.lo.map((p) => p.x));
  assert.ok(Math.abs(out.line[0]!.x - 4.95) < 1e-9);
});

test("zoomed: only the visible range is bucketed; the nearest outside points stay", () => {
  const out = bucketPoints(line(1000, (i) => i), { lo: 100, hi: 199, buckets: 10 });
  assert.equal(out.bucketed, true);
  assert.equal(out.line[0]!.x, 99);
  assert.equal(out.line[out.line.length - 1]!.x, 200);
  assert.equal(out.line.length, 12);
  // Recomputing for a narrower range gives finer buckets.
  const finer = bucketPoints(line(1000, (i) => i), { lo: 100, hi: 105, buckets: 10 });
  assert.equal(finer.bucketed, false);
});

test("log x buckets are equally wide in log space", () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ x: 1 + i, y: 1 }));
  const out = bucketPoints(pts, { lo: 1, hi: 1000, buckets: 3, log: true });
  assert.equal(out.line.length, 3);
  assert.ok(Math.abs(out.line[0]!.x - Math.pow(1000, 1 / 6)) < 1e-9);
});
