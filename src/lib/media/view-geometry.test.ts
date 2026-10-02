import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIT_VIEW,
  clampTransform,
  fitRect,
  isFitView,
  transformToView,
  viewToTransform,
  visibleContent,
  type ZoomView,
  type Size,
} from "./view-geometry.ts";
import { MAX_SCALE, wheelZoom } from "./split-geometry.ts";

const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/** Panes of many sizes and aspect ratios, from gallery cells to a full-screen modal. */
const PANES: Size[] = [
  { w: 610, h: 257 }, { w: 390, h: 417 }, { w: 257, h: 417 }, { w: 934, h: 846 }, { w: 113, h: 257 },
  { w: 1800, h: 300 }, { w: 120.5, h: 900.25 }, { w: 400, h: 400 },
];
/** Media sizes: landscape, portrait, square, extreme, unknown. */
const CONTENT: Array<Size | null> = [{ w: 640, h: 400 }, { w: 300, h: 500 }, { w: 320, h: 192 }, { w: 64, h: 64 }, { w: 4000, h: 50 }, null];

/** The media point (fractions) shown at pane pixel (sx, sy) under transform t. */
function mediaAt(t: { scale: number; x: number; y: number }, pane: Size, content: Size | null, sx: number, sy: number) {
  const fit = fitRect(pane, content);
  return [((sx - t.x) / t.scale - fit.x) / fit.w, ((sy - t.y) / t.scale - fit.y) / fit.h] as const;
}

/** The pane can put the view's point at its centre without leaving the pan bounds. */
function centrable(view: ZoomView, pane: Size, content: Size | null) {
  const fit = fitRect(pane, content);
  const raw = { scale: view.zoom, x: pane.w / 2 - view.zoom * (fit.x + view.cx * fit.w), y: pane.h / 2 - view.zoom * (fit.y + view.cy * fit.h) };
  const c = clampTransform(raw, pane);
  return Math.abs(c.x - raw.x) < 1e-9 && Math.abs(c.y - raw.y) < 1e-9;
}

test("fitRect is object-contain: centred, aspect kept, touching two pane edges", () => {
  const r = fitRect({ w: 610, h: 257 }, { w: 640, h: 400 });
  near(r.h, 257, 1e-9, "height-limited");
  near(r.w / r.h, 640 / 400, 1e-9, "aspect");
  near(r.x, (610 - r.w) / 2, 1e-9, "centred");
  assert.equal(r.y, 0);
  assert.deepEqual(fitRect({ w: 200, h: 100 }, null), { x: 0, y: 0, w: 200, h: 100 });
});

test("the fitted view is the identity transform in every pane", () => {
  for (const pane of PANES) for (const content of CONTENT) {
    const t = viewToTransform(FIT_VIEW, pane, content);
    assert.equal(t.scale, 1);
    near(t.x, 0, 1e-9, "x");
    near(t.y, 0, 1e-9, "y");
    const v = transformToView({ scale: 1, x: 0, y: 0 }, pane, content);
    near(v.cx, 0.5, 1e-12, "cx");
    near(v.cy, 0.5, 1e-12, "cy");
    assert.ok(isFitView(v));
  }
});

