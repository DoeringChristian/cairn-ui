import { test } from "node:test";
import assert from "node:assert/strict";
import {
  limitTiles,
  maxCount,
  normalizeAxes,
  planGallery,
  planGrid,
  primaryIndex,
  relinkSlots,
  resolveSlot,
  selectIndices,
  stepIndex,
  valuesInRange,
  type CompareLinks,
  type IndexSelection,
  type PlanData,
} from "./media-plan.ts";

const sel = (patch: Partial<IndexSelection> = {}): IndexSelection => ({
  indexMode: "all",
  indexOne: 0,
  indexFrom: 0,
  indexTo: 3,
  indexFirst: 4,
  ...patch,
});

/** Two runs, steps 0..9, lists of 8 (run 1 has 6 at step 9). */
const data = (patch: Partial<PlanData> = {}): PlanData => ({
  runs: 2,
  values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  current: 9,
  lists: true,
  countAt: (run, value) => (run === 1 && value === 9 ? 6 : 8),
  ...patch,
});

const plain = (patch: Partial<PlanData> = {}) => data({ lists: false, countAt: () => 1, ...patch });

test("index: all, one, range, first N", () => {
  assert.deepEqual(selectIndices(sel(), 4), [0, 1, 2, 3]);
  assert.deepEqual(selectIndices(sel({ indexMode: "one", indexOne: 2 }), 8), [2]);
  assert.deepEqual(selectIndices(sel({ indexMode: "range", indexFrom: 2, indexTo: 4 }), 8), [2, 3, 4]);
  assert.deepEqual(selectIndices(sel({ indexMode: "first", indexFirst: 3 }), 8), [0, 1, 2]);
});

test("index: clamped to the list; a range's ends in either order; empty lists select nothing", () => {
  assert.deepEqual(selectIndices(sel({ indexMode: "one", indexOne: 12 }), 8), [7]);
  assert.deepEqual(selectIndices(sel({ indexMode: "one", indexOne: -3 }), 8), [0]);
  assert.deepEqual(selectIndices(sel({ indexMode: "range", indexFrom: 6, indexTo: 20 }), 8), [6, 7]);
  assert.deepEqual(selectIndices(sel({ indexMode: "range", indexFrom: 3, indexTo: 1 }), 8), [1, 2, 3]);
  assert.deepEqual(selectIndices(sel({ indexMode: "first", indexFirst: 20 }), 3), [0, 1, 2]);
  assert.deepEqual(selectIndices(sel({ indexMode: "first", indexFirst: 0 }), 3), [0]);
  assert.deepEqual(selectIndices(sel({ indexMode: "one", indexOne: 2 }), 0), []);
  assert.equal(primaryIndex(sel({ indexMode: "range", indexFrom: 2, indexTo: 5 }), 8), 2);
  assert.equal(primaryIndex(sel(), 0), 0);
});

test("the header stepper moves One within the list", () => {
  assert.equal(stepIndex(3, 1, 8), 4);
  assert.equal(stepIndex(7, 1, 8), 7);
  assert.equal(stepIndex(0, -1, 8), 0);
  assert.equal(stepIndex(5, 0, 0), 0);
});

test("gallery, content run: one pane per run, its selected items", () => {
  const p = planGallery(data(), sel({ indexMode: "first", indexFirst: 2 }), "run", "auto");
  assert.equal(p.layout, "panes");
  assert.deepEqual(p.tiles.map((t) => [t.run, t.value, t.items]), [[0, 9, [0, 1]], [1, 9, [0, 1]]]);
});

test("gallery, content index: one tile per selected item of each run, at the slider's value", () => {
  const p = planGallery(data(), sel({ indexMode: "range", indexFrom: 4, indexTo: 7 }), "index", "auto");
  assert.equal(p.layout, "tiles");
  // Run 1 has 6 items at step 9: its range is clamped to 4..5.
  assert.deepEqual(p.tiles.map((t) => [t.run, t.items]), [[0, [4]], [0, [5]], [0, [6]], [0, [7]], [1, [4]], [1, [5]]]);
  assert.equal(p.columns, 2); // near-square of the widest run (4)
  assert.equal(planGallery(data(), sel(), "index", 3).columns, 3);
});

