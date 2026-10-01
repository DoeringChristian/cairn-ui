import { test } from "node:test";
import assert from "node:assert/strict";
import { glContextEstimate, isGlTraceType, planBudget, Visibility, type BudgetEntry } from "./gl-budget.ts";

const e = (id: number, over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  id, weight: 1, visibility: Visibility.Away, pinned: false, live: false, lastUse: 0, ...over,
});
const sorted = (s: Iterable<number>) => [...s].sort((a, b) => a - b);

test("glContextEstimate: scenes, the shared 2D layer, parcoords, maps; SVG is 0", () => {
  assert.equal(glContextEstimate([{ type: "scatter" }, { type: "bar" }, {}]), 0);
  assert.equal(glContextEstimate([{ type: "surface" }]), 1);
  assert.equal(glContextEstimate([{ type: "surface" }, { type: "scatter3d" }]), 1);
  assert.equal(glContextEstimate([{ type: "surface" }, { type: "scatter3d", scene: "scene2" }]), 2);
  assert.equal(glContextEstimate([{ type: "scattergl" }, { type: "scattergl", xaxis: "x2" }]), 2);
  assert.equal(glContextEstimate([{ type: "scattergl" }, { type: "parcoords" }]), 3);
  assert.equal(glContextEstimate([{ type: "scattermap" }, { type: "scattermap", subplot: "map2" }, { type: "mesh3d" }]), 3);
  assert.ok(isGlTraceType("splom") && isGlTraceType("volume") && !isGlTraceType("scatter") && !isGlTraceType(undefined));
});

test("visible plots fill the budget; the rest wait", () => {
  const entries = [1, 2, 3, 4, 5].map((id) => e(id, { visibility: Visibility.Visible, weight: 2, lastUse: id }));
  const plan = planBudget(entries, 6);
  // Most recently used first.
  assert.deepEqual(sorted(plan.live), [3, 4, 5]);
  assert.deepEqual(sorted(plan.activate), [3, 4, 5]);
  assert.deepEqual(plan.deactivate, []);
});

test("pinned beats visible beats near; away plots linger only while room remains", () => {
  const entries = [
    e(1, { live: true, lastUse: 9 }), // away, live, recent
    e(2, { live: true, lastUse: 1 }), // away, live, stale
    e(3, { visibility: Visibility.Near }),
    e(4, { visibility: Visibility.Visible }),
    e(5, { pinned: true }),
  ];
  const plan = planBudget(entries, 4);
  assert.deepEqual(sorted(plan.live), [1, 3, 4, 5]);
  assert.deepEqual(plan.deactivate, [2]);
  assert.deepEqual(sorted(plan.activate), [3, 4, 5]);
  // Tighter: near plot no longer fits, both lingering ones go.
  const tight = planBudget(entries, 2);
  assert.deepEqual(sorted(tight.live), [4, 5]);
  assert.deepEqual(sorted(tight.deactivate), [1, 2]);
});

test("live visible plots are not swapped for equally placed new ones", () => {
  const entries = [
    e(1, { visibility: Visibility.Visible, live: true, lastUse: 1 }),
    e(2, { visibility: Visibility.Visible, lastUse: 5 }),
  ];
  const plan = planBudget(entries, 1);
  assert.deepEqual([...plan.live], [1]);
  assert.deepEqual(plan.activate, []);
  // Hovering the waiting one swaps them.
  entries[1]!.pinned = true;
  const swap = planBudget(entries, 1);
  assert.deepEqual([...swap.live], [2]);
  assert.deepEqual(swap.deactivate, [1]);
});

test("greedy fit skips a heavy plot for lighter ones; an oversized first plot still runs", () => {
  const entries = [
    e(1, { visibility: Visibility.Visible, weight: 3, lastUse: 3 }),
    e(2, { visibility: Visibility.Visible, weight: 3, lastUse: 2 }),
    e(3, { visibility: Visibility.Visible, weight: 1, lastUse: 1 }),
  ];
  assert.deepEqual(sorted(planBudget(entries, 4).live), [1, 3]);
  assert.deepEqual(sorted(planBudget([e(1, { visibility: Visibility.Visible, weight: 12 })], 10).live), [1]);
  assert.deepEqual(sorted(planBudget([], 10).live), []);
});

test("a dormant plot (context lost) waits until used, even when visible", () => {
  const entries = [e(1, { visibility: Visibility.Visible, dormant: true })];
  assert.deepEqual([...planBudget(entries, 10).live], []);
  entries[0]!.pinned = true;
  assert.deepEqual([...planBudget(entries, 10).live], [1]);
});
