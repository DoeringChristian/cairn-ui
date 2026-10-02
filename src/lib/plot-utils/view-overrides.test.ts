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

test("reconcileOwnView: a plot's own camera yields once the host moves the camera (sync never sticks)", async () => {
  const { reconcileOwnView } = await import("./view-overrides.ts");
  const mine = { eye: { x: 1, y: 1, z: 1 } };
  const shared = { eye: { x: 2, y: 0, z: 0.5 } };
  const own = { "scene.camera": mine, "xaxis.range[0]": 0, "xaxis.range[1]": 5 };
  // Host layout unchanged since the last draw (e.g. redraw after a pause): own view stands.
  const l0 = { scene: { camera: { eye: { x: 0, y: 0, z: 2 } } }, xaxis: {} };
  assert.equal(reconcileOwnView(l0, { ...l0 }, own), own);
  // Another pane's camera arrives through the layout: the camera follows it; own 2D range stays.
  const l1 = { scene: { camera: shared }, xaxis: {} };
  assert.deepEqual(reconcileOwnView(l0, l1, own), { "xaxis.range[0]": 0, "xaxis.range[1]": 5 });
  // A range change drops both ends of that axis.
  const l2 = { scene: { camera: { eye: { x: 0, y: 0, z: 2 } } }, xaxis: { range: [1, 2] } };
  assert.deepEqual(reconcileOwnView(l0, l2, own), { "scene.camera": mine });
});
