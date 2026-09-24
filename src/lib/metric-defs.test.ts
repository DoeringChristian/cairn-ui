import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryRuleFor, xMetricFor } from "./metric-defs.ts";

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

test("summaryRuleFor: the metric's own rule, exact names only", () => {
  assert.equal(summaryRuleFor("val.loss", defs), "min");
  assert.equal(summaryRuleFor("val.acc", defs), "max");
  assert.equal(summaryRuleFor("lr", defs), null);
  assert.equal(summaryRuleFor("val.f1", defs), null);
  assert.equal(summaryRuleFor("val.*", defs), "max");
  assert.equal(summaryRuleFor("loss", undefined), null);
});
