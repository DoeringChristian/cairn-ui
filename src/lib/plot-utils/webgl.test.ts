import { test } from "node:test";
import assert from "node:assert/strict";
import { arrayLength, toWebGL, WEBGL_AUTO_THRESHOLD } from "./webgl.ts";

const pts = (n: number) => Array.from({ length: n }, (_, i) => i);
const sc = (n: number, extra: Record<string, unknown> = {}) => ({ type: "scatter", x: pts(n), y: pts(n), ...extra });

test("off leaves the figure as authored", () => {
  const data = [sc(50_000)];
  const r = toWebGL(data, {}, "off");
  assert.equal(r.data, data);
  assert.deepEqual(r.converted, []);
  assert.equal(r.points, 50_000);
});

test("auto converts only at or above the per-figure threshold", () => {
  assert.equal(WEBGL_AUTO_THRESHOLD, 1000);
  const small = [sc(400), sc(500)];
  assert.equal(toWebGL(small, {}, "auto").data, small);
  // Two traces of 600 points: the figure crosses the threshold, both convert.
  const big = [sc(600), sc(600)];
  const r = toWebGL(big, {}, "auto");
  assert.deepEqual(r.converted, [0, 1]);
  assert.deepEqual(r.data.map((t) => t.type), ["scattergl", "scattergl"]);
  assert.equal(toWebGL(small, {}, "auto", 100).converted.length, 2);
});

test("on converts any size; input traces are never mutated", () => {
  const t = sc(3);
  const data = [t];
  const r = toWebGL(data, {}, "on");
  assert.equal(r.data[0]!.type, "scattergl");
  assert.equal(t.type, "scatter");
  assert.notEqual(r.data, data);
  assert.equal(r.data[0]!.x, t.x);
});

test("missing type means scatter; other types are kept", () => {
  const data = [{ x: [1], y: [2] }, { type: "bar", x: [1], y: [2] }, { type: "scattergl", x: [1], y: [1] }, { type: "surface", z: [[1]] }];
  const r = toWebGL(data, {}, "on");
  assert.deepEqual(r.data.map((t) => t.type), ["scattergl", "bar", "scattergl", "surface"]);
  assert.deepEqual(r.converted, [0]);
  assert.equal(r.data[1], data[1]);
});

test("traces using what scattergl lacks stay SVG, with a reason", () => {
  const data = [
    sc(10, { line: { shape: "spline" } }),
    sc(10, { line: { shape: "hv" } }),
    sc(10, { stackgroup: "one" }),
    sc(10, { marker: { gradient: { type: "radial" } } }),
    sc(10, { fillpattern: { shape: "/" } }),
    sc(10, { cliponaxis: true, hoveron: "points", fillpattern: {} }),
    sc(10, { cliponaxis: false }),
    sc(10, { textfont: { shadow: "1px 1px 2px black" } }),
  ];
  const r = toWebGL(data, {}, "on");
  assert.deepEqual(r.converted, [1, 5]);
  assert.deepEqual(r.skipped.map((s) => s.index), [0, 2, 3, 4, 6, 7]);
  assert.match(r.skipped[0]!.reason, /spline/);
  assert.match(r.skipped[1]!.reason, /stackgroup/);
});

test("a fill chain converts together or not at all", () => {
  // 0 ← 1 (tonexty) and 1 is spline: 0 must stay SVG too.
  const data = [sc(10), sc(10, { fill: "tonexty", line: { shape: "spline" } }), sc(10, { fill: "tozeroy" })];
  const r = toWebGL(data, {}, "on");
  assert.deepEqual(r.converted, [2]);
  assert.match(r.skipped.find((s) => s.index === 0)!.reason, /fills/);
  // A chain of convertible traces converts whole.
  const ok = [sc(10), sc(10, { fill: "tonexty" }), sc(10, { fill: "tonexty" })];
  assert.deepEqual(toWebGL(ok, {}, "on").converted, [0, 1, 2]);
  // Chains are per subplot: a tonexty on y2 does not tie it to y's trace.
  const sub = [sc(10, { line: { shape: "spline" } }), sc(10, { yaxis: "y2" }), sc(10, { yaxis: "y2", fill: "tonexty" })];
  assert.deepEqual(toWebGL(sub, {}, "on").converted, [1, 2]);
  // Skips propagate along a longer chain in both directions.
  const long = [sc(10), sc(10, { fill: "tonexty" }), sc(10, { fill: "tonexty", stackgroup: "a" })];
  assert.deepEqual(toWebGL(long, {}, "on").converted, []);
});

test("arrayLength: arrays, typed arrays, plotly.py base64 encoding", () => {
  assert.equal(arrayLength([1, 2, 3]), 3);
  assert.equal(arrayLength(new Float32Array(7)), 7);
  // 3 float64 = 24 bytes = 32 base64 chars.
  assert.equal(arrayLength({ dtype: "f8", bdata: "A".repeat(32) }), 3);
  // 5 int8 = 5 bytes = "xxxxxxx=" (8 chars, 1 pad).
  assert.equal(arrayLength({ dtype: "i1", bdata: "AAAAAAA=" }), 5);
  assert.equal(arrayLength({ dtype: "f4", bdata: "", shape: "12" }), 12);
  assert.equal(arrayLength(undefined), 0);
  // Counted from the longer of x and y (y-only traces count too).
  assert.equal(toWebGL([{ type: "scatter", y: pts(1500) }], {}, "auto").converted.length, 1);
});
