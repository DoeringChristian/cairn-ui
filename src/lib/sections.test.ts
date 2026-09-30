import { test } from "node:test";
import assert from "node:assert/strict";
import { autoSectionOf, compareAutoSections } from "./sections.ts";

test("automatic sections by prefix and media type", () => {
  assert.equal(autoSectionOf("train.loss", "scalar"), "train");
  assert.equal(autoSectionOf("loss", "scalar"), "Charts");
  assert.equal(autoSectionOf("val.samples", "image"), "Media");
});

test("automatic section order", () => {
  const names = ["system", "Media", "val", "Charts", "train"];
  assert.deepEqual([...names].sort(compareAutoSections), ["Charts", "train", "val", "Media", "system"]);
});
