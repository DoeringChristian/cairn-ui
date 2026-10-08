/**
 * `effectiveRule` against the vectors it shares with cairn
 * `cairn/server/metric_rules.py` (`effective_rule`):
 * docs/schemas/metric-rule-vectors.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveRule, metricRuleMenuState, rulesOf, withPick, type EffectiveRule, type MetricOverride, type Summary } from "./metric-rules.ts";

const doc = JSON.parse(
  readFileSync(new URL("../../docs/schemas/metric-rule-vectors.json", import.meta.url), "utf8"),
) as { cases: Array<{ override: MetricOverride | null; logged: Summary | null; expected: EffectiveRule }> };

test("metric-rule-vectors.json: every case matches", () => {
  assert.ok(doc.cases.length >= 50);
  for (const c of doc.cases) {
    assert.deepEqual(effectiveRule(c.override, c.logged), c.expected, JSON.stringify(c));
  }
});

test("rulesOf: logged, overridden and unknown metrics", () => {
  const rule = rulesOf({
    logged: { loss: "min", acc: "max" },
    overrides: { acc: { summary: "last" }, f1: { goal: "higher" } },
    rules: {},
  });
  assert.deepEqual(rule("loss"), { summary: "min", goal: "lower" });
  assert.deepEqual(rule("acc"), { summary: "last", goal: "higher" });
  assert.deepEqual(rule("f1"), { summary: null, goal: "higher" });
  assert.deepEqual(rule("nope"), { summary: null, goal: "none" });
});

test("metricRuleMenuState: effective rule, logged summary and the override note", () => {
  const doc = {
    logged: { "eval/mse": "min" as Summary },
    overrides: { "ft/loss": { summary: "min" as Summary, goal: null }, "eval/mse": { summary: "last" as Summary, goal: null } },
    rules: {},
  };
  assert.deepEqual(metricRuleMenuState(doc, "eval/mse"), {
    summary: "last", goal: "lower", logged: "min", override: { summary: "last", goal: null },
    note: "logged: summary=min · project overrides",
  });
  const ft = metricRuleMenuState(doc, "ft/loss");
  assert.deepEqual([ft.summary, ft.goal, ft.note], ["min", "lower", "logged: summary=none · project overrides"]);
  const none = metricRuleMenuState(doc, "acc");
  assert.deepEqual([none.summary, none.goal, none.note, none.override], ["last", "none", "logged: summary=none", null]);
  assert.equal(metricRuleMenuState(undefined, "acc").note, "logged: summary=none");
});

test("withPick: the picked field set, the other override kept", () => {
  assert.deepEqual(withPick(null, { goal: "higher" }), { summary: null, goal: "higher" });
  assert.deepEqual(withPick({ summary: "max", goal: null }, { goal: "lower" }), { summary: "max", goal: "lower" });
  assert.deepEqual(withPick({ summary: "max", goal: "lower" }, { summary: "mean" }), { summary: "mean", goal: "lower" });
});
