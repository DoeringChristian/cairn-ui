import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaOf, exprGoal, formatDelta, goalFor, relativeDelta, toneOf } from "./delta.ts";
import { rulesOf } from "../metric-rules.ts";

test("goalFor: a metric's rule, a computed column's one metric, else none", () => {
  const ruleOf = rulesOf({ logged: { loss: "min" }, overrides: { acc: { goal: "higher" } }, rules: {} });
  const computed = [
    { id: "c", expr: "min(loss) * 2" },
    { id: "d", expr: "last(loss) / last(acc)" },
  ];
  assert.equal(goalFor("value:loss", ruleOf, computed), "lower");
  assert.equal(goalFor("value:acc", ruleOf, computed), "higher");
  assert.equal(goalFor("value:other", ruleOf, computed), "none");
  assert.equal(goalFor("param:lr", ruleOf, computed), "none");
  assert.equal(goalFor("computed:c", ruleOf, computed), "lower");
  assert.equal(goalFor("computed:d", ruleOf, computed), "none");
  assert.equal(exprGoal("((", ruleOf), "none");
});

test("deltaOf / toneOf", () => {
  assert.equal(deltaOf(3, 1), 2);
  assert.equal(deltaOf(true, 0), 1);
  assert.equal(deltaOf("a", 1), null);
  assert.equal(deltaOf(NaN, 1), null);
  assert.equal(deltaOf(1, null), null);
  assert.equal(toneOf(-1, "lower"), "better");
  assert.equal(toneOf(1, "lower"), "worse");
  assert.equal(toneOf(1, "higher"), "better");
  assert.equal(toneOf(-1, "higher"), "worse");
  assert.equal(toneOf(0, "higher"), "same");
  assert.equal(toneOf(1, "none"), "neutral");
  assert.equal(toneOf(null, "lower"), "neutral");
});

test("formatDelta / relativeDelta", () => {
  assert.equal(formatDelta(0.012345), "+0.01235");
  assert.equal(formatDelta(-2), "−2");
  assert.equal(formatDelta(0), "±0");
  assert.equal(formatDelta(1e-5), "+1.00e-5");
  assert.equal(relativeDelta(-1, 4), -0.25);
  assert.equal(relativeDelta(1, 0), null);
  assert.equal(relativeDelta(null, 1), null);
});
