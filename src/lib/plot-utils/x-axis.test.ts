import { test } from "node:test";
import assert from "node:assert/strict";
import { asOfLookup, mapToXAxis } from "./x-axis.ts";

const pt = (step: number, y: number | null) => ({
  step,
  scalar_value: y,
  wall_time: "2024-01-01T00:00:00Z",
});

test("asOfLookup takes the value at the largest step <= the query", () => {
  const at = asOfLookup([pt(10, 1), pt(0, 0), pt(20, 2), pt(15, null)]);
  assert.equal(at(-1), null);
  assert.equal(at(0), 0);
  assert.equal(at(9), 0);
  assert.equal(at(10), 1);
  assert.equal(at(19), 1);
  assert.equal(at(1000), 2);
  assert.equal(asOfLookup([])(5), null);
});

test("metric mode maps each point to the x-metric as of its step", () => {
  const loss = [pt(0, 5), pt(5, 4), pt(10, 3), pt(12, 2)];
  const epoch = [pt(0, 0), pt(10, 1)];
  const out = mapToXAxis(loss, "metric", null, epoch);
  assert.deepEqual(out.map((p) => [p.x, p.y]), [[0, 5], [0, 4], [1, 3], [1, 2]]);
});

test("metric mode drops points before the x-metric starts, and waits for it", () => {
  const loss = [pt(0, 5), pt(5, 4)];
  assert.deepEqual(mapToXAxis(loss, "metric", null, [pt(3, 1)]).map((p) => p.x), [1]);
  assert.deepEqual(mapToXAxis(loss, "metric", null, undefined), []);
  // Other sources ignore the x-metric.
  assert.deepEqual(mapToXAxis(loss, "step", null, [pt(3, 1)]).map((p) => p.x), [0, 5]);
});
