import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import { addToSectionOp, autoPanelsOp, deriveLayout, panelsToMaterialize, uniqueSectionName, type MetricInfo } from "./layout.ts";

const M = (name: string, object_type = "scalar", runIds = ["r1"]): MetricInfo => ({ name, object_type, count: 5, runIds });
const P = (id: string, sel: Panel["selector"], type: Panel["type"] = "scalar", settings = {}): Panel => ({ id, type, selector: sel, settings });
const shape = (secs: ReturnType<typeof deriveLayout>) =>
  secs.map((s) => `${s.name}${s.inDoc ? "" : "*"}:${s.panels.map((p) => p.panel.id).join(",")}`);

const METRICS = [M("loss"), M("train.loss"), M("train.acc"), M("val.loss"), M("samples", "image"), M("system.cpu")];

test("an empty doc groups every metric into automatic sections", () => {
  assert.deepEqual(shape(deriveLayout(EMPTY_WORKSPACE, METRICS)), [
    "Charts*:auto:loss",
    "train*:auto:train.acc,auto:train.loss",
    "val*:auto:val.loss",
    "Media*:auto:samples",
    "system*:auto:system.cpu",
  ]);
});

test("doc sections come first; autos append to their named section; claimed and removed metrics get no auto", () => {
  const doc = ops.seq(
    ops.addPanels("val", [P("mine", { names: ["train.loss"] })]),
    ops.addPanels("combo", [P("c", { names: ["train.acc", "val.loss"] })]),
    ops.removePanel("auto:loss", "loss"),
  )(EMPTY_WORKSPACE);
  assert.deepEqual(shape(deriveLayout(doc, METRICS)), [
    "val:mine,auto:val.loss",
    "combo:c",
    "train*:auto:train.acc",
    "Media*:auto:samples",
    "system*:auto:system.cpu",
  ]);
});

test("regex selectors are anchored; missing metrics resolve to nothing (empty state)", () => {
  const doc = ops.addPanels("x", [P("re", { regex: "train\\..*" }), P("gone", { names: ["nope"] }), P("bad", { regex: "(" })])(EMPTY_WORKSPACE);
  const x = deriveLayout(doc, METRICS)[0]!;
  assert.deepEqual(x.panels.map((p) => p.metrics.map((m) => m.name)), [["train.acc", "train.loss"], [], []]);
  assert.equal(x.panels[0]!.label, "/train\\..*/");
});

test("hide patterns and the search query filter by label; sorted sections sort by label", () => {
  const doc = ops.seq(ops.addHidePattern("^system"), ops.addPanels("train", [P("t", { names: ["train.loss"] }, "scalar", { title: "zz" })]), ops.setSectionSorted("train", true))(EMPTY_WORKSPACE);
  const secs = deriveLayout(doc, METRICS);
  assert.equal(secs.some((s) => s.name === "system"), false);
  assert.deepEqual(secs.find((s) => s.name === "train")!.panels.map((p) => p.label), ["train.acc", "zz"]);
  assert.deepEqual(shape(deriveLayout(doc, METRICS, { query: "val" })), ["train:", "val*:auto:val.loss"]);
});

test("materializing writes the autos up to the touched one, keeping the order", () => {
  const secs = deriveLayout(EMPTY_WORKSPACE, [M("a.1"), M("a.2"), M("a.3")]);
  const m = panelsToMaterialize(secs, "auto:a.2")!;
  assert.equal(m.section, "a");
  assert.deepEqual(m.panels.map((p) => p.id), ["auto:a.1", "auto:a.2"]);
  const doc = ops.seq(ops.ensureSections(secs.map((s) => s.name)), ops.addPanels(m.section, m.panels))(EMPTY_WORKSPACE);
  assert.deepEqual(shape(deriveLayout(doc, [M("a.1"), M("a.2"), M("a.3")])), ["a:auto:a.1,auto:a.2,auto:a.3"]);
  assert.equal(deriveLayout(doc, [M("a.1"), M("a.2"), M("a.3")])[0]!.panels[2]!.auto, true);
});

test("multi-run panels are labelled by type", () => {
  const doc = ops.addPanels("x", [P("rc", { names: [] }, "run-compare")])(EMPTY_WORKSPACE);
  assert.equal(deriveLayout(doc, [])[0]!.panels[0]!.label, "Run Comparer");
});

