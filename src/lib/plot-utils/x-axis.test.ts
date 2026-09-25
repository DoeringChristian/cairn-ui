import { test } from "node:test";
import assert from "node:assert/strict";
import { asOfLookup } from "./x-axis.ts";

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
