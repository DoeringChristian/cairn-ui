import { test } from "node:test";
import assert from "node:assert/strict";
import { fillWithin, stackColumns } from "./stack.ts";

test("fillWithin holds the last value inside the range, null outside", () => {
  assert.deepEqual(fillWithin([null, 1, null, 3, null]), [null, 1, 1, 3, null]);
  assert.deepEqual(fillWithin([null, null]), [null, null]);
});

test("stacked: cumulative tops, a missing line contributes nothing", () => {
  const tops = stackColumns([[1, 2, 3], [10, null, 30], [null, 100, null]], "stacked");
  // Line 1 holds 10 at column 1 (as-of); line 2 exists only at column 1.
  assert.deepEqual(tops, [[1, 2, 3], [11, 12, 33], [11, 112, 33]]);
});

test("stacked: a column where no lower line has a value stays null", () => {
  assert.deepEqual(stackColumns([[null, 1], [null, 2]], "stacked"), [[null, 1], [null, 3]]);
});

test("percent: tops as a share of the column total; a zero total is null", () => {
  const tops = stackColumns([[1, 0], [3, 0]], "percent");
  assert.deepEqual(tops, [[25, null], [100, null]]);
});
