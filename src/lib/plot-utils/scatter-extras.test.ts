import { test } from "node:test";
import assert from "node:assert/strict";
import { axisRange, linearFit, refLineShapes, regressionLine, runningStat } from "./scatter-extras.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("linearFit: exact line, r2, degenerate inputs", () => {
  const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7])!;
  close(f.slope, 2);
  close(f.intercept, 1);
  close(f.r2, 1);
  assert.equal(f.n, 4);
  assert.equal(linearFit([1], [1]), null);
  assert.equal(linearFit([2, 2, 2], [1, 2, 3]), null);
  close(linearFit([0, 1, 2], [5, 5, 5])!.slope, 0);
  const noisy = linearFit([0, 1, 2, 3], [0, 2, 1, 3])!;
  assert.ok(noisy.r2 > 0 && noisy.r2 < 1);
});

test("regressionLine: fit in log space on log axes, ends at the x extent", () => {
  const pts = [1, 10, 100].map((x) => ({ x, y: 2 * Math.log10(x) + 1 }));
  const line = regressionLine(pts, { xLog: true })!;
  assert.deepEqual(line.x, [1, 100]);
  close(line.y[0]!, 1);
  close(line.y[1]!, 5);
  // Points that cannot sit on a log axis are dropped.
  assert.equal(regressionLine([{ x: -1, y: 1 }, { x: 1, y: 1 }], { xLog: true }), null);
});

test("runningStat: cumulative, sorted by x, ties folded", () => {
  const pts = [{ x: 3, y: 1 }, { x: 1, y: 5 }, { x: 2, y: 3 }, { x: 2, y: 7 }];
  assert.deepEqual(runningStat(pts, "min"), { x: [1, 2, 3], y: [5, 3, 1] });
  assert.deepEqual(runningStat(pts, "max"), { x: [1, 2, 3], y: [5, 7, 7] });
  assert.deepEqual(runningStat(pts, "mean"), { x: [1, 2, 3], y: [5, 5, 4] });
  assert.deepEqual(runningStat([], "mean"), { x: [], y: [] });
});

test("refLineShapes: x → vertical, y → horizontal, labels, log units, cap", () => {
  const { shapes, annotations } = refLineShapes(
    [
      { axis: "x", value: 100, label: "budget" },
      { axis: "y", value: 0.5 },
      { axis: "x", value: -1 },
    ],
    { xLog: true, color: "#888" },
  );
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0]!.x0, 2);
  assert.equal(shapes[0]!.yref, "paper");
  assert.equal(shapes[1]!.y0, 0.5);
  assert.equal(shapes[1]!.xref, "paper");
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0]!.text, "budget");
  const many = Array.from({ length: 8 }, (_, i) => ({ axis: "y" as const, value: i }));
  assert.equal(refLineShapes(many, { color: "#888" }).shapes.length, 5);
});

test("axisRange: auto, one-sided, fixed, log", () => {
  assert.deepEqual(axisRange({ min: null, max: null, log: false }), { autorange: true });
  assert.deepEqual(axisRange({ min: 0, max: null, log: false }), { autorange: "max", range: [0, null] });
  assert.deepEqual(axisRange({ min: null, max: 5, log: false }), { autorange: "min", range: [null, 5] });
  assert.deepEqual(axisRange({ min: 1, max: 1000, log: true }), { autorange: false, range: [0, 3] });
  assert.deepEqual(axisRange({ min: -1, max: 10, log: true }), { autorange: true });
});