test("gallery, content step: tiles over sampled values for the first selected item", () => {
  const p = planGallery(data(), sel({ indexMode: "one", indexOne: 5 }), "step", 3);
  assert.deepEqual(p.tiles.map((t) => [t.run, t.value, t.items]), [
    [0, 0, [5]], [0, 5, [5]], [0, 9, [5]],
    [1, 0, [5]], [1, 5, [5]], [1, 9, [5]],
  ]);
  assert.equal(p.columns, 3);
  // auto: the grid's 5 columns, one row per run.
  assert.equal(planGallery(data(), sel(), "step", "auto").columns, 5);
});

test("gallery without lists: index content is the per-run panes; step tiles carry no items", () => {
  const p = planGallery(plain(), sel(), "index", "auto");
  assert.equal(p.layout, "panes");
  assert.deepEqual(p.tiles.map((t) => t.items), [null, null]);
  assert.deepEqual(planGallery(plain(), sel(), "step", 2).tiles.map((t) => [t.run, t.value, t.items]), [
    [0, 0, null], [0, 9, null], [1, 0, null], [1, 9, null],
  ]);
});

test("grid axes: distinct, no index axis without lists", () => {
  assert.deepEqual(normalizeAxes("step", "run", true), { x: "step", y: "run" });
  assert.deepEqual(normalizeAxes("step", "index", true), { x: "step", y: "index" });
  assert.deepEqual(normalizeAxes("index", "index", true), { x: "index", y: "step" });
  assert.deepEqual(normalizeAxes("step", "index", false), { x: "step", y: "run" });
  assert.deepEqual(normalizeAxes("index", "run", false), { x: "step", y: "run" });
  assert.deepEqual(normalizeAxes("run", "index", false), { x: "run", y: "step" });
});

test("grid X step × Y run (today's grid): the Index selection fills each cell", () => {
  const g = planGrid(data(), sel({ indexMode: "first", indexFirst: 2 }), { x: "step", y: "run", columns: 3, rows: 30 });
  assert.deepEqual(g.columns, [{ axis: "step", value: 0 }, { axis: "step", value: 5 }, { axis: "step", value: 9 }]);
  assert.deepEqual(g.rows, [{ y: { axis: "run", run: 0 } }, { y: { axis: "run", run: 1 } }]);
  assert.deepEqual(g.cells[1]!.map((t) => [t.run, t.value, t.items]), [[1, 0, [0, 1]], [1, 5, [0, 1]], [1, 9, [0, 1]]]);
});

test("grid X step × Y index with a step range: runs fold into the rows", () => {
  const g = planGrid(data(), sel({ indexMode: "range", indexFrom: 1, indexTo: 2 }), {
    x: "step", y: "index", stepFrom: 2, stepTo: 4, columns: "auto", rows: 30,
  });
  assert.deepEqual(g.columns.map((c) => (c.axis === "step" ? c.value : null)), [2, 3, 4]);
  assert.deepEqual(g.rows, [
    { y: { axis: "index", index: 1 }, run: 0 },
    { y: { axis: "index", index: 2 }, run: 0 },
    { y: { axis: "index", index: 1 }, run: 1 },
    { y: { axis: "index", index: 2 }, run: 1 },
  ]);
  assert.deepEqual(g.cells[3]!.map((t) => [t.run, t.value, t.items]), [[1, 2, [2]], [1, 3, [2]], [1, 4, [2]]]);
});

test("grid X index × Y step: the step axis samples up to the rows cap; X run × Y index", () => {
  const g = planGrid(data({ runs: 1 }), sel({ indexMode: "first", indexFirst: 3 }), { x: "index", y: "step", columns: "auto", rows: 4 });
  assert.deepEqual(g.columns.map((c) => (c.axis === "index" ? c.index : null)), [0, 1, 2]);
  assert.deepEqual(g.rows.map((r) => (r.y.axis === "step" ? r.y.value : null)), [0, 3, 6, 9]);
  assert.deepEqual(g.cells[2]![1], { id: "grid:2:1", run: 0, value: 6, items: [1] });
  const h = planGrid(data(), sel({ indexMode: "one", indexOne: 1 }), { x: "run", y: "index", columns: "auto", rows: 30 });
  assert.deepEqual(h.cells.map((row) => row.map((t) => [t.run, t.value, t.items])), [[[0, 9, [1]], [1, 9, [1]]]]);
});

