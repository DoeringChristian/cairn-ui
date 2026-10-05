import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import { deriveLayout, type MetricInfo } from "./layout.ts";
import {
  addCompatibleTypes,
  addDataLabel,
  addDataReady,
  addToSectionOp,
  captureGroups,
  newCards,
  uniqueSectionName,
} from "./add-cards.ts";

const M = (name: string, object_type = "scalar", runIds = ["r1"]): MetricInfo => ({ name, object_type, count: 5, runIds });
const P = (id: string, names: string[]): Panel => ({ id, type: "scalar", selector: { names }, settings: {} });
const METRICS = [M("train.loss"), M("train.acc"), M("val.loss"), M("val.acc"), M("lr"), M("samples", "image")];
const shape = (secs: ReturnType<typeof deriveLayout>) =>
  secs.map((s) => `${s.name}${s.inDoc ? "" : "*"}:${s.panels.map((p) => p.panel.id).join(",")}`);

test("capture groups split matches into one card per distinct capture", () => {
  const r = captureGroups("val\\.(.*)", METRICS);
  assert.ok(r.ok);
  assert.deepEqual(r.groups, [
    { title: "acc", names: ["val.acc"] },
    { title: "loss", names: ["val.loss"] },
  ]);
});

test("metrics sharing a capture share a card; several groups join the title", () => {
  const r = captureGroups(".*\\.(loss|acc)", METRICS);
  assert.ok(r.ok);
  assert.deepEqual(r.groups, [
    { title: "acc", names: ["train.acc", "val.acc"] },
    { title: "loss", names: ["train.loss", "val.loss"] },
  ]);
  const two = captureGroups("(train|val)\\.(loss)", METRICS);
  assert.ok(two.ok);
  assert.deepEqual(two.groups.map((g) => g.title), ["train · loss", "val · loss"]);
});

test("no groups: every match on one card; the pattern is anchored; bad patterns say so", () => {
  const r = captureGroups("val\\..*", METRICS);
  assert.ok(r.ok);
  assert.deepEqual(r.groups, [{ title: "val\\..*", names: ["val.acc", "val.loss"] }]);
  const partial = captureGroups("loss", METRICS);
  assert.ok(partial.ok);
  assert.deepEqual(partial.groups, []);
  assert.equal(captureGroups("val\\.(", METRICS).ok, false);
  assert.equal(captureGroups("  ", METRICS).ok, false);
});

test("groups make one card per group and chosen type, titled by the captures", () => {
  const data = { mode: "groups", regex: "(train|val)\\.loss" } as const;
  assert.ok(addDataReady(data, METRICS));
  assert.equal(addDataLabel(data, METRICS), "/(train|val)\\.loss/ → 2 cards");
  const cards = newCards(data, ["scalar"], METRICS);
  assert.deepEqual(cards, [
    { type: "scalar", selector: { names: ["train.loss"] }, settings: { title: "train" } },
    { type: "scalar", selector: { names: ["val.loss"] }, settings: { title: "val" } },
  ]);
  // Two types: one card of each per group.
  assert.equal(newCards(data, ["scalar", "tile"], METRICS).length, 4);
  assert.equal(addDataReady({ mode: "groups", regex: "nope\\.(.*)" }, METRICS), false);
});

test("groups offer the types every group's card can take", () => {
  const types = (r: ReturnType<typeof addCompatibleTypes>) => r.options.map((o) => `${o.key}${o.unavailable ? `(${o.unavailable})` : ""}`);
  // One series per group: the one-series cards are fine.
  const one = addCompatibleTypes({ mode: "groups", regex: "(train|val)\\.loss" }, METRICS, 3);
  assert.deepEqual(types(one), ["scalar", "tile", "bar", "scatter", "parallel", "importance"]);
  // Two series in a group: the one-series cards are not.
  const two = addCompatibleTypes({ mode: "groups", regex: ".*\\.(loss)" }, METRICS, 3);
  assert.deepEqual(types(two), ["scalar", "tile(shows one series)", "bar(shows one series)", "scatter", "parallel", "importance(shows one series)"]);
  // A group mixing kinds has no type.
  const mixed = addCompatibleTypes({ mode: "groups", regex: "(lr|samples)" }, METRICS, 1);
  assert.deepEqual(types(mixed), []);
  assert.equal(addCompatibleTypes({ mode: "groups", regex: "zz(.*)" }, METRICS, 1).reason, "No series of these runs matches (yet).");
});

test("plain data: one card per chosen type; multi-run cards are titled by their data", () => {
  const cards = newCards({ mode: "series", names: ["val.loss"] }, ["scalar", "tile"], METRICS);
  assert.deepEqual(cards[0], { type: "scalar", selector: { names: ["val.loss"] }, settings: {} });
  assert.equal(cards[1]!.type, "tile");
  assert.equal(cards[1]!.settings.title, "val.loss · Value");
  const custom = newCards({ mode: "series", names: ["samples"] }, ["custom:viewers/x"], METRICS);
  assert.deepEqual(custom, [{ type: "custom", selector: { names: ["samples"] }, settings: { viewer: "viewers/x" } }]);
});

test("unique section names", () => {
  assert.equal(uniqueSectionName("New section", ["a"]), "New section");
  assert.equal(uniqueSectionName("New section", ["New section", "New section 2"]), "New section 3");
});

test("adding to a section puts the cards after its automatic ones; other sections keep their place", () => {
  const doc = ops.addPanels("mine", [P("m", ["lr"])])(EMPTY_WORKSPACE);
  const secs = deriveLayout(doc, METRICS);
  assert.deepEqual(shape(secs), ["mine:m", "train*:auto:train.acc,auto:train.loss", "val*:auto:val.acc,auto:val.loss", "Media*:auto:samples"]);
  const next = addToSectionOp(secs, "val", [P("new", ["train.loss", "val.loss"])])(doc);
  assert.deepEqual(shape(deriveLayout(next, METRICS)), [
    "mine:m",
    "train:auto:train.acc,auto:train.loss",
    "val:auto:val.acc,auto:val.loss,new",
    "Media:auto:samples",
  ]);
  // A brand-new (empty) section of the document.
  const withNew = ops.addSection("New section")(doc);
  const added = addToSectionOp(deriveLayout(withNew, METRICS), "New section", [P("n", ["lr"])])(withNew);
  assert.deepEqual(shape(deriveLayout(added, METRICS)).slice(0, 2), ["mine:m", "New section:n"]);
});
