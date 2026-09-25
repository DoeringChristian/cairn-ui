import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampSplit,
  contentToScreenX,
  screenToContentX,
  splitBarLeft,
  splitClipPath,
} from "./split-geometry.ts";

const pct = (s: string) => Number(/(-?[\d.]+)%/.exec(s)![1]);

test("the bar and the clip edge are one number: bar left% = clip left inset%", () => {
  for (const split of [0, 0.123456789, 0.5, 0.75, 1]) {
    const bar = pct(splitBarLeft(split));
    const clipLeft = pct(splitClipPath(split).replace(/^inset\(0 0 0 /, ""));
    assert.ok(Math.abs(bar - clipLeft) < 1e-9, `split ${split}`);
  }
});

test("split is clamped to the pane", () => {
  assert.equal(clampSplit(-1), 0);
  assert.equal(clampSplit(2), 1);
  assert.equal(clampSplit(Number.NaN), 0.5);
  assert.equal(splitBarLeft(2), "100%");
  assert.equal(splitClipPath(-1), "inset(0 0 0 0%)");
  assert.equal(splitClipPath(2), "inset(0 0 0 100%)");
});

test("screen ↔ content mapping round-trips at every zoom and pan", () => {
  const width = 424.664; // fractional pane widths are the norm
  for (const t of [
    { scale: 1, x: 0, y: 0 },
    { scale: 16, x: -3000.25, y: -12 },
    { scale: 20.0855, x: -3798.02, y: -5000.41 },
    { scale: 63.9, x: -26000.5, y: 0 },
  ]) {
    const barScreen = 0.5 * width;
    const c = screenToContentX(barScreen, t);
    assert.ok(Math.abs(contentToScreenX(c, t) - barScreen) < 1e-9);
  }
});