test("grid rows cap and media limit (whole rows)", () => {
  const capped = planGrid(data({ runs: 40, countAt: () => 1, lists: false }), sel(), { x: "step", y: "run", columns: 5, rows: 30 });
  assert.equal(capped.rows.length, 30);
  assert.equal(capped.hiddenRows, 10);
  const limited = planGrid(data({ runs: 40, lists: false }), sel(), { x: "step", y: "run", columns: 5, rows: 30, limit: 12 });
  assert.equal(limited.rows.length, 2);
  assert.equal(limited.columns.length, 5);
  const narrow = planGrid(data({ lists: false }), sel(), { x: "step", y: "run", columns: 5, rows: 30, limit: 3 });
  assert.deepEqual([narrow.rows.length, narrow.columns.length], [1, 3]);
});

test("steps range: inclusive, open ends, ends in either order", () => {
  const v = [0, 2, 4, 6, 8];
  assert.deepEqual(valuesInRange(v, 2, 6), [2, 4, 6]);
  assert.deepEqual(valuesInRange(v, null, 3), [0, 2]);
  assert.deepEqual(valuesInRange(v, 5, undefined), [6, 8]);
  assert.deepEqual(valuesInRange(v, 6, 2), [2, 4, 6]);
});

test("maxCount: the widest list over runs and values; 0 without lists", () => {
  assert.equal(maxCount(data(), [9]), 8);
  assert.equal(maxCount(plain(), [9]), 0);
});

const links = (patch: Partial<CompareLinks> = {}): CompareLinks => ({
  compareRun: "individual",
  compareStep: "linked",
  compareIndex: "linked",
  ...patch,
});

test("compare: linked variables take the card's, individual ones the slot's", () => {
  const panes = ["a", "b"];
  const slot = { pane: "b", value: 3, index: 5 };
  // Default: own run, the slider's value, the Index selection.
  assert.deepEqual(resolveSlot(slot, 0, links(), panes, data(), sel({ indexMode: "first", indexFirst: 2 })), {
    id: "compare:0", run: 1, value: 9, items: [0, 1],
  });
  // Everything individual: the slot's run, value and item.
  const own = links({ compareStep: "individual", compareIndex: "individual" });
  assert.deepEqual(resolveSlot(slot, 1, own, panes, data(), sel()), { id: "compare:1", run: 1, value: 3, items: [5] });
  // Linked run: the first run, whatever the slot names.
  assert.equal(resolveSlot(slot, 0, links({ compareRun: "linked" }), panes, data(), sel()).run, 0);
  // Individual step without a value yet: the slider's.
  assert.equal(resolveSlot({ pane: "a" }, 0, own, panes, data(), sel()).value, 9);
  // No lists: no items.
  assert.equal(resolveSlot(slot, 0, own, panes, plain(), sel()).items, null);
  // A slot naming no pane.
  assert.equal(resolveSlot({ pane: "x" }, 0, links(), panes, data(), sel()).run, -1);
});

test("compare: going individual freezes slots; linking drops their own value or item", () => {
  const slots = [{ pane: "a" }, { pane: "b", value: 2, index: 1 }];
  assert.deepEqual(relinkSlots(slots, "step", "individual", { value: 9, index: 0 }), [
    { pane: "a", value: 9 }, { pane: "b", value: 2, index: 1 },
  ]);
  assert.deepEqual(relinkSlots(slots, "index", "individual", { value: 9, index: 4 }), [
    { pane: "a", index: 4 }, { pane: "b", value: 2, index: 1 },
  ]);
  assert.deepEqual(relinkSlots(slots, "step", "linked", { value: 9, index: 0 }), [{ pane: "a" }, { pane: "b", index: 1 }]);
  assert.deepEqual(relinkSlots(slots, "index", "linked", { value: 9, index: 0 }), [{ pane: "a" }, { pane: "b", value: 2 }]);
});

test("media limit keeps the first N tiles; Show all keeps every tile", () => {
  assert.deepEqual(limitTiles([1, 2, 3, 4], 2), [1, 2]);
  assert.deepEqual(limitTiles([1, 2, 3], null), [1, 2, 3]);
  assert.deepEqual(limitTiles([1, 2, 3], 0), [1, 2, 3]);
});
