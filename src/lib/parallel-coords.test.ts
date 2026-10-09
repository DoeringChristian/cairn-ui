import { test } from "node:test";
import assert from "node:assert/strict";
import {
  axesThatFit,
  axesWithMetric,
  axisLabels,
  axisVariation,
  fitDefaultAxes,
  LABEL_CHAR_W,
  MIN_AXIS_GAP,
  axisScale,
  axisTicks,
  brushMatches,
  defaultAxes,
  linesOf,
  position,
  varyingConfigKeys,
  type ParallelAxis,
  type PcRun,
} from "./parallel-coords.ts";
import { unitsOf, type TableRun } from "./summary-tables.ts";

const run = (id: string, config: PcRun["config"], values: PcRun["values"] = {}): TableRun => ({
  id, config, values, status: "completed", createdAt: "", endedAt: null, user: null, host: null, summary: {}, tags: [], notes: "",
});

const RUNS = [
  run("a", { lr: 1e-3, batch_size: 32, seed: 0, "model.depth": 2, opt: "adam" }, { "eval/mse": 0.5 }),
  run("b", { lr: 1e-4, batch_size: 32, seed: 0, "model.depth": 4, opt: "sgd" }, { "eval/mse": 0.3 }),
  run("c", { lr: 1e-5, batch_size: 32, seed: 0, "model.depth": 8, opt: "adam" }, { "eval/mse": 0.1 }),
];

test("default axes: the config keys that vary (first-seen order), then the metric", () => {
  assert.deepEqual(varyingConfigKeys(RUNS), ["lr", "model.depth", "opt"]);
  assert.deepEqual(defaultAxes(RUNS, "eval/mse"), [
    { kind: "config", key: "lr" },
    { kind: "config", key: "model.depth" },
    { kind: "config", key: "opt" },
    { kind: "metric", key: "eval/mse" },
  ]);
  assert.deepEqual(defaultAxes([], null), []);
});

test("choosing another metric swaps its axis in an explicit list; defaults stay defaults", () => {
  const axes: ParallelAxis[] = [{ kind: "metric", key: "loss", log: true }, { kind: "config", key: "lr" }];
  assert.deepEqual(axesWithMetric(axes, "loss", "acc"), [{ kind: "metric", key: "acc", log: true }, { kind: "config", key: "lr" }]);
  assert.deepEqual(axesWithMetric([{ kind: "config", key: "lr" }], "loss", "acc"), [{ kind: "config", key: "lr" }, { kind: "metric", key: "acc" }]);
  assert.equal(axesWithMetric(null, "loss", "acc"), null);
});

test("numeric axes: linear or log10, positions 0 (min) .. 1 (max)", () => {
  const lin = axisScale([1, 3, null, 2]);
  assert.deepEqual(lin, { kind: "numeric", lo: 1, hi: 3, log: false });
  assert.equal(position(lin, 2), 0.5);
  assert.equal(position(lin, null), null);
  const log = axisScale([1e-5, 1e-3, 1e-4], true);
  assert.equal(position(log, 1e-4), 0.5);
  assert.equal(position(log, 0), null);
  const ticks = axisTicks(log);
  assert.deepEqual(ticks.map((t) => t.at), [1, 0]);
  assert.ok(Math.abs((ticks[0]!.value as number) - 1e-3) < 1e-15 && Math.abs((ticks[1]!.value as number) - 1e-5) < 1e-17);
  // A constant axis sits in the middle, also when group means differ by rounding only.
  assert.equal(position(axisScale([4, 4]), 4), 0.5);
  assert.equal(position(axisScale([3.7e-4, 3.7000000000000005e-4]), 3.7e-4), 0.5);
});

test("categorical axes: ordered categories (numbers ascending, then text)", () => {
  const s = axisScale(["sgd", "adam", 2, null, "adam"]);
  assert.deepEqual(s, { kind: "categorical", categories: ["2", "adam", "sgd"] });
  assert.equal(position(s, 2), 0);
  assert.equal(position(s, "adam"), 0.5);
  assert.equal(position(s, "sgd"), 1);
  assert.equal(position(s, "rmsprop"), null);
  assert.deepEqual(axisTicks(s).map((t) => t.value), ["2", "adam", "sgd"]);
  assert.deepEqual(axisScale([true, false]), { kind: "categorical", categories: ["false", "true"] });
});

test("brushing: a line matches when inside every brush; missing never matches", () => {
  const brushes = new Map([[0, [0.4, 1] as const], [2, [0.6, 0.2] as const]]);
  assert.equal(brushMatches([0.5, 0, 0.3], brushes), true);
  assert.equal(brushMatches([0.3, 0, 0.3], brushes), false);
  assert.equal(brushMatches([0.5, 0, 0.7], brushes), false);
  assert.equal(brushMatches([0.5, 0, null], brushes), false);
  assert.equal(brushMatches([null, null, null], new Map()), true);
});

