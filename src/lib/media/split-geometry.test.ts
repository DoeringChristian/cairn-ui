import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampSplit,
  contentToScreenX,
  screenToContentX,
  splitBarLeft,
  splitClipPath,
  wheelZoom,
  sameTransform,
  screenPerSourcePixel,
  cssImageRendering,
  MAX_SCALE,
  MIN_SCALE,
  WHEEL_ZOOM,
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

test("wheel zoom is multiplicative: one notch up then down restores the scale", () => {
  const t0 = { scale: 2, x: -100, y: -50 };
  const a = wheelZoom(t0, -100, 150, 80, 400, 300)!;
  assert.ok(Math.abs(a.scale - 2 * Math.exp(100 * WHEEL_ZOOM)) < 1e-12);
  const b = wheelZoom(a, 100, 150, 80, 400, 300)!;
  assert.ok(Math.abs(b.scale - 2) < 1e-12);
});

test("wheel zoom keeps the content point under the cursor fixed", () => {
  const t0 = { scale: 3, x: -300, y: -200 };
  const [mx, my] = [123.4, 87.6];
  const before = { x: (mx - t0.x) / t0.scale, y: (my - t0.y) / t0.scale };
  const t1 = wheelZoom(t0, -50, mx, my, 400, 300)!;
  assert.ok(Math.abs(t1.x + before.x * t1.scale - mx) < 1e-9);
  assert.ok(Math.abs(t1.y + before.y * t1.scale - my) < 1e-9);
});

test("wheel zoom clamps the scale and stays inside the content bounds", () => {
  assert.equal(wheelZoom({ scale: MIN_SCALE, x: 0, y: 0 }, 100, 10, 10, 400, 300), null);
  assert.equal(wheelZoom({ scale: MAX_SCALE, x: 0, y: 0 }, -100, 10, 10, 400, 300), null);
  const top = wheelZoom({ scale: 60, x: 0, y: 0 }, -10000, 0, 0, 400, 300)!;
  assert.equal(top.scale, MAX_SCALE);
  // Zooming out near a corner pans back so no empty margin shows.
  const out = wheelZoom({ scale: 4, x: -1200, y: -900 }, 400, 399, 299, 400, 300)!;
  assert.ok(out.x <= 0 && out.x >= 400 - 400 * out.scale);
  assert.ok(out.y <= 0 && out.y >= 300 - 300 * out.scale);
  const fitted = wheelZoom({ scale: 1.2, x: -40, y: -30 }, 10000, 200, 150, 400, 300)!;
  assert.deepEqual(fitted, { scale: 1, x: 0, y: 0 });
});

test("sameTransform ignores sub-pixel pans only", () => {
  assert.ok(sameTransform({ scale: 2, x: 1, y: 1 }, { scale: 2, x: 1.4, y: 0.6 }));
  assert.ok(!sameTransform({ scale: 2, x: 1, y: 1 }, { scale: 2, x: 1.6, y: 1 }));
  assert.ok(!sameTransform({ scale: 2, x: 1, y: 1 }, { scale: 2.001, x: 1, y: 1 }));
});

test("screen pixels per source pixel: contain fit times zoom", () => {
  assert.equal(screenPerSourcePixel({ w: 400, h: 300 }, { w: 100, h: 100 }, 1), 3);
  assert.equal(screenPerSourcePixel({ w: 400, h: 300 }, { w: 100, h: 100 }, 2), 6);
  assert.equal(screenPerSourcePixel({ w: 400, h: 300 }, null, 2), 0);
  assert.equal(screenPerSourcePixel({ w: 0, h: 300 }, { w: 100, h: 100 }, 2), 0);
});

test("rendering: auto turns crisp above 1.5 screen px per source px", () => {
  assert.equal(cssImageRendering("auto", 1.5), "auto");
  assert.equal(cssImageRendering("auto", 1.51), "pixelated");
  assert.equal(cssImageRendering("smooth", 40), "auto");
  assert.equal(cssImageRendering("pixelated", 0.5), "pixelated");
});
