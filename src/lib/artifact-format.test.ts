import { test } from "node:test";
import assert from "node:assert/strict";
import { describeEncoding, isBrowserDisplayable } from "./artifact-format.ts";

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
