import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_TYPES } from "./card-spec.ts";
import {
  CARD_WIDTHS,
  GRID_COLUMNS,
  VALID_SPANS,
  defaultCardWidth,
  isCardWidth,
  resolveCardWidth,
  snapSpan,
  snapSpanUp,
  widthOfSpan,
  widthOfSpan6,
  widthSpan,
} from "./card-width.ts";

test("exactly full, 1/2, 1/3, 1/4 of a 12-column row", () => {
  assert.equal(GRID_COLUMNS, 12);
  assert.deepEqual([...CARD_WIDTHS], ["full", "1/2", "1/3", "1/4"]);
  assert.deepEqual(CARD_WIDTHS.map(widthSpan), [12, 6, 4, 3]);
  assert.deepEqual([...VALID_SPANS], [3, 4, 6, 12]);
  for (const w of CARD_WIDTHS) assert.equal(GRID_COLUMNS % widthSpan(w), 0, `${w} tiles the row`);
});

test("isCardWidth accepts only the four widths", () => {
  for (const w of CARD_WIDTHS) assert.ok(isCardWidth(w));
  for (const v of [undefined, null, 6, 3, "2/3", "1/6", "Full", "", {}]) assert.ok(!isCardWidth(v), String(v));
});

test("snapping: any span lands on the nearest width (ties narrower)", () => {
  const expect: Record<number, number> = { 0: 3, 1: 3, 2: 3, 3: 3, 4: 4, 5: 4, 6: 6, 7: 6, 8: 6, 9: 6, 10: 12, 11: 12, 12: 12, 15: 12 };
  for (const [raw, span] of Object.entries(expect)) assert.equal(snapSpan(Number(raw)), span, `raw ${raw}`);
  assert.equal(widthOfSpan(5), "1/3");
  assert.equal(widthOfSpan(10), "full");
  assert.equal(widthOfSpan(3), "1/4");
});

test("snapSpanUp: a minimum rounds up to a width", () => {
  assert.deepEqual([1, 3, 4, 5, 6, 7, 12, 13].map(snapSpanUp), [3, 3, 4, 6, 6, 12, 12, 12]);
});

test("old 6-column spans map to the nearest fraction of the row", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(widthOfSpan6), ["1/4", "1/3", "1/2", "1/2", "full", "full"]);
});

test("defaults per type", () => {
  for (const t of ["scalars", "config", "run-compare", "code-diff"]) assert.equal(defaultCardWidth(t), "full", t);
  for (const t of ["scalar", "image", "figure", "video", "audio", "histogram", "pointcloud", "mesh", "volume", "table", "parallel", "scatter"])
    assert.equal(defaultCardWidth(t), "1/2", t);
  assert.equal(defaultCardWidth("tile"), "1/4");
  for (const t of CARD_TYPES) assert.ok(isCardWidth(defaultCardWidth(t)), t);
});

test("parse rule: a stored width that isn't one of the four falls back to the default", () => {
  assert.equal(resolveCardWidth("1/3", "1/2"), "1/3");
  assert.equal(resolveCardWidth(4, "1/2"), "1/2");
  assert.equal(resolveCardWidth("2/3", undefined, "full"), "full");
  assert.equal(resolveCardWidth(undefined, "1/4"), "1/4");
  assert.equal(resolveCardWidth("bogus"), "1/2");
});
