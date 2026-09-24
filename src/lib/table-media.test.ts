import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaKind, mediaOf } from "./table-media.ts";
import { computeTableDiff } from "./table-diff.ts";

const img = (hash: string) => ({ $media: { hash, mime_type: "image/png", object_type: "image" } });

test("mediaOf reads $media cells and rejects everything else", () => {
  assert.deepEqual(mediaOf(img("h")), { hash: "h", mime_type: "image/png", object_type: "image" });
  for (const v of [null, 1, "x", [], { hash: "h" }, { $media: { mime_type: "image/png" } }]) {
    assert.equal(mediaOf(v), null);
  }
});

test("mediaKind picks the player", () => {
  assert.equal(mediaKind({ hash: "h", mime_type: "image/png" }), "image");
  assert.equal(mediaKind({ hash: "h", mime_type: "image/x-exr" }), "file");
  assert.equal(mediaKind({ hash: "h", mime_type: "audio/wav" }), "audio");
  assert.equal(mediaKind({ hash: "h", mime_type: "video/mp4" }), "video");
});

test("table diff aligns rows keyed by a media column by hash, and never colors media", () => {
  const cols = [{ name: "id" }, { name: "score" }, { name: "img" }];
  const a = { columns: cols, data: [[img("x"), 1, img("p")], [img("y"), 2, img("q")]] };
  const b = { columns: cols, data: [[img("y"), 5, img("q")], [img("x"), 0, img("p")]] };
  const [da, db] = computeTableDiff([a, b]);
  // Row "x" is row 0 in a and row 1 in b: 1 > 0.
  assert.equal(da![0]![1], "higher");
  assert.equal(db![1]![1], "lower");
  assert.equal(da![0]![2], "equal");
});