test("round trip view → pixels → view, for many panes, media and views inside the bounds", () => {
  let checked = 0;
  for (const pane of PANES) for (const content of CONTENT) {
    for (const zoom of [1.5, 2, 8.166, 37, MAX_SCALE]) {
      for (const [cx, cy] of [[0.5, 0.5], [0.62, 0.41], [0.3, 0.7], [0.45, 0.55]]) {
        const view: ZoomView = { zoom, cx: cx!, cy: cy! };
        const t = viewToTransform(view, pane, content);
        // Only where the pane can centre that point (else the bounds move it).
        if (!centrable(view, pane, content)) continue;
        const back = transformToView(t, pane, content);
        near(back.zoom, zoom, 1e-12, "zoom");
        near(back.cx, view.cx, 1e-9, "cx");
        near(back.cy, view.cy, 1e-9, "cy");
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `checked ${checked}`);
});

test("round trip pixels → view → pixels, for every transform inside the bounds", () => {
  for (const pane of PANES) for (const content of CONTENT) {
    for (const scale of [1, 1.7, 6.05, 64]) {
      for (const [fx, fy] of [[0, 0], [1, 1], [0.3, 0.8], [0.5, 0.5]]) {
        const t = { scale, x: (pane.w - pane.w * scale) * fx!, y: (pane.h - pane.h * scale) * fy! };
        const back = viewToTransform(transformToView(t, pane, content), pane, content);
        near(back.scale, t.scale, 1e-12, "scale");
        near(back.x, t.x, 1e-6, "x");
        near(back.y, t.y, 1e-6, "y");
      }
    }
  }
});

test("invariance: every pane shows the same media point at its centre, at the same zoom over the fit", () => {
  for (const content of CONTENT) {
    const view: ZoomView = { zoom: 8.166, cx: 0.62, cy: 0.43 };
    for (const pane of PANES) {
      const t = viewToTransform(view, pane, content);
      const [mx, my] = mediaAt(t, pane, content, pane.w / 2, pane.h / 2);
      near(mx, view.cx, 1e-9, `centre x in ${pane.w}x${pane.h}`);
      near(my, view.cy, 1e-9, `centre y in ${pane.w}x${pane.h}`);
      // Visible extent relative to the fit: 1/zoom of the fitted extent along both axes.
      const fit = fitRect(pane, content);
      const vis = visibleContent(view, pane, content);
      near(vis.w, (pane.w / fit.w) / view.zoom, 1e-9, "visible width / fit");
      near(vis.h, (pane.h / fit.h) / view.zoom, 1e-9, "visible height / fit");
      // Along the axis the media fills, that is exactly 1/zoom of the media.
      near(Math.min(vis.w, vis.h), 1 / view.zoom, 1e-9, "limiting axis");
    }
  }
});

test("a resize keeps the view: re-deriving from the view after a size change keeps the centre point", () => {
  const content = { w: 640, h: 400 };
  const a = { w: 610, h: 257 };
  const tA = { scale: 8.166, x: -2687.3, y: -781.1 }; // the repro's zoomed state
  const view = transformToView(tA, a, content);
  for (const b of [{ w: 390, h: 417 }, { w: 257, h: 417 }, { w: 934, h: 846 }]) {
    const [mx, my] = mediaAt(viewToTransform(view, b, content), b, content, b.w / 2, b.h / 2);
    near(mx * content.w, view.cx * content.w, 1e-6, "centre px x");
    near(my * content.h, view.cy * content.h, 1e-6, "centre px y");
  }
  // Back to the first size: the very same pixels.
  const again = viewToTransform(view, a, content);
  near(again.x, tA.x, 1e-6, "x");
  near(again.y, tA.y, 1e-6, "y");
});

test("clamping: a pane that cannot centre the point shows the nearest in-bounds view; the view is untouched", () => {
  const pane = { w: 400, h: 400 };
  const content = { w: 400, h: 400 };
  const view: ZoomView = { zoom: 2, cx: 0.05, cy: 0.98 };
  const t = viewToTransform(view, pane, content);
  assert.equal(t.x, 0); // left edge
  near(t.y, pane.h - pane.h * 2, 1e-9, "bottom edge");
  assert.deepEqual(view, { zoom: 2, cx: 0.05, cy: 0.98 });
  // Zoom outside the range is clamped too.
  assert.equal(viewToTransform({ zoom: 0.2, cx: 0.5, cy: 0.5 }, pane, content).scale, 1);
  assert.equal(viewToTransform({ zoom: 1e4, cx: 0.5, cy: 0.5 }, pane, content).scale, MAX_SCALE);
  // A letterboxed pane CAN centre a point near the media's edge (the letterbox is pannable).
  const wide = { w: 800, h: 400 };
  const tw = viewToTransform({ zoom: 2, cx: 0.05, cy: 0.5 }, wide, content);
  const [mx] = mediaAt(tw, wide, content, wide.w / 2, wide.h / 2);
  near(mx, 0.05, 1e-9, "letterbox centre");
});

test("cursor-anchored wheel zoom keeps the media point under the cursor, in any pane", () => {
  for (const pane of PANES) for (const content of CONTENT) {
    const t = viewToTransform({ zoom: 3, cx: 0.5, cy: 0.5 }, pane, content);
    const mx = pane.w * 0.4, my = pane.h * 0.45;
    const before = mediaAt(t, pane, content, mx, my);
    const next = wheelZoom(t, -100, mx, my, pane.w, pane.h)!;
    assert.ok(next.scale > t.scale);
    const after = mediaAt(next, pane, content, mx, my);
    near(after[0], before[0], 1e-9, "x under cursor");
    near(after[1], before[1], 1e-9, "y under cursor");
    // The new view, mapped into a pane of another size (transposed), centres
    // the same point: near the middle at this zoom, every pane can.
    const view = transformToView(next, pane, content);
    const other = { w: pane.h, h: pane.w };
    const c = mediaAt(viewToTransform(view, other, content), other, content, other.w / 2, other.h / 2);
    near(c[0], view.cx, 1e-9, "other pane cx");
    near(c[1], view.cy, 1e-9, "other pane cy");
  }
});

test("degenerate sizes never produce NaN", () => {
  for (const pane of [{ w: 0, h: 0 }, { w: 0, h: 300 }]) {
    const t = viewToTransform({ zoom: 4, cx: 0.3, cy: 0.3 }, pane, { w: 640, h: 400 });
    assert.deepEqual(t, { scale: 1, x: 0, y: 0 });
    assert.deepEqual(transformToView({ scale: 2, x: -10, y: -10 }, pane, null), FIT_VIEW);
  }
  const v = transformToView({ scale: 2, x: -10, y: -10 }, { w: 100, h: 100 }, { w: 0, h: 0 });
  assert.ok(Number.isFinite(v.cx) && Number.isFinite(v.cy));
});
