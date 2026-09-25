import { test } from "node:test";
import assert from "node:assert/strict";
import { assignRunColors, RUN_PALETTE, runColor } from "./run-color.ts";

const ids = Array.from({ length: 20 }, (_, i) => `run-${i}-${(i * 7919).toString(16)}`);
const t = (id: string) => ids.indexOf(id);

test("a run's colour depends only on its id", () => {
  assert.equal(runColor("abc"), runColor("abc"));
  assert.ok(RUN_PALETTE.includes(runColor("abc") as (typeof RUN_PALETTE)[number]));
});

test("the first 10 runs of a card get 10 different hues", () => {
  const m = assignRunColors(ids.slice(0, 10), t);
  const hue = (c: string) => RUN_PALETTE.indexOf(c as (typeof RUN_PALETTE)[number]) % 10;
  assert.equal(new Set([...m.values()].map(hue)).size, 10);
});

test("up to 20 runs in one card are all distinct", () => {
  const m = assignRunColors(ids, t);
  assert.equal(new Set(m.values()).size, 20);
});

test("the oldest run keeps its own colour; a clash moves the newer run", () => {
  for (let i = 1; i < ids.length; i++) {
    const m = assignRunColors([ids[i]!, ids[0]!], t);
    assert.equal(m.get(ids[0]!), runColor(ids[0]!));
    assert.notEqual(m.get(ids[i]!), m.get(ids[0]!));
  }
});

test("order of the input does not matter", () => {
  const a = assignRunColors(ids.slice(0, 8), t);
  const b = assignRunColors([...ids.slice(0, 8)].reverse(), t);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});
