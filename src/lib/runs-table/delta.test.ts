import { test } from "node:test";
import assert from "node:assert/strict";
import { betterFor, betterFromRule, deltaOf, formatDelta, relativeDelta, toneOf } from "./delta.ts";
import { makeRun, stats } from "./test-run.ts";

test("betterFromRule: min → lower, max → higher, else none", () => {
  assert.equal(betterFromRule("min"), "lower");
  assert.equal(betterFromRule("max"), "higher");
  assert.equal(betterFromRule("mean"), null);
  assert.equal(betterFromRule(null), null);
});

test("betterFor: override beats the baseline's rule, which beats other runs'", () => {
  const base = makeRun("b", { stats: stats({ loss: [0, 1, "min"] }) });
  const other = makeRun("o", { stats: stats({ acc: [0, 1, "max"], loss: [0, 1, "max"] }) });
  assert.equal(betterFor("value:loss", undefined, base, [other]), "lower");
  assert.equal(betterFor("value:loss", "higher", base, [other]), "higher");
  assert.equal(betterFor("value:acc", undefined, base, [base, other]), "higher");
  assert.equal(betterFor("param:lr", undefined, base, [other]), null);
  assert.equal(betterFor("computed:c", "lower", base, []), "lower");
  assert.equal(betterFor("value:loss", undefined, undefined, []), null);
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
  assert.equal(toneOf(1, null), "neutral");
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
