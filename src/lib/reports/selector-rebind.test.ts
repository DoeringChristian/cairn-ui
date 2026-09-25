import { test } from "node:test";
import assert from "node:assert/strict";
import type { ComparisonCard } from "../comparisons/types.ts";
import { shouldAutoRebind } from "./selector-rebind.ts";

const cards: ComparisonCard[] = [{ id: "c", type: "scalar", series: [{ runId: "a", name: "loss" }, { runId: "b", name: "loss" }] }];

test("never rebinds while the selector is still resolving (its run set reads empty)", () => {
  assert.equal(shouldAutoRebind({ resolved: false, cards, resolvedRunIds: [] }), false);
  assert.equal(shouldAutoRebind({ resolved: false, cards, resolvedRunIds: ["a"] }), false);
});

test("rebinds once resolved to a different run set, not to the same one", () => {
  assert.equal(shouldAutoRebind({ resolved: true, cards, resolvedRunIds: ["b", "a"] }), false);
  assert.equal(shouldAutoRebind({ resolved: true, cards, resolvedRunIds: ["a", "c"] }), true);
  assert.equal(shouldAutoRebind({ resolved: true, cards, resolvedRunIds: [] }), true);
  assert.equal(shouldAutoRebind({ resolved: true, cards: [], resolvedRunIds: ["a"] }), false);
});
