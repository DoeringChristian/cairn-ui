/** Picking custom viewers from the project's list. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import type { ViewerInfo } from "../../api/types";
import { currentViewers, defaultViewerName, resolveViewer, viewersFor } from "./viewers.ts";

const v = (o: Partial<ViewerInfo>): ViewerInfo => ({
  name: "a", title: "A", entry: "index.js", accepts: ["custom:*"], inputs: "single", webgl: false, view: false,
  settings: [], imports: {}, dev: false, version_id: "id", version: 1, digest: "d", content_digest: "c",
  updated_at: "", error: null, ...o,
});

test("resolveViewer: dev wins, then the newest version; pins name a version", () => {
  const list = [v({ version: 1, version_id: "v1" }), v({ version: 3, version_id: "v3" }), v({ dev: true, version: null, version_id: null, revision: 2 })];
  assert.equal(resolveViewer(list, "a")!.dev, true);
  assert.equal(resolveViewer(list, "a", 1)!.version_id, "v1");
  assert.equal(resolveViewer(list, "a", 2), null);
  assert.equal(resolveViewer(list.slice(0, 2), "a")!.version_id, "v3");
  assert.equal(resolveViewer(list, "b"), null);
  const broken = [v({ version_id: "v1" }), v({ dev: true, error: "bad manifest", version_id: null })];
  assert.equal(resolveViewer(broken, "a")!.version_id, "v1", "a broken dev source falls back to the published one");
  assert.equal(resolveViewer([broken[1]!], "a")!.dev, true, "and shows its error when it is all there is");
});

test("viewersFor: matching viewers, most specific first", () => {
  const list = [
    v({ name: "any", title: "Any", accepts: ["custom:*"] }),
    v({ name: "vmf", title: "VMF", accepts: ["custom:guiding/vmf"] }),
    v({ name: "vol", title: "Vol", accepts: ["volume"] }),
    v({ name: "g", title: "G", accepts: ["custom:guiding/*"] }),
  ];
  const s = { object_type: "custom", kind: "guiding/vmf" };
  assert.deepEqual(viewersFor(list, [s]).map((x) => x.name), ["vmf", "g", "any"]);
  assert.deepEqual(viewersFor(list, [{ object_type: "volume" }]).map((x) => x.name), ["vol"]);
  assert.deepEqual(viewersFor(list, [s, { object_type: "custom", kind: "field/2d" }]).map((x) => x.name), ["any"], "every series must match");
  assert.deepEqual(viewersFor(list, []), []);
});

test("currentViewers: one per name, A–Z", () => {
  const list = [v({ name: "b", title: "B" }), v({ name: "a", title: "A", version: 2 }), v({ name: "a", title: "A", version: 1 })];
  assert.deepEqual(currentViewers(list).map((x) => `${x.name}${x.version}`), ["a2", "b1"]);
});

test("defaultViewerName: the project's default, else a built-in viewer's, else (custom data only) the best match", () => {
  const list = [
    v({ name: "cairn.volume", builtin: true, version: null, version_id: null, accepts: ["volume"] }),
    v({ name: "ray", accepts: ["volume"] }),
    v({ name: "g", accepts: ["custom:guiding/*"] }),
    v({ name: "vmf", accepts: ["custom:guiding/vmf"] }),
    v({ name: "img", accepts: ["image"] }),
  ];
  const vol = { object_type: "volume" };
  const vmf = { object_type: "custom", kind: "guiding/vmf" };
  const builtin = { volume: "cairn.volume" };
  // A published viewer accepting volume does not take over the built-in default.
  assert.equal(defaultViewerName({ defaults: {}, builtin }, list, vol), "cairn.volume");
  assert.equal(defaultViewerName({ defaults: { volume: "ray" }, builtin }, list, vol), "ray");
  // Built-in types without a default: their own renderer; a viewer accepting them never picks itself.
  assert.equal(defaultViewerName({ defaults: {}, builtin }, list, { object_type: "image" }), null);
  assert.equal(defaultViewerName({ defaults: { image: "img" }, builtin }, list, { object_type: "image" }), "img");
  // Custom data: the most specific key; a missing viewer is skipped; no key: the best accepting viewer.
  assert.equal(defaultViewerName({ defaults: { "custom:guiding/*": "g" }, builtin }, list, vmf), "g");
  assert.equal(defaultViewerName({ defaults: { "custom:guiding/*": "g", "custom:guiding/vmf": "vmf" }, builtin }, list, vmf), "vmf");
  assert.equal(defaultViewerName({ defaults: { "custom:guiding/*": "gone" }, builtin }, list, vmf), "vmf");
  assert.equal(defaultViewerName(null, list, vmf), "vmf");
  assert.equal(defaultViewerName(null, [], vol), null);
});
