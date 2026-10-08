import { test } from "node:test";
import assert from "node:assert/strict";
import {
  axesWithMetric,
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
  // A constant axis sits in the middle.
  assert.equal(position(axisScale([4, 4]), 4), 0.5);
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
