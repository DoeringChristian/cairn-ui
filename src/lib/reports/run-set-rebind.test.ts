import { test } from "node:test";
import assert from "node:assert/strict";
import type { ComparisonCard } from "../comparisons/types.ts";
import { shouldAutoRebind } from "./run-set-rebind.ts";

const cards: ComparisonCard[] = [{ id: "c", type: "scalar", series: [{ runId: "a", name: "loss" }, { runId: "b", name: "loss" }] }];

test("never rebinds while the runs are loading", () => {
  assert.equal(shouldAutoRebind({ resolved: false, cards, resolvedRunIds: [] }), false);
  assert.equal(shouldAutoRebind({ resolved: false, cards, resolvedRunIds: ["a"] }), false);
});

test("rebinds once resolved to a different, non-empty run set", () => {
  assert.equal(shouldAutoRebind({ resolved: true, cards, resolvedRunIds: ["b", "a"] }), false);
  assert.equal(shouldAutoRebind({ resolved: true, cards, resolvedRunIds: ["a", "c"] }), true);
  // No runs: the cards keep their metrics.
  assert.equal(shouldAutoRebind({ resolved: true, cards, resolvedRunIds: [] }), false);
  assert.equal(shouldAutoRebind({ resolved: true, cards: [], resolvedRunIds: ["a"] }), false);
});
