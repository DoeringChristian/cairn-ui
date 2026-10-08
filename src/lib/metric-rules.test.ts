/**
 * `effectiveRule` against the vectors it shares with cairn
 * `cairn/server/metric_rules.py` (`effective_rule`):
 * docs/schemas/metric-rule-vectors.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveRule, rulesOf, type EffectiveRule, type MetricOverride, type Summary } from "./metric-rules.ts";

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
