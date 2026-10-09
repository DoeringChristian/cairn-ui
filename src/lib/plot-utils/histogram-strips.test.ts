import { test } from "node:test";
import assert from "node:assert/strict";
import { binAt, buildStrips, columnAt, maxZ, planStrips, stripTooltip, stripZ, type RunHistogram } from "./histogram-strips.ts";

const h = (step: number, edges: number[], counts: number[], x = step): RunHistogram => ({ step, x, hist: { edges, counts } });
const plan = (ids: string[], groupOf?: Map<string, string>) =>
  planStrips(ids, {
    groupOf,
    groupColor: (g) => `c(${g})`,
    runColor: (id) => `c(${id})`,
    runLabel: (id) => `run ${id}`,
  });

test("planStrips: one strip per run without grouping", () => {
  const s = plan(["a", "b"]);
  assert.deepEqual(s.map((x) => [x.key, x.label, x.color, x.runIds]), [
    ["a", "run a", "c(a)", ["a"]],
    ["b", "run b", "c(b)", ["b"]],
  ]);
});

test("planStrips: one strip per innermost group at its first run's place; ungrouped runs stay their own", () => {
  const s = plan(["a", "x", "b"], new Map([["a", "group: g"], ["b", "group: g"]]));
  assert.deepEqual(s.map((x) => [x.label, x.color, x.runIds]), [
    ["group: g", "c(group: g)", ["a", "b"]],
    ["run x", "c(x)", ["x"]],
  ]);
});

test("buildStrips: every strip on one shared grid spanning all runs and steps", () => {
  const byRun = new Map([
    ["a", [h(0, [0, 1, 2], [1, 1]), h(1, [0, 1, 2], [0, 2])]],
    ["b", [h(0, [2, 3, 4], [3, 1])]],
  ]);
  const { edges, strips } = buildStrips(plan(["a", "b"]), byRun, 4);
  assert.deepEqual(edges, [0, 1, 2, 3, 4]);
  assert.deepEqual(strips[0]!.steps, [0, 1]);
  assert.deepEqual(strips[0]!.counts, [[1, 1, 0, 0], [0, 2, 0, 0]]);
  assert.deepEqual(strips[1]!.counts, [[0, 0, 3, 1]]);
  assert.deepEqual(strips[1]!.totals, [4]);
});

test("buildStrips: a group's runs are summed per step; x is the earliest run's", () => {
  const byRun = new Map([
    ["a", [h(0, [0, 2], [2], 10), h(5, [0, 2], [1], 15)]],
    ["b", [h(0, [0, 2], [4], 7)]],
  ]);
  const { strips } = buildStrips(plan(["a", "b"], new Map([["a", "G"], ["b", "G"]])), byRun, 2);
  assert.equal(strips.length, 1);
  assert.deepEqual(strips[0]!.steps, [0, 5]);
  assert.deepEqual(strips[0]!.xs, [7, 15]);
  assert.deepEqual(strips[0]!.counts, [[3, 3], [0.5, 0.5]]);
  assert.deepEqual(strips[0]!.totals, [6, 1]);
});

test("buildStrips: columns sorted by step whatever the input order", () => {
  const { strips } = buildStrips(plan(["a"]), new Map([["a", [h(3, [0, 1], [1]), h(1, [0, 1], [2])]]]), 1);
  assert.deepEqual(strips[0]!.steps, [1, 3]);
  assert.deepEqual(strips[0]!.counts, [[2], [1]]);
});

test("stripZ: density per step (share of the step's samples), empty cells null; log scale", () => {
  const { strips } = buildStrips(plan(["a"]), new Map([["a", [h(0, [0, 1, 2], [3, 1]), h(1, [0, 1, 2], [0, 2])]]]), 2);
  assert.deepEqual(stripZ(strips[0]!, "density"), [[0.75, null], [0.25, 1]]);
  const log = stripZ(strips[0]!, "log");
  assert.equal(log[0]![0], Math.log10(4));
  assert.equal(log[0]![1], null);
  assert.equal(maxZ([stripZ(strips[0]!, "density")]), 1);
  assert.equal(maxZ([]), 1);
});

test("tooltip lookup: nearest column by x, the hovered value's bin", () => {
  const { edges, strips } = buildStrips(plan(["a"]), new Map([["a", [h(0, [0, 4], [4]), h(10, [0, 4], [8]), h(20, [0, 4], [2])]]]), 4);
  assert.equal(columnAt(strips[0]!, 14), 1);
  assert.equal(columnAt(strips[0]!, 16), 2);
  assert.equal(columnAt({ xs: [] }, 3), -1);
  assert.equal(binAt(edges, 2.5), 2);
  assert.equal(binAt(edges, 99), 3);
  const t = stripTooltip(strips[0]!, edges, 9, 0.5)!;
  assert.deepEqual([t.step, t.total, t.bin], [10, 8, 0]);
  assert.deepEqual(t.counts, [2, 2, 2, 2]);
  assert.equal(stripTooltip(strips[0]!, edges, 9, null)!.bin, -1);
});