test("grouped: one line per innermost group, numbers averaged, categories only when the runs agree", () => {
  const runs = [
    run("a", { lr: 1e-3, opt: "adam" }, { mse: 0.5 }),
    run("b", { lr: 1e-4, opt: "adam" }, { mse: 0.3 }),
    run("c", { lr: 1e-5, opt: "sgd" }, { mse: 0.1 }),
    run("d", { lr: 1e-5, opt: "adam" }, {}),
    run("e", { lr: 2e-5, opt: "sgd" }, { mse: 0.2 }),
  ];
  const groupOf = new Map([["a", "g1"], ["b", "g1"], ["c", "g2"], ["d", "g2"]]);
  const axes: ParallelAxis[] = [{ kind: "config", key: "lr" }, { kind: "config", key: "opt" }, { kind: "metric", key: "mse" }];
  const lines = linesOf(unitsOf(runs, groupOf), axes);
  assert.deepEqual(lines.map((l) => l.key), ["group:g1", "group:g2", "run:e"]);
  assert.ok(Math.abs((lines[0]!.values[0] as number) - 5.5e-4) < 1e-12);
  assert.equal(lines[0]!.values[1], "adam");
  assert.equal(lines[0]!.values[2], 0.4);
  // g2's runs disagree on opt: the line skips that axis; mse is the mean of the runs that have it.
  assert.equal(lines[1]!.values[1], null);
  assert.equal(lines[1]!.values[2], 0.1);
  assert.deepEqual(lines[2]!.values, [2e-5, "sgd", 0.2]);
  // Not grouped: one line per run.
  assert.equal(linesOf(unitsOf(runs, null), axes).length, 5);
});

test("axesThatFit: one axis per MIN_AXIS_GAP px of plot, at least two", () => {
  assert.equal(axesThatFit(0), 2);
  assert.equal(axesThatFit(MIN_AXIS_GAP * 10), 11);
  assert.equal(axesThatFit(MIN_AXIS_GAP * 10 - 1), 10);
});

test("axisVariation: entropy of the values (numbers in 10 bins, log10 over decades)", () => {
  assert.equal(axisVariation([3, 3, 3]), 0);
  assert.equal(axisVariation([null, null]), 0);
  assert.equal(axisVariation(["a", "b"]), 1);
  assert.equal(axisVariation(["a", "b", "c", "d"]), 2);
  // Ten evenly spread numbers: one per bin.
  assert.ok(Math.abs(axisVariation([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) - Math.log2(10)) < 1e-9);
  // A learning rate over three decades spreads in log10, not crowded into the lowest bin.
  assert.ok(Math.abs(axisVariation([1e-5, 1e-4, 1e-3, 1e-2]) - 2) < 1e-9);
  assert.equal(axisVariation([1, 1, 1, 100]) < axisVariation([1, 2, 3, 4]), true);
});

test("fitDefaultAxes: the metric and the most-varying config keys, in default order", () => {
  const runs: PcRun[] = Array.from({ length: 8 }, (_, i) => ({
    id: `r${i}`,
    config: { flag: i % 2 === 0 ? "x" : "y", seed: i, opt: i < 7 ? "adam" : "sgd", lr: 10 ** -(1 + (i % 4)) },
    values: { loss: i },
  }));
  const axes: ParallelAxis[] = [
    { kind: "config", key: "flag" },
    { kind: "config", key: "seed" },
    { kind: "config", key: "opt" },
    { kind: "config", key: "lr" },
    { kind: "metric", key: "loss" },
  ];
  assert.deepEqual(fitDefaultAxes(axes, runs, 5), axes);
  // seed (3 bits) and lr (2 bits) vary most; flag (1 bit), opt (0.54 bits) dropped.
  assert.deepEqual(fitDefaultAxes(axes, runs, 3).map((a) => a.key), ["seed", "lr", "loss"]);
  assert.deepEqual(fitDefaultAxes(axes, runs, 4).map((a) => a.key), ["flag", "seed", "lr", "loss"]);
  // Ties keep the earlier key.
  const tie: PcRun[] = [{ id: "a", config: { p: 1, q: 1 }, values: {} }, { id: "b", config: { p: 2, q: 2 }, values: {} }];
  assert.deepEqual(fitDefaultAxes([{ kind: "config", key: "p" }, { kind: "config", key: "q" }], tie, 1).map((a) => a.key), ["p"]);
});

test("axisLabels: one row when every label fits between its neighbours", () => {
  const xs = [100, 300, 500];
  assert.deepEqual(axisLabels(["lr", "batch_size", "loss"], xs, 600), [
    { text: "lr", row: 0 },
    { text: "batch_size", row: 0 },
    { text: "loss", row: 0 },
  ]);
  // At most 22 characters, as before.
  assert.equal(axisLabels(["a".repeat(30), "b", "c"], [400, 800, 1200], 1600)[0]!.text, `${"a".repeat(21)}…`);
});

test("axisLabels: staggered on two rows and truncated so no two overlap", () => {
  const n = 12;
  const xs = Array.from({ length: n }, (_, i) => 56 + i * 40);
  const names = Array.from({ length: n }, (_, i) => `optimizer.param_${i}`);
  const out = axisLabels(names, xs, 56 + 11 * 40 + 40);
  assert.deepEqual(out.map((l) => l.row), names.map((_, i) => i % 2));
  // Neighbours on a row are two axes apart: each label within 2 * 40 - 6 px.
  for (let i = 0; i < n; i++) {
    const w = out[i]!.text.length * LABEL_CHAR_W;
    assert.ok(w <= 2 * 40 * 2 - 6 - 0, `label ${i} ${w}px`);
    if (i + 2 < n) assert.ok(xs[i]! + w / 2 <= xs[i + 2]! - (out[i + 2]!.text.length * LABEL_CHAR_W) / 2 + 1e-9, `labels ${i} and ${i + 2} overlap`);
    assert.ok(out[i]!.text.endsWith("…"));
    assert.ok(names[i]!.startsWith(out[i]!.text.slice(0, -1)));
  }
  // Never past the plot's edges.
  const edge = axisLabels(["a_long_config_key_name", "b"], [20, 400], 800);
  assert.ok(edge[0]!.text.length * LABEL_CHAR_W <= 40);
});
