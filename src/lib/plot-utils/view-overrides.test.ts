import { test } from "node:test";
import assert from "node:assert/strict";
import { applyViewOverrides, sceneCameras } from "./view-overrides.ts";

test("sceneCameras keeps 3D cameras and drops 2D ranges", () => {
  const cam = { eye: { x: 2, y: 0, z: 0.5 } };
  const view = {
    "xaxis.range[0]": 1,
    "yaxis.autorange": true,
    "scene.camera": cam,
    "scene2.camera.eye.x": 3,
    scene3: { camera: cam, aspectmode: "cube" },
    scene4: { aspectmode: "cube" },
  };
  assert.deepEqual(sceneCameras(view), { "scene.camera": cam, "scene2.camera.eye.x": 3, "scene3.camera": cam });
  const layout = applyViewOverrides({ scene: { camera: { eye: { x: 1 } }, xaxis: {} } }, sceneCameras(view));
  assert.deepEqual((layout.scene as Record<string, unknown>).camera, cam);
  assert.deepEqual(sceneCameras({}), {});
});
