import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRuns, NO_GROUP_LABEL, quantiles, summarize } from "./grouping.ts";

test("groupRuns: value order, missing last, item order kept", () => {
  const items = [
    { id: "a", g: "beta" },
    { id: "b", g: null },
    { id: "c", g: "alpha" },
    { id: "d", g: "beta" },
    { id: "e", g: undefined },
  ];
  const groups = groupRuns(items, (i) => i.g);
  assert.deepEqual(groups.map((g) => g.label), ["alpha", "beta", NO_GROUP_LABEL]);
  assert.deepEqual(groups[1]!.items.map((i) => i.id), ["a", "d"]);
  assert.deepEqual(groups[2]!.items.map((i) => i.id), ["b", "e"]);
});

test("groupRuns: numbers sort numerically and stay distinct from strings", () => {
  const groups = groupRuns([10, 2, "2", 1e-3, true], (v) => v);
  assert.deepEqual(groups.map((g) => g.label), ["0.001", "2", "10", "true", "2"]);
  assert.equal(new Set(groups.map((g) => g.key)).size, 5);
});

test("quantiles: NumPy linear interpolation", () => {
  assert.deepEqual(quantiles([1, 2, 3, 4], [0, 0.25, 0.5, 0.75, 1]), [1, 1.75, 2.5, 3.25, 4]);
  assert.deepEqual(quantiles([5], [0.5]), [5]);
  assert.ok(Number.isNaN(quantiles([], [0.5])[0]!));
  assert.deepEqual(quantiles([3, NaN, 1, Infinity], [0.5]), [2]);
});

test("summarize", () => {
  const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.n, 8);
  assert.equal(s.mean, 5);
  assert.ok(Math.abs(s.std - Math.sqrt(32 / 7)) < 1e-12);
  assert.equal(s.median, 4.5);
  assert.equal(s.min, 2);
  assert.equal(s.max, 9);
  assert.equal(summarize([3]).std, 0);
});
