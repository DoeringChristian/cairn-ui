import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunDetailResponse } from "../api/types.ts";
import { buildEnvDiff, buildMetricsSummary, buildParamDiff, differingCount, selectRows } from "./run-compare.ts";

function run(
  id: string,
  opts: {
    params?: Record<string, string>;
    values?: Record<string, number | string | null>;
    env?: Record<string, unknown> | null;
    defs?: { name: string; summary?: string }[];
    stats?: Record<string, { rule: string | null }>;
  } = {},
): RunDetailResponse {
  return {
    run: {
      id,
      env_snapshot: opts.env === undefined ? null : JSON.stringify(opts.env),
      values: opts.values ?? {},
      stats: opts.stats,
    },
    params: Object.entries(opts.params ?? {}).map(([key, value]) => ({ key, value, value_type: "str" })),
    metric_defs: opts.defs,
  } as unknown as RunDetailResponse;
}

test("param diff: rows per key, missing counts as differing, numeric rows get statuses", () => {
  const t = buildParamDiff([
    run("a", { params: { lr: "0.1", opt: "adam", seed: "1" } }),
    run("b", { params: { lr: "0.01", opt: "adam" } }),
  ]);
  assert.deepEqual(t.runIds, ["a", "b"]);
  assert.deepEqual(t.rows.map((r) => [r.key, r.differs]), [["lr", true], ["opt", false], ["seed", true]]);
  assert.deepEqual(t.rows[0]!.statuses, ["higher", "lower"]);
  assert.equal(t.rows[1]!.statuses, null);
  assert.deepEqual(t.rows[2]!.values, ["1", null]);
  assert.equal(differingCount(t), 2);
});

test("metrics summary: system.* dropped, min rule from defs or stats inverts the colour", () => {
  const t = buildMetricsSummary([
    run("a", {
      values: { loss: 0.2, acc: 0.9, err: 3, "system.cpu": 50 },
      defs: [{ name: "loss", summary: "min" }],
      stats: { err: { rule: "min" } },
    }),
    run("b", { values: { loss: 0.5, acc: 0.8, err: 3 } }),
  ]);
  assert.deepEqual(t.rows.map((r) => r.key), ["acc", "err", "loss"]);
  const [acc, err, loss] = t.rows;
  assert.equal(acc!.lowerBetter, false);
  assert.deepEqual(acc!.statuses, ["higher", "lower"]);
  assert.equal(loss!.lowerBetter, true);
  assert.equal(err!.lowerBetter, true);
  assert.equal(err!.differs, false);
  assert.deepEqual(err!.statuses, ["equal", "equal"]);
});

test("env diff: headline fields, dashes without a snapshot, never coloured", () => {
  const t = buildEnvDiff([
    run("a", { env: { python_version: "3.12", platform: "linux", cuda_available: true, cuda_version: "12.4", gpu_names: ["A100"] } }),
    run("b", { env: { python_version: "3.12", platform: "darwin", cuda_available: false, gpu_names: [] } }),
    run("c"),
  ]);
  const byKey = Object.fromEntries(t.rows.map((r) => [r.key, r]));
  assert.deepEqual(byKey["python version"]!.values, ["3.12", "3.12", "—"]);
  assert.deepEqual(byKey["cuda available"]!.values, ["yes (12.4)", "no", "—"]);
  assert.deepEqual(byKey["gpu names"]!.values, ["A100", "—", "—"]);
  assert.ok(t.rows.every((r) => r.statuses === null));
});

test("selectRows: pinned first and always shown; others pass onlyDiffs and the filter", () => {
  const t = buildParamDiff([
    run("a", { params: { lr: "0.1", batch: "32", opt: "adam", warmup: "10" } }),
    run("b", { params: { lr: "0.2", batch: "32", opt: "sgd", warmup: "10" } }),
  ]);
  const keys = (f: Parameters<typeof selectRows>[1]) => selectRows(t, f).map((r) => r.key);
  assert.deepEqual(keys({ onlyDiffs: false, filter: "", pinnedKeys: [] }), ["batch", "lr", "opt", "warmup"]);
  assert.deepEqual(keys({ onlyDiffs: true, filter: "", pinnedKeys: [] }), ["lr", "opt"]);
  assert.deepEqual(keys({ onlyDiffs: true, filter: "", pinnedKeys: ["warmup", "missing"] }), ["warmup", "lr", "opt"]);
  assert.deepEqual(keys({ onlyDiffs: false, filter: " OP", pinnedKeys: ["batch"] }), ["batch", "opt"]);
});
