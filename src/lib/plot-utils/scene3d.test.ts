import { test } from "node:test";
import assert from "node:assert/strict";
import { axisRangeUpdates, cameraUpdates, createViewLink, scene3dLayout, sceneIds, type ViewFollower } from "./scene3d.ts";

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

test("axis ranges of a relayout event: both ends, by axis", () => {
  assert.deepEqual(axisRangeUpdates({ "xaxis.range[0]": 1, "xaxis.range[1]": 5, "yaxis2.range": [0, 2] }), { xaxis: [1, 5], yaxis2: [0, 2] });
  assert.deepEqual(axisRangeUpdates({ "xaxis.range[0]": 1 }), {}); // one end only
  assert.deepEqual(axisRangeUpdates({ "xaxis.autorange": true, "scene.camera": {} }), {});
});

function follower(name: string, seen: string[]): ViewFollower {
  return {
    showCamera: (id, cam) => seen.push(`${name}:${id}:${(cam.eye as { x: number }).x}`),
    showRanges: (ranges) => seen.push(`${name}:${JSON.stringify(ranges)}`),
  };
}

test("a view link shows a dragged plot's camera and ranges on every other plot, never back on the dragged one", () => {
  const link = createViewLink((flush) => flush());
  const seen: string[] = [];
  const a = follower("a", seen), b = follower("b", seen), c = follower("c", seen);
  link.join(a);
  const leaveB = link.join(b);
  link.join(c);
  link.moved(a, { "scene.camera": { eye: { x: 1 } } });
  assert.deepEqual(seen, ["b:scene:1", "c:scene:1"]);
  seen.length = 0;
  leaveB();
  link.moved(c, { "xaxis.range[0]": 0, "xaxis.range[1]": 4 });
  link.moved(c, { "xaxis.autorange": true });
  assert.deepEqual(seen, ['a:{"xaxis":[0,4]}']);
});

test("a view link shows only the latest view per plot, once per frame", () => {
  const frames: Array<() => void> = [];
  const link = createViewLink((flush) => frames.push(flush));
  const seen: string[] = [];
  const a = follower("a", seen), b = follower("b", seen);
  link.join(a);
  link.join(b);
  for (let x = 1; x <= 5; x++) link.moved(a, { "xaxis.range": [x, x + 10] });
  assert.equal(frames.length, 1);
  assert.deepEqual(seen, []);
  frames.shift()!();
  assert.deepEqual(seen, ['b:{"xaxis":[5,15]}']);
});
