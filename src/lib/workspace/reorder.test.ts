import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import { deriveLayout, type MetricInfo } from "./layout.ts";
import {
  dropBeforeId,
  isSameSpot,
  keyboardMove,
  moveCardOp,
  moveSectionOp,
  reorderBeforeId,
  sectionDropBefore,
  sectionKeyboardBefore,
} from "./reorder.ts";

const M = (name: string): MetricInfo => ({ name, object_type: "scalar", count: 5, runIds: ["r1"] });
const P = (id: string, names: string[]): Panel => ({ id, type: "scalar", selector: { names }, settings: {} });
const shape = (secs: ReturnType<typeof deriveLayout>) =>
  secs.map((s) => `${s.name}${s.inDoc ? "" : "*"}:${s.panels.map((p) => p.panel.id).join(",")}`);

test("dropping on a card takes its place", () => {
  const ids = ["a", "b", "c", "d"];
  assert.equal(reorderBeforeId(ids, "a", "c"), "d"); // later: after it
  assert.equal(reorderBeforeId(ids, "d", "b"), "b"); // earlier: before it
  assert.equal(reorderBeforeId(ids, "a", "d"), null);
  assert.equal(reorderBeforeId(ids, "x", "b"), "b"); // from another section: before it
});

test("dropping on a card's half: before it, or before the one after it", () => {
  const ids = ["a", "b", "c"];
  assert.equal(dropBeforeId(ids, "a", "b", false), "b");
  assert.equal(dropBeforeId(ids, "a", "b", true), "c");
  assert.equal(dropBeforeId(ids, "a", "c", true), null);
  assert.equal(dropBeforeId(ids, "c", "b", true), null); // skipping the moving card itself
  assert.equal(sectionDropBefore(["s1", "s2", "s3"], "s1", "s2", true), "s3");
});

test("keyboard moves step past a neighbour, then across sections", () => {
  const cols = [
    { name: "A", ids: ["a1", "a2"] },
    { name: "B", ids: [] },
    { name: "C", ids: ["c1"] },
  ];
  assert.deepEqual(keyboardMove(cols, "a1", 1), { section: "A", beforeId: null });
  assert.deepEqual(keyboardMove(cols, "a2", -1), { section: "A", beforeId: "a1" });
  assert.deepEqual(keyboardMove(cols, "a2", 1), { section: "B", beforeId: null });
  assert.deepEqual(keyboardMove(cols, "c1", -1), { section: "B", beforeId: null });
  assert.equal(keyboardMove(cols, "a1", -1), null);
  assert.equal(keyboardMove(cols, "c1", 1), null);
  const three = [{ name: "A", ids: ["x", "y", "z"] }];
  assert.deepEqual(keyboardMove(three, "x", 1), { section: "A", beforeId: "z" });
  assert.ok(isSameSpot(three, "x", { section: "A", beforeId: "y" }));
  assert.ok(isSameSpot(three, "x", { section: "A", beforeId: "x" }));
  assert.ok(!isSameSpot(three, "x", { section: "A", beforeId: "z" }));
});

test("section keyboard moves", () => {
  const names = ["s1", "s2", "s3"];
  assert.equal(sectionKeyboardBefore(names, "s2", -1), "s1");
  assert.equal(sectionKeyboardBefore(names, "s1", 1), "s3");
  assert.equal(sectionKeyboardBefore(names, "s2", 1), null);
  assert.equal(sectionKeyboardBefore(names, "s1", -1), undefined);
  assert.equal(sectionKeyboardBefore(names, "s3", 1), undefined);
});

test("moving a card across sections materializes both sections, nothing else moves", () => {
  const metrics = [M("train.a"), M("train.b"), M("val.a"), M("val.b")];
  const doc = ops.addPanels("mine", [P("m1", ["train.a", "val.a"]), P("m2", ["val.b", "train.b"])])(EMPTY_WORKSPACE);
  const secs = deriveLayout(doc, metrics);
  assert.deepEqual(shape(secs), ["mine:m1,m2", "train*:auto:train.a,auto:train.b", "val*:auto:val.a,auto:val.b"]);
  // An automatic card into the middle of another automatic section.
  const next = moveCardOp(secs, "auto:train.b", { section: "val", beforeId: "auto:val.b" })(doc);
  assert.deepEqual(shape(deriveLayout(next, metrics)), ["mine:m1,m2", "train:auto:train.a", "val:auto:val.a,auto:train.b,auto:val.b"]);
  // A card to the end of an empty section.
  const withEmpty = ops.addSection("empty")(next);
  const moved = moveCardOp(deriveLayout(withEmpty, metrics), "m1", { section: "empty", beforeId: null })(withEmpty);
  assert.deepEqual(shape(deriveLayout(moved, metrics)), ["mine:m2", "train:auto:train.a", "val:auto:val.a,auto:train.b,auto:val.b", "empty:m1"]);
});

test("moving a section gives every rendered section its place first", () => {
  const metrics = [M("train.a"), M("val.a")];
  const doc = ops.addPanels("mine", [P("m1", ["train.a", "val.a"])])(EMPTY_WORKSPACE);
  const names = deriveLayout(doc, metrics).map((s) => s.name);
  assert.deepEqual(names, ["mine", "train", "val"]);
  const next = moveSectionOp(names, "val", "mine")(doc);
  assert.deepEqual(deriveLayout(next, metrics).map((s) => s.name), ["val", "mine", "train"]);
  const last = moveSectionOp(names, "mine", null)(doc);
  assert.deepEqual(last.sections.map((s) => s.name), ["train", "val", "mine"]);
  assert.equal(ops.placeSection("mine", "mine")(doc), doc);
});
