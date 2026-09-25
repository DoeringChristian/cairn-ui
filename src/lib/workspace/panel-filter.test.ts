import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePanelFilter, filterPanels, matchesAnyPattern } from "./panel-filter.ts";

test("empty query matches everything", () => {
  const f = compilePanelFilter("   ");
  assert.equal(f.test("anything"), true);
  assert.equal(f.error, null);
});

test("regex, case-insensitive, unanchored", () => {
  const f = compilePanelFilter("val\\.");
  assert.equal(f.test("VAL.loss"), true);
  assert.equal(f.test("eval.loss"), true);
  assert.equal(f.test("val_loss"), false);
});

test("an invalid regex falls back to plain text with an error", () => {
  const f = compilePanelFilter("loss(");
  assert.ok(f.error);
  assert.equal(f.test("train/loss(ema)"), true);
  assert.equal(f.test("train/loss"), false);
});

test("filterPanels applies hidden keys, hide patterns and the query", () => {
  const names = ["train.loss", "val.loss", "val.acc", "lr"];
  const out = filterPanels(names, (n) => n, {
    query: "loss|acc",
    hidePatterns: ["^val\\.acc$", ""],
    hidden: new Set(["train.loss"]),
  });
  assert.deepEqual(out, ["val.loss"]);
  assert.equal(matchesAnyPattern("val.acc", ["acc$"]), true);
  assert.equal(matchesAnyPattern("val.acc", [""]), false);
});
