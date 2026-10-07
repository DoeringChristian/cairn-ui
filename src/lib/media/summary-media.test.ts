import { test } from "node:test";
import assert from "node:assert/strict";
import { GALLERY_MIME } from "./gallery.ts";
import { summaryLeafCount, summaryMediaOf, summaryThumb } from "./summary-media.ts";

const fig = { $media: { hash: "f", object_type: "figure", mime_type: "image/png", caption: "c" } };
const gal = { $media: { hash: "g", object_type: "image", mime_type: GALLERY_MIME } };
const vid = { $media: { hash: "v", object_type: "video", mime_type: "video/mp4" } };
const item = (hash: string, mime = "image/png") => ({ hash, mime_type: mime, metadata: null, caption: null });

test("summaryMediaOf reads markers only", () => {
  assert.deepEqual(summaryMediaOf(fig), { hash: "f", mime_type: "image/png", object_type: "figure", caption: "c" });
  assert.equal(summaryMediaOf({ $media: { hash: "x" } }), null); // no object_type
  assert.equal(summaryMediaOf({ $media: fig.$media, other: 1 }), null);
  assert.equal(summaryMediaOf({ a: 1 }), null);
  assert.equal(summaryMediaOf(3), null);
  assert.equal(summaryMediaOf([fig]), null);
});

test("a figure or image is one thumbnail; other kinds an icon", () => {
  assert.deepEqual(summaryThumb(summaryMediaOf(fig)!), { kind: "images", hashes: ["f"], more: 0 });
  assert.deepEqual(summaryThumb(summaryMediaOf(vid)!), { kind: "icon", objectType: "video" });
  const exr = summaryMediaOf({ $media: { hash: "e", object_type: "image", mime_type: "image/x-exr" } })!;
  assert.deepEqual(summaryThumb(exr), { kind: "icon", objectType: "image" });
});

test("a gallery shows up to four thumbnails plus +N", () => {
  const m = summaryMediaOf(gal)!;
  assert.deepEqual(summaryThumb(m), { kind: "images", hashes: [], more: 0 }); // manifest loading
  const eight = Array.from({ length: 8 }, (_, i) => item(`i${i}`));
  assert.deepEqual(summaryThumb(m, eight), { kind: "images", hashes: ["i0", "i1", "i2", "i3"], more: 4 });
  assert.deepEqual(summaryThumb(m, eight.slice(0, 3)), { kind: "images", hashes: ["i0", "i1", "i2"], more: 0 });
  const videos = summaryMediaOf({ $media: { hash: "gv", object_type: "video", mime_type: GALLERY_MIME } })!;
  assert.deepEqual(summaryThumb(videos, [item("a", "video/mp4")]), { kind: "icon", objectType: "video" });
});

test("the header counts leaves, a media value as one", () => {
  assert.equal(summaryLeafCount({ showcase: { loss_landscape: fig, samples: gal }, best_val_loss: 0.26, tags: [1, 2], empty: {} }), 4);
  assert.equal(summaryLeafCount({}), 0);
});
