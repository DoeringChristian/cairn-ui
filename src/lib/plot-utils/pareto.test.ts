import { test } from "node:test";
import assert from "node:assert/strict";
import { computeParetoFront, paretoLineShape } from "./pareto.ts";

const P = [
  { x: 1, y: 5 }, { x: 2, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 1 }, { x: 5, y: 2 },
];
const xs = (pts: { x: number }[]) => pts.map((p) => p.x).sort((a, b) => a - b);

test("each axis has its own direction", () => {
  assert.deepEqual(xs(computeParetoFront(P, { x: "min", y: "min" })), [1, 2, 4]);
  assert.deepEqual(xs(computeParetoFront(P, { x: "max", y: "max" })), [1, 3, 5]);
  assert.deepEqual(xs(computeParetoFront(P, { x: "min", y: "max" })), [1]);
  assert.deepEqual(xs(computeParetoFront(P, { x: "max", y: "min" })), [4, 5]);
});

test("a tie on both axes keeps one point; a tie on x keeps the better y", () => {
  const pts = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
  assert.equal(computeParetoFront(pts, { x: "min", y: "min" }).length, 1);
});

test("staircase follows the x direction", () => {
  assert.equal(paretoLineShape({ x: "min", y: "max" }), "hv");
  assert.equal(paretoLineShape({ x: "max", y: "min" }), "vh");
});
