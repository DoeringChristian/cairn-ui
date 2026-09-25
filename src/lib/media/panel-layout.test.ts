import { test } from "node:test";
import assert from "node:assert/strict";
import {
  galleryColumns,
  gridValues,
  limitRuns,
  normalizeSlots,
  sampleValues,
  setLinked,
  slotValue,
} from "./panel-layout.ts";

test("gallery columns: auto is up to two, phones and single panes one, a count is capped", () => {
  assert.equal(galleryColumns("auto", 1, false), 1);
  assert.equal(galleryColumns("auto", 5, false), 2);
  assert.equal(galleryColumns("auto", 5, true), 1);
  assert.equal(galleryColumns(3, 5, false), 3);
  assert.equal(galleryColumns(4, 2, false), 2);
  assert.equal(galleryColumns(4, 2, true), 1);
  assert.equal(galleryColumns(0, 3, false), 1);
});

test("limitRuns keeps every item of the first N distinct runs", () => {
  const items = [
    { run: "a", k: 1 },
    { run: "b", k: 2 },
    { run: "a", k: 3 },
    { run: "c", k: 4 },
  ];
  assert.deepEqual(limitRuns(items, (i) => i.run, 2).map((i) => i.k), [1, 2, 3]);
  assert.deepEqual(limitRuns(items, (i) => i.run, 0).map((i) => i.k), [1, 2, 3, 4]);
  assert.deepEqual(limitRuns(items, (i) => i.run, 1).map((i) => i.k), [1, 3]);
});

test("sampleValues spreads evenly and keeps both ends", () => {
  const v = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.deepEqual(sampleValues(v, 3), [0, 50, 100]);
  assert.deepEqual(sampleValues(v, 5), [0, 30, 50, 80, 100]);
  assert.deepEqual(sampleValues(v, 20), v);
  assert.deepEqual(sampleValues(v, 1), [100]);
  assert.deepEqual(sampleValues([], 4), []);
  assert.deepEqual(sampleValues([1, 2], 2), [1, 2]);
});

test("gridValues: auto shows five columns", () => {
  const v = Array.from({ length: 50 }, (_, i) => i);
  assert.equal(gridValues(v, "auto").length, 5);
  assert.equal(gridValues(v, 3).length, 3);
});

test("normalizeSlots fills, clamps and repairs slots", () => {
  const panes = ["a", "b", "c"];
  assert.deepEqual(normalizeSlots(undefined, panes), [{ pane: "a" }, { pane: "b" }]);
  assert.deepEqual(normalizeSlots(undefined, panes, 9).length, 4);
  assert.deepEqual(normalizeSlots(undefined, panes, 4).map((s) => s.pane), ["a", "b", "c", "a"]);
  assert.deepEqual(normalizeSlots([{ pane: "c", value: 5 }], panes, 2), [{ pane: "c", value: 5 }, { pane: "a" }]);
  assert.deepEqual(normalizeSlots([{ pane: "gone" }, { pane: "a" }], panes), [{ pane: "b" }, { pane: "a" }]);
  assert.deepEqual(normalizeSlots([{ pane: "a" }, { pane: "b" }, { pane: "c" }], panes, 2).map((s) => s.pane), ["a", "b"]);
  assert.deepEqual(normalizeSlots([{ pane: "a" }], [], 2), []);
});

test("one pane: every slot shows it (same run at different values)", () => {
  assert.deepEqual(normalizeSlots(undefined, ["only"], 3).map((s) => s.pane), ["only", "only", "only"]);
});

test("linked slots follow the card; unlinked keep their own value", () => {
  assert.equal(slotValue({ pane: "a", value: 3 }, true, 7), 7);
  assert.equal(slotValue({ pane: "a", value: 3 }, false, 7), 3);
  assert.equal(slotValue({ pane: "a" }, false, 7), 7);
});

test("unlinking freezes slots at the current value; linking drops their values", () => {
  const slots = [{ pane: "a" }, { pane: "b", value: 2 }];
  assert.deepEqual(setLinked(slots, false, 9), [{ pane: "a", value: 9 }, { pane: "b", value: 2 }]);
  assert.deepEqual(setLinked(slots, true, 9), [{ pane: "a" }, { pane: "b" }]);
});
