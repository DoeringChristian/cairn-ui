import { test } from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, stepMetricFor, summaryRuleFor } from "./metric-defs.ts";

test("globToRegExp follows fnmatch", () => {
  assert.ok(globToRegExp("val/*").test("val/acc"));
  assert.ok(globToRegExp("val/*").test("val/a/b"));
  assert.ok(!globToRegExp("val/*").test("train/val/acc"));
  assert.ok(globToRegExp("loss?").test("loss1"));
  assert.ok(!globToRegExp("loss?").test("loss"));
  assert.ok(globToRegExp("l[ao]ss").test("lass"));
  assert.ok(!globToRegExp("l[!ao]ss").test("loss"));
  assert.ok(globToRegExp("a.b(c)").test("a.b(c)"));
  assert.ok(!globToRegExp("a.b").test("axb"));
});

test("stepMetricFor: exact beats glob, the longest glob wins", () => {
  const defs = [
    { name: "val/*", step_metric: "epoch", summary: null },
    { name: "val/loss*", step_metric: "val_step", summary: null },
    { name: "val/acc", step_metric: null, summary: "max" },
    { name: "lr", step_metric: "opt_step", summary: null },
  ];
  assert.equal(stepMetricFor("lr", defs), "opt_step");
  assert.equal(stepMetricFor("val/loss_x", defs), "val_step");
  // val/acc's own def has no step_metric, so the glob's applies.
  assert.equal(stepMetricFor("val/acc", defs), "epoch");
  assert.equal(stepMetricFor("train/loss", defs), null);
  assert.equal(stepMetricFor("lr", undefined), null);
});

test("summaryRuleFor: exact beats glob, longest glob wins, step-only defs don't count", () => {
  const defs = [
    { name: "val/*", step_metric: null, summary: "min" },
    { name: "val/acc*", step_metric: null, summary: "max" },
    { name: "val/acc_top5", step_metric: null, summary: "last" },
    { name: "train/*", step_metric: "epoch", summary: null },
  ];
  assert.equal(summaryRuleFor("val/loss", defs), "min");
  assert.equal(summaryRuleFor("val/acc", defs), "max");
  assert.equal(summaryRuleFor("val/acc_top5", defs), "last");
  assert.equal(summaryRuleFor("train/loss", defs), null);
  assert.equal(summaryRuleFor("loss", undefined), null);
});
