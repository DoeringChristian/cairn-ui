import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleColormap } from "../charts/colormaps.ts";
import { bucketColors, formatBound, NO_VALUE_COLOR, toColorByValue, type ColorByValue } from "./run-color-by.ts";

const vals = (o: Record<string, ColorByValue>) => new Map(Object.entries(o));

test("sampleColormap interpolates stops and clamps", () => {
  assert.equal(sampleColormap("turbo", 0), "#30123b");
  assert.equal(sampleColormap("turbo", 1), "#7a0403");
  assert.equal(sampleColormap("turbo", 2), "#7a0403");
  assert.equal(sampleColormap("viridis", 0), "#440154");
  assert.equal(sampleColormap("viridis", 1), "#fde725");
  // Halfway between the first two magma stops (0,0,4) and (21,14,56).
  assert.equal(sampleColormap("magma", 0.05), "#0b071e");
});

test("numbers: N evenly spaced buckets between min and max", () => {
  const { colors, legend } = bucketColors(vals({ a: 0, b: 1, c: 2.4, d: 2.6, e: 4 }), { buckets: 4, palette: "viridis" });
  assert.deepEqual(legend.map((l) => l.label), ["0–1", "1–2", "2–3", "3–4"]);
  assert.equal(new Set(legend.map((l) => l.color)).size, 4);
  assert.equal(colors.get("a"), legend[0]!.color);
  assert.equal(colors.get("b"), legend[1]!.color); // lower bound inclusive
  assert.equal(colors.get("c"), legend[2]!.color);
  assert.equal(colors.get("d"), legend[2]!.color);
  assert.equal(colors.get("e"), legend[3]!.color); // the max lands in the last bucket
});

test("numbers: one distinct value is one bucket", () => {
  const { colors, legend } = bucketColors(vals({ a: 0.001, b: 0.001 }), { buckets: 4, palette: "turbo" });
  assert.deepEqual(legend.map((l) => l.label), ["0.001"]);
  assert.equal(colors.get("a"), legend[0]!.color);
  assert.equal(colors.get("b"), legend[0]!.color);
});

test("missing values are grey and listed last", () => {
  const { colors, legend } = bucketColors(vals({ a: 1, b: null, c: 3 }), { buckets: 2, palette: "turbo" });
  assert.equal(colors.get("b"), NO_VALUE_COLOR);
  assert.equal(legend.at(-1)!.label, "no value");
  assert.equal(legend.length, 3);
  const none = bucketColors(vals({ a: null }), { buckets: 3, palette: "turbo" });
  assert.deepEqual(none.legend, [{ label: "no value", color: NO_VALUE_COLOR }]);
  assert.equal(none.colors.get("a"), NO_VALUE_COLOR);
});

test("text: one bucket per distinct value, sorted", () => {
  const { colors, legend } = bucketColors(vals({ a: "sweep-b", b: "sweep-a", c: "sweep-b" }), { buckets: 4, palette: "turbo" });
  assert.deepEqual(legend.map((l) => l.label), ["sweep-a", "sweep-b"]);
  assert.equal(colors.get("a"), colors.get("c"));
  assert.notEqual(colors.get("a"), colors.get("b"));
});

test("text over the cap: the most common values keep buckets, the rest are other", () => {
  const { colors, legend } = bucketColors(vals({ a: "x", b: "x", c: "y", d: "y", e: "z", f: "w" }), { buckets: 3, palette: "turbo" });
  assert.deepEqual(legend.map((l) => l.label), ["x", "y", "other"]);
  assert.equal(colors.get("e"), legend[2]!.color);
  assert.equal(colors.get("f"), legend[2]!.color);
  assert.equal(new Set(legend.map((l) => l.color)).size, 3);
});

test("mixed numbers and text are categorical", () => {
  const { legend } = bucketColors(vals({ a: 2, b: "n/a", c: 10 }), { buckets: 4, palette: "turbo" });
  assert.deepEqual(legend.map((l) => l.label), ["2", "10", "n/a"]);
});

test("formatBound and toColorByValue", () => {
  assert.equal(formatBound(0.000123456), "1.2e-4");
  assert.equal(formatBound(0.0123456), "0.0123");
  assert.equal(formatBound(123456), "1.2e5");
  assert.equal(toColorByValue(NaN), null);
  assert.equal(toColorByValue(""), null);
  assert.equal(toColorByValue(true), "true");
  assert.equal(toColorByValue(["a"]), null);
  assert.equal(toColorByValue(3), 3);
});
