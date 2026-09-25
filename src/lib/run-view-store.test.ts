import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRunView,
  isEmptyRunView,
  parseRunView,
  toggleRunBaseline,
  toggleRunHidden,
  toggleRunPinned,
} from "./run-view-store.ts";

test("parseRunView drops malformed parts and duplicates", () => {
  assert.deepEqual(parseRunView(null), { hidden: [], pinned: [], baseline: null });
  assert.deepEqual(parseRunView({ hidden: ["a", 1, "a"], pinned: "x", baseline: "" }), { hidden: ["a"], pinned: [], baseline: null });
  assert.deepEqual(parseRunView({ hidden: [], pinned: ["p"], baseline: "b" }), { hidden: [], pinned: ["p"], baseline: "b" });
});

test("toggles and applyRunView", () => {
  let v = parseRunView(null);
  assert.ok(isEmptyRunView(v));
  v = toggleRunHidden(v, "b");
  v = toggleRunPinned(v, "d");
  v = toggleRunPinned(v, "c");
  v = toggleRunBaseline(v, "a");
  assert.deepEqual(v, { hidden: ["b"], pinned: ["d", "c"], baseline: "a" });
  assert.deepEqual(applyRunView(["a", "b", "c", "d"], v), ["c", "d", "a"]);
  assert.equal(toggleRunBaseline(v, "a").baseline, null);
  assert.deepEqual(toggleRunHidden(v, "b").hidden, []);
  assert.ok(!isEmptyRunView(v));
});
