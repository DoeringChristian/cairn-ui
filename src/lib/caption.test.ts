import { test } from "node:test";
import assert from "node:assert/strict";

import { pointCaption } from "./caption.ts";

test("pointCaption reads the caption from point metadata", () => {
  assert.equal(pointCaption('{"caption":"a cat"}'), "a cat");
  assert.equal(pointCaption(null), null);
  assert.equal(pointCaption(undefined), null);
  assert.equal(pointCaption("{}"), null);
  assert.equal(pointCaption('{"caption":""}'), null);
  assert.equal(pointCaption('{"caption":3}'), null);
  assert.equal(pointCaption("not json"), null);
  assert.equal(pointCaption("null"), null);
});
