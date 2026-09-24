import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactFormat, describeEncoding, isBrowserDisplayable } from "./artifact-format.ts";

test("artifactFormat maps mimes to cairn-plot format hints", () => {
  assert.equal(artifactFormat("image/x-exr"), "exr");
  assert.equal(artifactFormat("IMAGE/X-EXR"), "exr");
  assert.equal(artifactFormat("image/aces"), "exr");
  assert.equal(artifactFormat("image/openexr"), "exr");
  assert.equal(artifactFormat("application/x-npy"), "npy");
  assert.equal(artifactFormat("application/numpy"), "npy");
  assert.equal(artifactFormat("image/png"), undefined);
  assert.equal(artifactFormat(null), undefined);
});

test("isBrowserDisplayable accepts native image formats only", () => {
  assert.equal(isBrowserDisplayable("image/png"), true);
  assert.equal(isBrowserDisplayable("IMAGE/JPEG"), true);
  assert.equal(isBrowserDisplayable("image/webp"), true);
  assert.equal(isBrowserDisplayable("image/x-exr"), false);
  assert.equal(isBrowserDisplayable("application/x-npy"), false);
  assert.equal(isBrowserDisplayable(null), false);
});

test("describeEncoding prefers the SDK's canonical encoding", () => {
  assert.equal(describeEncoding("image/x-exr", { encoding: "exr:dwab:half" }), "EXR (dwab, half)");
  assert.equal(describeEncoding("application/x-npy", { encoding: "npy" }), "NPY");
  assert.equal(describeEncoding("image/x-exr", null), "EXR");
  assert.equal(describeEncoding(undefined), "UNKNOWN");
});
