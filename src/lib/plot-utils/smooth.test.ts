import { test } from "node:test";
import assert from "node:assert/strict";
import { smoothSeries, SMOOTHING_KINDS, type SmoothingKind } from "./smooth.ts";
import type { SeriesPoint } from "./types.ts";

const pts = (ys: number[], xs?: number[]): SeriesPoint[] =>
  ys.map((y, i) => ({ x: xs ? xs[i]! : i, y }));

const close = (a: number[], b: number[]) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-9, `${i}: ${v} vs ${b[i]}`));

const kinds = Object.keys(SMOOTHING_KINDS) as SmoothingKind[];

test("value 0 is off for every kind", () => {
  const p = pts([1, 2, 3]);
  for (const k of kinds) {
    const r = smoothSeries(p, k, 0);
    assert.equal(r.smoothed, p);
    assert.equal(r.raw, null);
  }
});

test("empty input is a no-op", () => {
  for (const k of kinds) assert.deepEqual(smoothSeries([], k, 5), { smoothed: [], raw: null });
});

test("smoothing keeps x and extra fields, and returns the raw points", () => {
  const p: SeriesPoint[] = [{ x: 1, y: 1, wallTime: "t", context: "c" }, { x: 2, y: 3 }];
  for (const k of kinds) {
    const r = smoothSeries(p, k, SMOOTHING_KINDS[k].defaultValue);
    assert.equal(r.raw, p);
    assert.deepEqual(r.smoothed.map((q) => q.x), [1, 2]);
    assert.equal(r.smoothed[0]!.wallTime, "t");
    assert.equal(r.smoothed[0]!.context, "c");
  }
});

test("constant series stays constant", () => {
  const p = pts([4, 4, 4, 4, 4], [0, 1, 5, 6, 20]);
  for (const k of kinds) {
    for (const y of smoothSeries(p, k, SMOOTHING_KINDS[k].defaultValue).smoothed.map((q) => q.y)) {
      assert.ok(Math.abs(y - 4) < 1e-9, `${k}: ${y}`);
    }
  }
});

test("ema: y = a*prev + (1-a)*raw seeded with the first point", () => {
  close(smoothSeries(pts([0, 10, 10]), "ema", 0.5).smoothed.map((p) => p.y), [0, 5, 7.5]);
});

test("twema: debiased start, regular steps", () => {
  // acc: 0.5*0 -> 0.5*1*... weights: w0=.5, w1=.75; acc0=0, acc1=.5*0+.5*10=5 -> 5/.75
  close(smoothSeries(pts([0, 10]), "twema", 0.5).smoothed.map((p) => p.y), [0, 5 / 0.75]);
});

test("twema: a bigger x gap forgets more", () => {
  const even = smoothSeries(pts([0, 0, 10], [0, 1, 2]), "twema", 0.8).smoothed[2]!.y;
  const gap = smoothSeries(pts([0, 0, 10], [0, 1, 20]), "twema", 0.8).smoothed[2]!.y;
  assert.ok(gap > even);
});

test("gaussian: symmetric kernel, renormalised at the edges", () => {
  const r = smoothSeries(pts([0, 0, 9, 0, 0]), "gaussian", 1).smoothed.map((p) => p.y);
  assert.ok(Math.abs(r[1]! - r[3]!) < 1e-12);
  assert.ok(r[2]! < 9 && r[2]! > r[1]!);
  // Edge renormalisation: a linear ramp's interior is preserved exactly.
  const ramp = smoothSeries(pts([0, 1, 2, 3, 4, 5, 6, 7, 8]), "gaussian", 1).smoothed;
  assert.ok(Math.abs(ramp[4]!.y - 4) < 1e-9);
});

test("window: trailing mean with a short start", () => {
  close(smoothSeries(pts([3, 6, 9, 12]), "window", 2).smoothed.map((p) => p.y), [3, 4.5, 7.5, 10.5]);
});

test("window of 1 is off", () => {
  assert.equal(smoothSeries(pts([1, 2]), "window", 1).raw, null);
});
