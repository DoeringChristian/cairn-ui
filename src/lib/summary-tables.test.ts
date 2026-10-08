import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunDetailResponse } from "../api/types.ts";
import {
  aggregate,
  agreement,
  configTable,
  MIXED,
  nextSort,
  scalarsTable,
  sortRows,
  summaryPresenceOf,
  tableRunOf,
  unitsOf,
  type TableRun,
} from "./summary-tables.ts";

const R = (id: string, over: Partial<TableRun> = {}): TableRun => ({
  id,
  status: "completed",
  createdAt: "2026-01-01T00:00:00Z",
  endedAt: "2026-01-01T00:01:00Z",
  user: "u",
  host: "h",
  values: {},
  summary: {},
  config: {},
  tags: [],
  notes: "",
  ...over,
});

const NOW = Date.parse("2026-01-01T00:10:00Z");

test("units: one per run; grouped, one per top-level group at its first run, ungrouped runs stay", () => {
  const runs = [R("a"), R("b"), R("c"), R("d")];
  assert.deepEqual(unitsOf(runs, null).map((u) => u.key), ["run:a", "run:b", "run:c", "run:d"]);
  const g = new Map([["a", "exp-44"], ["c", "exp-44"], ["b", "exp-43"]]);
  const units = unitsOf(runs, g);
  assert.deepEqual(units.map((u) => u.key), ["group:exp-44", "group:exp-43", "run:d"]);
  assert.deepEqual(units[0]!.runs.map((r) => r.id), ["a", "c"]);
});

test("aggregate: mean of numbers that exist; agreeing values; none → null; else mixed", () => {
  assert.equal(aggregate([1, null, 3]), 2);
  assert.equal(aggregate([null, null]), null);
  assert.equal(aggregate(["x", "x", null]), "x");
  assert.equal(aggregate(["x", "y"]), MIXED);
  assert.equal(agreement([1, 1]), 1);
  assert.equal(agreement([1, null]), MIXED);
  assert.equal(agreement([null, null]), null);
});

test("scalars table: run info first, single-step metrics A–Z, then summary keys; rows per run", () => {
  const runs = [
    R("a", { values: { "eval/mse": 0.25, loss: 0.1 }, summary: { final_loss: 0.04, "eval/mse": 0.25 } }),
    R("b", { values: { "prepare/rows": 2000 }, summary: { final_loss: 0.08 }, endedAt: null, status: "running" }),
  ];
  const t = scalarsTable(runs, { singleStep: ["prepare/rows", "eval/mse", "never"], groupOf: null, showRunInfo: true, now: NOW });
  assert.deepEqual(t.columns.map((c) => c.key), [
    "info:status", "info:duration", "info:created", "info:user", "info:host",
    "metric:eval/mse", "metric:prepare/rows", "summary:final_loss",
  ]);
  assert.equal(t.rows[0]!.cells["metric:eval/mse"], 0.25);
  assert.equal(t.rows[0]!.cells["metric:prepare/rows"], null);
  assert.equal(t.rows[1]!.cells["info:duration"], 600, "a running run: up to now");
  assert.equal(t.rows[0]!.cells["info:duration"], 60);
  const off = scalarsTable(runs, { singleStep: [], groupOf: null, showRunInfo: false, now: NOW });
  assert.deepEqual(off.columns.map((c) => c.kind), ["summary", "summary"]);
});

test("scalars table grouped: a group's mean over its runs that have the value; — when none", () => {
  const runs = [
    R("a", { values: { acc: 0.8 }, user: "x", createdAt: "2026-01-02T00:00:00Z" }),
    R("b", { values: { acc: 1.0 }, user: "y", createdAt: "2026-01-01T00:00:00Z" }),
    R("c", { values: {} }),
    R("d", { values: { acc: 0.5 } }),
  ];
  const g = new Map([["a", "G"], ["b", "G"], ["c", "H"]]);
  const t = scalarsTable(runs, { singleStep: ["acc"], groupOf: g, showRunInfo: true, now: NOW });
  const by = Object.fromEntries(t.rows.map((r) => [r.unit.key, r.cells]));
  assert.equal(by["group:G"]!["metric:acc"], 0.9);
  assert.equal(by["group:H"]!["metric:acc"], null);
  assert.equal(by["run:d"]!["metric:acc"], 0.5);
  assert.equal(by["group:G"]!["info:user"], MIXED);
  assert.equal(by["group:G"]!["info:created"], Date.parse("2026-01-01T00:00:00Z"), "a group: its first run");
});

