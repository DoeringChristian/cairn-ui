import { test } from "node:test";
import assert from "node:assert/strict";
import { xMetricFor, isSystemMetric, metricValueSource } from "./metric-defs.ts";
import { rulesOf } from "./metric-rules.ts";

const defs = [
  { name: "val.loss", x: "epoch", summary: "min" },
  { name: "val.acc", x: null, summary: "max" },
  { name: "lr", x: "opt_step", summary: null },
  { name: "val.*", x: "epoch", summary: "max" },
];

test("xMetricFor: the metric's own rule, exact names only", () => {
  assert.equal(xMetricFor("val.loss", defs), "epoch");
  assert.equal(xMetricFor("lr", defs), "opt_step");
  assert.equal(xMetricFor("val.acc", defs), null);
  assert.equal(xMetricFor("val.f1", defs), null); // "val.*" is not a glob
  assert.equal(xMetricFor("loss", undefined), null);
});

test("system metrics and where a final value comes from", () => {
  assert.equal(isSystemMetric("system.cpu"), true);
  assert.equal(isSystemMetric("loss"), false);
  const ruleOf = rulesOf({ logged: { loss: "min" }, overrides: { acc: { summary: "max" } }, rules: {} });
  assert.equal(metricValueSource("acc", new Set(["acc"]), ruleOf), "summary");
  assert.equal(metricValueSource("acc", new Set(), ruleOf), "max");
  assert.equal(metricValueSource("loss", new Set(), ruleOf), "min");
  assert.equal(metricValueSource("lr", new Set(), ruleOf), "last");
});
