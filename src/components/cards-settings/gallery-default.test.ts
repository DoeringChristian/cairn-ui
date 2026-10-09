import { test } from "node:test";
import assert from "node:assert/strict";
import * as image from "./image.ts";
import * as video from "./video.ts";
import * as audio from "./audio.ts";
import * as text from "./text.ts";
import { scene3dMeta } from "./scene3d.ts";

test("gallery column content: Index for image/video/audio/text lists (wandb), Run for 3D (WebGL context limit)", () => {
  for (const m of [image, video, audio, text]) assert.equal(m.meta.builtin.galleryContent, "index");
  assert.equal(scene3dMeta().builtin.galleryContent, "run");
});
