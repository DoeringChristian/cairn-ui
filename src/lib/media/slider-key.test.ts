import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STEP_KEY,
  formatKeyValue,
  indexAsOf,
  resolveAtValue,
  sliderIndex,
  sliderTrack,
  unionValues,
} from "./slider-key.ts";

const kp = (pairs: Array<[number, number | null]>) => pairs.map(([step, v]) => ({ step, scalar_value: v }));

test("the step key maps every step to itself, sorted and unique", () => {
  assert.deepEqual(sliderTrack([30, 10, 20, 10], STEP_KEY), [
    { value: 10, step: 10 },
    { value: 20, step: 20 },
    { value: 30, step: 30 },
  ]);
});

test("a metric key is looked up as of each step; shared values resolve to their last step", () => {
  // epoch 0 logged at step 0, epoch 1 at step 100, epoch 2 at step 200
  const epoch = kp([[0, 0], [100, 1], [200, 2]]);
  assert.deepEqual(sliderTrack([50, 99, 100, 150, 250], "epoch", epoch), [
    { value: 0, step: 99 },
    { value: 1, step: 150 },
    { value: 2, step: 250 },
  ]);
});

test("steps before the key's first point have no value and are dropped", () => {
  const epoch = kp([[100, 1]]);
  assert.deepEqual(sliderTrack([10, 50, 100], "epoch", epoch), [{ value: 1, step: 100 }]);
});

test("null and non-finite key values are skipped by the as-of lookup", () => {
  const epoch = kp([[0, 0], [10, null], [20, Number.NaN]]);
  assert.deepEqual(sliderTrack([15, 25], "epoch", epoch), [{ value: 0, step: 25 }]);
});

test("a metric key that is not loaded (or absent) gives an empty track", () => {
  assert.deepEqual(sliderTrack([1, 2], "epoch", undefined), []);
  assert.deepEqual(sliderTrack([1, 2], "epoch", []), []);
});

test("non-monotonic keys: ordered by value, a value returned to resolves to its latest step", () => {
  const phase = kp([[0, 1], [10, 2], [20, 1], [30, 0.5]]);
  assert.deepEqual(sliderTrack([5, 15, 25, 35], "phase", phase), [
    { value: 0.5, step: 35 },
    { value: 1, step: 25 },
    { value: 2, step: 15 },
  ]);
});

test("unsorted key points are sorted before the lookup", () => {
  const epoch = kp([[200, 2], [0, 0], [100, 1]]);
  assert.deepEqual(sliderTrack([150], "epoch", epoch), [{ value: 1, step: 150 }]);
});

test("resolveAtValue is as-of on the value, null below the first unless nearest", () => {
  const track = [{ value: 1, step: 100 }, { value: 3, step: 300 }];
  assert.equal(resolveAtValue(track, 1), 100);
  assert.equal(resolveAtValue(track, 2), 100);
  assert.equal(resolveAtValue(track, 3), 300);
  assert.equal(resolveAtValue(track, 99), 300);
  assert.equal(resolveAtValue(track, 0), null);
  assert.equal(resolveAtValue(track, 0, { nearest: true }), 100);
  assert.equal(resolveAtValue([], 0, { nearest: true }), null);
});

test("two runs reach the same epoch at different steps", () => {
  const a = sliderTrack([100, 200, 300], "epoch", kp([[0, 1], [150, 2], [250, 3]]));
  const b = sliderTrack([200, 400, 600], "epoch", kp([[0, 1], [300, 2], [500, 3]]));
  assert.equal(resolveAtValue(a, 2), 200);
  assert.equal(resolveAtValue(b, 2), 400);
  assert.deepEqual(unionValues([a, b]), [1, 2, 3]);
});

test("unionValues merges tracks and plain value lists", () => {
  assert.deepEqual(unionValues([[3, 1], [{ value: 2, step: 0 }], []]), [1, 2, 3]);
});

test("indexAsOf and sliderIndex land on the value or the one below", () => {
  const values = [10, 20, 30];
  assert.equal(indexAsOf(values, 5), -1);
  assert.equal(indexAsOf(values, 20), 1);
  assert.equal(indexAsOf(values, 25), 1);
  assert.equal(sliderIndex(values, 25), 1);
  assert.equal(sliderIndex(values, 5), 0);
  assert.equal(sliderIndex(values, 1e9), 2);
  assert.equal(sliderIndex(values, undefined), 0);
  assert.equal(sliderIndex([], 20), 0);
});

test("formatKeyValue keeps integers and trims floats", () => {
  assert.equal(formatKeyValue(12), "12");
  assert.equal(formatKeyValue(0.123456), "0.1235");
  assert.equal(formatKeyValue(2.5), "2.5");
});
