/**
 * Custom viewer frames in report exports (frame-snapshots.ts). Run: `npm run test:unit`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { framesBusy, freezeFramesForPrint, registerFrameExport, snapshotFrame } from "./frame-snapshots.ts";

const box = () => ({}) as Element;
const root = (inside: Element[], busy = false) =>
  ({ contains: (e: Element) => inside.includes(e), querySelector: () => (busy ? ({} as Element) : null) }) as unknown as ParentNode & Node;

test("snapshotFrame: a registered frame's picture; unregistered or failing frames give null", async () => {
  const a = box();
  const off = registerFrameExport(a, { snapshot: async () => "data:image/png;base64,AA", setPrint: () => {} });
  assert.equal(await snapshotFrame(a), "data:image/png;base64,AA");
  off();
  assert.equal(await snapshotFrame(a), null);
  const b = box();
  const offB = registerFrameExport(b, { snapshot: () => Promise.reject(new Error("gone")), setPrint: () => {} });
  assert.equal(await snapshotFrame(b), null);
  offB();
});

test("freezeFramesForPrint: frames under the root show their snapshot until thawed; others are left alone", async () => {
  const shown = new Map<string, string | null>();
  const a = box(), b = box(), c = box();
  const offs = [
    registerFrameExport(a, { snapshot: async () => "data:image/png;base64,A", setPrint: (u) => shown.set("a", u) }),
    registerFrameExport(b, { snapshot: async () => null, setPrint: (u) => shown.set("b", u) }),
    registerFrameExport(c, { snapshot: async () => "data:image/png;base64,C", setPrint: (u) => shown.set("c", u) }),
  ];
  const thaw = await freezeFramesForPrint(root([a, b]));
  assert.deepEqual([...shown.entries()], [["a", "data:image/png;base64,A"]]);
  thaw();
  assert.equal(shown.get("a"), null);
  assert.equal(shown.has("c"), false);
  offs.forEach((f) => f());
});

test("an older registration's unregister does not drop a newer one of the same box", async () => {
  const a = box();
  const off1 = registerFrameExport(a, { snapshot: async () => "data:image/png;base64,1", setPrint: () => {} });
  const off2 = registerFrameExport(a, { snapshot: async () => "data:image/png;base64,2", setPrint: () => {} });
  off1();
  assert.equal(await snapshotFrame(a), "data:image/png;base64,2");
  off2();
});

test("framesBusy reads the frames' busy flag", () => {
  assert.equal(framesBusy(root([], true)), true);
  assert.equal(framesBusy(root([], false)), false);
});
