import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPanels } from "./panel-builder.ts";

const NAMES = ["train.loss", "train.acc", "val.loss", "val.acc", "lr", "val.loss"];

test("capture groups split matches into one card per distinct capture", () => {
  const r = buildPanels("val\\.(.*)", NAMES);
  assert.ok(r.ok);
  assert.deepEqual(r.panels, [
    { title: "acc", metrics: ["val.acc"] },
    { title: "loss", metrics: ["val.loss"] },
  ]);
});

test("metrics sharing a capture share a card", () => {
  const r = buildPanels(".*\\.(loss|acc)", NAMES);
  assert.ok(r.ok);
  assert.deepEqual(r.panels, [
    { title: "acc", metrics: ["train.acc", "val.acc"] },
    { title: "loss", metrics: ["train.loss", "val.loss"] },
  ]);
});

test("several groups join into the title", () => {
  const r = buildPanels("(train|val)\\.(loss)", NAMES);
  assert.ok(r.ok);
  assert.deepEqual(r.panels.map((p) => p.title), ["train · loss", "val · loss"]);
});

test("no groups: every match on one card; the pattern is anchored", () => {
  const r = buildPanels("val\\..*", NAMES);
  assert.ok(r.ok);
  assert.deepEqual(r.panels, [{ title: "val\\..*", metrics: ["val.acc", "val.loss"] }]);
  const partial = buildPanels("loss", NAMES);
  assert.ok(partial.ok);
  assert.deepEqual(partial.panels, []);
});

test("invalid or empty regex is an error", () => {
  const r = buildPanels("val\\.(", NAMES);
  assert.equal(r.ok, false);
  assert.equal(buildPanels("  ", NAMES).ok, false);
});
