import { test } from "node:test";
import assert from "node:assert/strict";

import type { SweepTrial } from "../api/types";
import { formatParamValue, isLogParam, rankTrials, searchedParams, trialParamKeys } from "./sweeps.ts";

const trial = (id: string, value: number | null, params: Record<string, unknown> = {}, created_at = id): SweepTrial => ({
  id, sweep_id: "s", run_id: null, params, status: "completed", value, created_at,
});

test("searchedParams skips constants", () => {
  assert.deepEqual(
    searchedParams({ lr: { min: 0, max: 1 }, bs: { value: 32 }, seed: 7, opt: { values: ["a"] }, tags: [1] }),
    ["lr", "opt"],
  );
});

test("trialParamKeys puts searched keys first", () => {
  assert.deepEqual(trialParamKeys([trial("a", 1, { bs: 1, lr: 2 })], ["lr"]), ["lr", "bs"]);
});

test("formatParamValue", () => {
  assert.equal(formatParamValue(0.000123456), "0.0001235");
  assert.equal(formatParamValue(3), "3");
  assert.equal(formatParamValue("adam"), "adam");
  assert.equal(formatParamValue([1, 2]), "[1,2]");
  assert.equal(formatParamValue(undefined), "—");
});

test("rankTrials orders by goal with unscored trials last", () => {
  const ts = [trial("1", 3), trial("2", null), trial("3", 1), trial("4", null)];
  assert.deepEqual(rankTrials(ts, "minimize").map((t) => t.id), ["3", "1", "4", "2"]);
  assert.deepEqual(rankTrials(ts, "maximize").map((t) => t.id), ["1", "3", "4", "2"]);
});

test("isLogParam", () => {
  const space = { lr: { min: 1e-4, max: 1, distribution: "log_uniform" }, n: { min: 1, max: 3 }, c: 3 };
  assert.deepEqual(["lr", "n", "c", "x"].map((k) => isLogParam(space, k)), [true, false, false, false]);
});