test("sort: asc, desc, off; empty and mixed cells last either way; by label", () => {
  assert.deepEqual(nextSort(null, "k"), { key: "k", desc: false });
  assert.deepEqual(nextSort({ key: "k", desc: false }, "k"), { key: "k", desc: true });
  assert.equal(nextSort({ key: "k", desc: true }, "k"), null);
  assert.deepEqual(nextSort({ key: "k", desc: true }, "j"), { key: "j", desc: false });
  const rows = [
    { id: "a", cells: { v: 2 } },
    { id: "b", cells: { v: null } },
    { id: "c", cells: { v: 10 } },
    { id: "d", cells: { v: MIXED } },
    { id: "e", cells: { v: 1 } },
  ];
  const ids = (s: Parameters<typeof sortRows>[1]) => sortRows(rows, s, (r) => r.id).map((r) => r.id);
  assert.deepEqual(ids({ key: "v", desc: false }), ["e", "a", "c", "b", "d"]);
  assert.deepEqual(ids({ key: "v", desc: true }), ["c", "a", "e", "b", "d"]);
  assert.deepEqual(ids(null), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids({ key: "label", desc: true }), ["e", "d", "c", "b", "a"]);
});

test("config table: tags and notes first, keys A–Z; only diffs; a group's value only when its runs agree", () => {
  const runs = [
    R("a", { config: { lr: 3e-4, noise: 0.5, "model.depth": 4 }, tags: ["b", "a"] }),
    R("b", { config: { lr: 3e-4, noise: 0.1, "model.depth": 4 } }),
    R("c", { config: { lr: 1e-3, "model.depth": 4 }, notes: "first try" }),
  ];
  const t = configTable(runs, { groupOf: null, onlyDiffs: false });
  assert.deepEqual(t.rows.map((r) => r.key), ["tags", "notes", "lr", "model.depth", "noise"]);
  assert.deepEqual(t.rows[0]!.cells, ["a, b", null, null]);
  assert.deepEqual(t.rows.find((r) => r.key === "noise")!.cells, [0.5, 0.1, null]);
  const diffs = configTable(runs, { groupOf: null, onlyDiffs: true });
  assert.deepEqual(diffs.rows.map((r) => r.key), ["tags", "notes", "lr", "noise"]);

  const g = new Map([["a", "G"], ["b", "G"]]);
  const grouped = configTable(runs, { groupOf: g, onlyDiffs: false });
  assert.deepEqual(grouped.units.map((u) => u.key), ["group:G", "run:c"]);
  const cell = (k: string) => grouped.rows.find((r) => r.key === k)!.cells;
  assert.deepEqual(cell("lr"), [3e-4, 1e-3]);
  assert.deepEqual(cell("noise"), [MIXED, null]);
  assert.deepEqual(cell("tags"), [MIXED, null], "a run without tags disagrees");
  assert.equal(configTable(runs, { groupOf: g, onlyDiffs: true }).rows.some((r) => r.key === "model.depth"), false);
  // A run without any config (a group's prepare step) does not make its group mixed.
  const withPrep = configTable([...runs, R("p")], { groupOf: new Map([["a", "G"], ["p", "G"]]), onlyDiffs: false });
  assert.deepEqual(withPrep.rows.find((r) => r.key === "lr")!.cells, [3e-4, 3e-4, 1e-3]);
});

test("a run detail as a table run; what it has for the Summary cards", () => {
  const rd = {
    run: { id: "r", status: "completed", created_at: "c", ended_at: null, user: "u", hostname: "h", tags: '["t"]', notes: " n ", values: { loss: 1, s: "x" } },
    params: [{ key: "opt.lr", value: "0.001", value_type: "float" }, { key: "layers", value: "[1,2]", value_type: "list" }],
    summary: [{ key: "final", value: "0.5", value_type: "float" }, { key: "fig", value: '{"_type":"figure"}', value_type: "dict" }, { key: "system.gpu", value: "1", value_type: "int" }],
  } as unknown as RunDetailResponse;
  const t = tableRunOf(rd);
  assert.deepEqual(t.config, { "opt.lr": 0.001, layers: "[1,2]" });
  assert.deepEqual(t.summary, { final: 0.5 }, "scalar summary values only, no system.*");
  assert.deepEqual(t.tags, ["t"]);
  assert.equal(t.notes, "n");
  assert.deepEqual(summaryPresenceOf(rd), { runId: "r", summaryKeys: 1, configKeys: 2, tags: 1, notes: true });
});
