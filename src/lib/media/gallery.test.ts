import { test } from "node:test";
import assert from "node:assert/strict";
import type { SequencePoint } from "../../api/types.ts";
import {
  GALLERY_MIME,
  galleryCount,
  galleryGridColumns,
  galleryItemPoints,
  isGalleryPoint,
  parseGalleryManifest,
} from "./gallery.ts";

const point = (over: Partial<SequencePoint> = {}): SequencePoint => ({
  step: 3,
  wall_time: "2026-01-01T00:00:00Z",
  scalar_value: null,
  artifact_hash: "m",
  artifact_mime: GALLERY_MIME,
  artifact_metadata: JSON.stringify({ gallery: 3 }),
  object_type: "figure",
  metadata: JSON.stringify({ caption: "the point" }),
  ...over,
});

test("a gallery point is one whose artifact is the gallery manifest", () => {
  assert.equal(isGalleryPoint(point()), true);
  assert.equal(isGalleryPoint(point({ artifact_mime: "image/png" })), false);
  assert.equal(isGalleryPoint(point({ artifact_hash: null })), false);
  assert.equal(isGalleryPoint(null), false);
});

test("galleryCount reads the manifest size from the point's metadata", () => {
  assert.equal(galleryCount(point()), 3);
  assert.equal(galleryCount(point({ artifact_mime: "text/html" })), 1);
  assert.equal(galleryCount(point({ artifact_metadata: "not json" })), 1);
  assert.equal(galleryCount(point({ artifact_hash: null })), 0);
  assert.equal(galleryCount(undefined), 0);
});

test("parseGalleryManifest keeps well-formed items and normalises the rest", () => {
  const items = parseGalleryManifest({
    items: [
      { hash: "a", mime_type: "text/html", metadata: { preview: "p" }, caption: "first" },
      { hash: "b" },
      { mime_type: "x" },
      null,
      { hash: "c", caption: "" },
    ],
  });
  assert.deepEqual(items, [
    { hash: "a", mime_type: "text/html", metadata: { preview: "p" }, caption: "first" },
    { hash: "b", mime_type: null, metadata: null, caption: null },
    { hash: "c", mime_type: null, metadata: null, caption: null },
  ]);
  assert.deepEqual(parseGalleryManifest({ images: [{ hash: "a" }] }), []);
  assert.deepEqual(parseGalleryManifest(null), []);
});

test("galleryItemPoints turns each item into a plain point of the gallery's step and kind", () => {
  const items = parseGalleryManifest({ items: [{ hash: "a", mime_type: "video/mp4", metadata: { fps: 4 }, caption: "c" }] });
  const [p] = galleryItemPoints(point(), items);
  assert.equal(p!.step, 3);
  assert.equal(p!.object_type, "figure");
  assert.equal(p!.artifact_hash, "a");
  assert.equal(p!.artifact_mime, "video/mp4");
  assert.deepEqual(JSON.parse(p!.artifact_metadata!), { fps: 4 });
  // The caption is the gallery's to show, not the item renderer's.
  assert.equal(p!.metadata, null);
  assert.equal(isGalleryPoint(p), false);
});

test("galleryGridColumns: near-square by default, a count when set", () => {
  assert.equal(galleryGridColumns(0), 1);
  assert.equal(galleryGridColumns(1), 1);
  assert.equal(galleryGridColumns(2), 2);
  assert.equal(galleryGridColumns(4), 2);
  assert.equal(galleryGridColumns(5), 3);
  assert.equal(galleryGridColumns(25), 5);
  assert.equal(galleryGridColumns(25, "auto", 4), 4);
  assert.equal(galleryGridColumns(3, 5), 3);
  assert.equal(galleryGridColumns(6, 2), 2);
  assert.equal(galleryGridColumns(6, 0), 3);
});
