/** Picking custom viewers from the project's list. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import type { ViewerInfo } from "../../api/types";
import { currentViewers, resolveViewer, viewersFor } from "./viewers.ts";

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
