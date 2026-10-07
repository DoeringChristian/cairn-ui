import { test } from "node:test";
import assert from "node:assert/strict";
import { GALLERY_MIME } from "./gallery.ts";
import { summaryLeafCount, summaryMediaLabel, summaryMediaOf } from "./summary-media.ts";

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

test("the Overview names a value's kind, a gallery with its item count", () => {
  assert.equal(summaryMediaLabel(summaryMediaOf(fig)!), "figure");
  assert.equal(summaryMediaLabel(summaryMediaOf(vid)!), "video");
  const m = summaryMediaOf(gal)!;
  assert.equal(summaryMediaLabel(m), "images"); // manifest loading
  assert.equal(summaryMediaLabel(m, Array.from({ length: 6 }, (_, i) => item(`i${i}`))), "6 images");
  assert.equal(summaryMediaLabel(m, [item("a")]), "1 image");
});

test("the header counts leaves, a media value as one", () => {
  assert.equal(summaryLeafCount({ showcase: { loss_landscape: fig, samples: gal }, best_val_loss: 0.26, tags: [1, 2], empty: {} }), 4);
  assert.equal(summaryLeafCount({}), 0);
});
