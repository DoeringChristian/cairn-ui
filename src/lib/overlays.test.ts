import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boxCaption,
  boxToRect,
  classColor,
  collectClasses,
  colorizeMask,
  maskClassIds,
  maskLut,
  mergeOverlaySummaries,
  summarizeOverlays,
  parseOverlays,
  visibleBoxes,
  type OverlayBox,
} from "./overlays.ts";

const box = (over: Partial<OverlayBox> = {}): OverlayBox => ({
  position: { minX: 0.1, minY: 0.2, maxX: 0.5, maxY: 0.6 },
  domain: "fraction",
  class_id: 1,
  label: null,
  score: null,
  ...over,
});

test("parseOverlays: none → null", () => {
  assert.equal(parseOverlays(null), null);
  assert.equal(parseOverlays({ encoding: "png" }), null);
  assert.equal(parseOverlays({ boxes: [], masks: {} }), null);
});

test("parseOverlays: SDK shape, labels merged, bad boxes dropped", () => {
  const o = parseOverlays({
    boxes: [
      { position: { minX: 1, minY: 2, maxX: 3, maxY: 4 }, domain: "pixel", class_id: 2, label: "cat", score: 0.9 },
      { position: { minX: 1 } },
      "nope",
    ],
    class_labels: { "2": "cat" },
    masks: { pred: { png_b64: "AAA", class_labels: { "1": "road" } }, bad: { png: 1 } },
  })!;
  assert.equal(o.boxes.length, 1);
  assert.deepEqual(o.boxes[0], {
    position: { minX: 1, minY: 2, maxX: 3, maxY: 4 }, domain: "pixel", class_id: 2, label: "cat", score: 0.9,
  });
  assert.deepEqual(o.masks, [{ name: "pred", pngB64: "AAA" }]);
  assert.deepEqual(o.classLabels, { "2": "cat", "1": "road" });
});

test("boxToRect: fraction scales by w/h, pixel is as-is, corners normalised", () => {
  const r = boxToRect(box(), 200, 100);
  assert.ok(Math.abs(r.x - 20) < 1e-9 && Math.abs(r.y - 20) < 1e-9);
  assert.ok(Math.abs(r.width - 80) < 1e-9 && Math.abs(r.height - 40) < 1e-9);
  assert.deepEqual(
    boxToRect(box({ domain: "pixel", position: { minX: 30, minY: 40, maxX: 10, maxY: 5 } }), 200, 100),
    { x: 10, y: 5, width: 20, height: 35 },
  );
});

test("boxCaption: label, else class name, plus score", () => {
  assert.equal(boxCaption(box({ label: "dog", score: 0.456 }), {}), "dog 0.46");
  assert.equal(boxCaption(box({ class_id: 3 }), { "3": "car" }), "car");
  assert.equal(boxCaption(box({ class_id: 4 }), {}), "class 4");
});

test("visibleBoxes: min score and hidden classes; unscored boxes pass", () => {
  const boxes = [box({ score: 0.2 }), box({ score: 0.8 }), box({ score: null }), box({ class_id: 2, score: 0.9 })];
  assert.deepEqual(
    visibleBoxes(boxes, { minScore: 0.5, hiddenClasses: [2] }),
    [boxes[1], boxes[2]],
  );
});

test("classColor: palette hex, cycling", () => {
  assert.equal(classColor(0), "#1f77b4");
  assert.equal(classColor(1), "#ff7f0e");
  assert.equal(classColor(10), "#1f77b4");
});

test("maskLut: background and hidden classes transparent, others opaque palette", () => {
  const lut = maskLut([2]);
  assert.equal(lut.length, 1024);
  assert.equal(lut[3], 0);
  assert.deepEqual([...lut.slice(4, 8)], [0xff, 0x7f, 0x0e, 255]);
  assert.equal(lut[2 * 4 + 3], 0);
});

test("colorizeMask maps class ids through the LUT", () => {
  const out = colorizeMask(Uint8Array.from([0, 1, 2]), maskLut([2]));
  assert.deepEqual([...out], [0, 0, 0, 0, 0xff, 0x7f, 0x0e, 255, 0, 0, 0, 0]);
});

test("maskClassIds: distinct non-background ids", () => {
  assert.deepEqual(maskClassIds(Uint8Array.from([0, 5, 3, 5])), [3, 5]);
});

test("collectClasses: boxes + labels + extra ids, background label skipped", () => {
  const a = parseOverlays({ boxes: [{ position: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, class_id: 7 }], class_labels: { "0": "bg", "1": "road" } });
  const b = parseOverlays({ masks: { m: { png_b64: "x" } } });
  assert.deepEqual(collectClasses([a, null, b], [9, 1]), [
    { id: 1, name: "road" },
    { id: 7, name: "class 7" },
    { id: 9, name: "class 9" },
  ]);
});

test("summarizeOverlays + mergeOverlaySummaries", () => {
  const a = parseOverlays({ boxes: [{ position: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, class_id: 2, score: 0.5 }] });
  const b = parseOverlays({ masks: { m: { png_b64: "x", class_labels: { "1": "road" } } } });
  const sa = summarizeOverlays([a]);
  assert.deepEqual(sa, { classes: [{ id: 2, name: "class 2" }], hasBoxes: true, hasMasks: false, hasScores: true });
  const sb = summarizeOverlays([null, b], [1, 3]);
  assert.deepEqual(sb, { classes: [{ id: 1, name: "road" }, { id: 3, name: "class 3" }], hasBoxes: false, hasMasks: true, hasScores: false });
  assert.deepEqual(mergeOverlaySummaries([sa, sb]), {
    classes: [{ id: 1, name: "road" }, { id: 2, name: "class 2" }, { id: 3, name: "class 3" }],
    hasBoxes: true, hasMasks: true, hasScores: true,
  });
});
