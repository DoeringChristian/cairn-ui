import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraUpdates, createCameraLink, scene3dLayout, sceneIds, type CameraFollower } from "./scene3d.ts";

test("sceneIds lists the 3D scenes the traces draw into", () => {
  assert.deepEqual(sceneIds([{ type: "surface" }, { type: "scatter3d", scene: "scene2" }, { type: "scatter" }]), ["scene", "scene2"]);
  assert.deepEqual(sceneIds([{ type: "scatter" }]), []);
});

test("a drag rotates 3D scenes whatever the card's 2D drag mode; the author's scene dragmode wins", () => {
  const data = [{ type: "surface" }, { type: "scatter3d", scene: "scene2" }];
  const layout = { dragmode: "zoom", scene2: { dragmode: "orbit", camera: { eye: { x: 1 } } } };
  const out = scene3dLayout(layout, data, true);
  assert.equal((out.scene as Record<string, unknown>).dragmode, "turntable");
  assert.equal((out.scene2 as Record<string, unknown>).dragmode, "orbit");
  assert.deepEqual((out.scene2 as Record<string, unknown>).camera, { eye: { x: 1 } });
  assert.equal(out.dragmode, "zoom");
  assert.equal(layout.scene2.dragmode, "orbit"); // input untouched
  assert.equal((scene3dLayout({}, data, false).scene as Record<string, unknown>).dragmode, false);
});

test("3D-only figures without an authored margin get thin margins", () => {
  assert.deepEqual(scene3dLayout({}, [{ type: "surface" }], true).margin, { l: 0, r: 0, b: 0, t: 0, pad: 0 });
  assert.equal((scene3dLayout({ title: { text: "T" } }, [{ type: "surface" }], true).margin as { t: number }).t, 32);
  assert.deepEqual(scene3dLayout({ margin: { l: 5 } }, [{ type: "surface" }], true).margin, { l: 5 });
  // The legend sits over the scene instead of pushing the margin back out; an authored position wins.
  assert.deepEqual(scene3dLayout({ legend: { bgcolor: "x" } }, [{ type: "surface" }], true).legend, { bgcolor: "x", x: 1, xanchor: "right", y: 1, yanchor: "top" });
  assert.deepEqual(scene3dLayout({ legend: { x: 0 } }, [{ type: "surface" }], true).legend, { x: 0 });
  assert.equal(scene3dLayout({}, [{ type: "surface" }, { type: "scatter" }], true).margin, undefined);
  const flat = { dragmode: "pan" };
  assert.equal(scene3dLayout(flat, [{ type: "scatter" }], true), flat);
});

test("cameraUpdates reads scene cameras out of a relayouting event", () => {
  const cam = { eye: { x: 1, y: 2, z: 3 } };
  assert.deepEqual(cameraUpdates({ "scene.camera": cam, "scene2.camera": cam, "xaxis.range[0]": 1, "scene.aspectratio": {} }), [["scene", cam], ["scene2", cam]]);
});

test("a camera link shows a dragged plot's camera on every other plot, never back on the dragged one", () => {
  const link = createCameraLink();
  const seen: string[] = [];
  const mk = (name: string): CameraFollower => ({ showCamera: (id, cam) => seen.push(`${name}:${id}:${(cam.eye as { x: number }).x}`) });
  const a = mk("a"), b = mk("b"), c = mk("c");
  link.join(a);
  const leaveB = link.join(b);
  link.join(c);
  link.moved(a, { "scene.camera": { eye: { x: 1 } } });
  assert.deepEqual(seen, ["b:scene:1", "c:scene:1"]);
  seen.length = 0;
  leaveB();
  link.moved(c, { "scene.camera": { eye: { x: 2 } } });
  link.moved(c, { "xaxis.range[0]": 0 });
  assert.deepEqual(seen, ["a:scene:2"]);
});