test("metrics merge across runs; artifacts collapse per name; internal names dropped", async () => {
  const { mergeRunMetrics } = await import("./metrics.ts");
  const out = mergeRunMetrics([
    { runId: "a", sequences: [{ name: "loss", object_type: "scalar", count: 3 }, { name: "_cairn/x", object_type: "text", count: 1 }], artifactNames: ["model", "model", "loss"] },
    { runId: "b", sequences: [{ name: "loss", object_type: "scalar", count: 9 }], artifactNames: [] },
  ]);
  assert.deepEqual(out, [
    { name: "loss", object_type: "scalar", count: 9, runIds: ["a", "b"] },
    { name: "model", object_type: "artifact", count: 2, runIds: ["a"] },
  ]);
});

test("an edited automatic panel keeps its metric claimed (no duplicate id)", () => {
  const doc = ops.addPanels("Charts", [P("auto:loss", { names: ["loss", "val.loss"] })])(EMPTY_WORKSPACE);
  const ids = deriveLayout(doc, METRICS).flatMap((s) => s.panels.map((p) => p.panel.id));
  assert.equal(ids.filter((i) => i === "auto:loss").length, 1);
});

test("autoPanels off renders only listed panels; hidden panels render nowhere but still claim", () => {
  const doc = ops.seq(
    ops.addPanels("val", [P("mine", { names: ["val.loss"] })]),
    ops.addPanels("val", [P("h", { names: ["train.loss"] })]),
    ops.setPanelHidden("h", true),
  )(EMPTY_WORKSPACE);
  assert.deepEqual(shape(deriveLayout(doc, METRICS)), [
    "val:mine",
    "Charts*:auto:loss",
    "train*:auto:train.acc",
    "Media*:auto:samples",
    "system*:auto:system.cpu",
  ]);
  assert.deepEqual(shape(deriveLayout(ops.setAutoPanels(false)(doc), METRICS)), ["val:mine"]);
});

test("autoPanelsOp off materializes what is shown, so nothing disappears; later metrics stay out", () => {
  const doc = ops.seq(ops.addPanels("val", [P("mine", { names: ["val.loss"] })]), ops.addHidePattern("cpu"))(EMPTY_WORKSPACE);
  const before = deriveLayout(doc, METRICS);
  const off = autoPanelsOp(false, before)(doc);
  assert.equal(off.autoPanels, false);
  assert.deepEqual(shape(deriveLayout(off, METRICS)), shape(before).map((s) => s.replace("*", "")));
  // system.cpu was not shown (hide pattern): it stays out, like a metric logged later.
  assert.ok(!off.sections.some((s) => s.panels.some((p) => p.id === "auto:system.cpu")));
  const later = [...METRICS, M("val.new"), M("brand.new")];
  assert.deepEqual(shape(deriveLayout(off, later)), shape(deriveLayout(off, METRICS)));
  // Back on: the new metrics come back as automatic panels.
  const on = autoPanelsOp(true, [])(off);
  assert.ok(shape(deriveLayout(on, later)).some((s) => s.includes("auto:val.new")));
  assert.ok(shape(deriveLayout(on, later)).some((s) => s.includes("auto:brand.new")));
});

// --- adding cards to a section ---------------------------------------------------

const SM = [M("train.loss"), M("train.acc"), M("val.loss"), M("val.acc"), M("lr"), M("samples", "image")];

test("unique section names", () => {
  assert.equal(uniqueSectionName("New section", ["a"]), "New section");
  assert.equal(uniqueSectionName("New section", ["New section", "New section 2"]), "New section 3");
});

test("adding to a section puts the cards after its automatic ones; other sections keep their place", () => {
  const doc = ops.addPanels("mine", [P("m", { names: ["lr"] })])(EMPTY_WORKSPACE);
  const secs = deriveLayout(doc, SM);
  assert.deepEqual(shape(secs), ["mine:m", "train*:auto:train.acc,auto:train.loss", "val*:auto:val.acc,auto:val.loss", "Media*:auto:samples"]);
  const next = addToSectionOp(secs, "val", [P("new", { names: ["train.loss", "val.loss"] })])(doc);
  assert.deepEqual(shape(deriveLayout(next, SM)), [
    "mine:m",
    "train:auto:train.acc,auto:train.loss",
    "val:auto:val.acc,auto:val.loss,new",
    "Media:auto:samples",
  ]);
  // A brand-new (empty) section of the document.
  const withNew = ops.addSection("New section")(doc);
  const added = addToSectionOp(deriveLayout(withNew, SM), "New section", [P("n", { names: ["lr"] })])(withNew);
  assert.deepEqual(shape(deriveLayout(added, SM)).slice(0, 2), ["mine:m", "New section:n"]);
});
