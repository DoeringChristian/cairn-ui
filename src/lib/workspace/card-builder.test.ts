import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import { deriveLayout, type MetricInfo } from "./layout.ts";
import {
  cardCatalogue,
  compatibleTypes,
  dataLabel,
  dataMetrics,
  defaultTitle,
  multiRunSeries,
  panelData,
  regexMatches,
  seedPanel,
  seriesCatalogue,
  seriesShownBy,
} from "./card-builder.ts";

const M = (name: string, object_type = "scalar", runIds = ["r1"]): MetricInfo => ({ name, object_type, count: 5, runIds });
const METRICS = [M("loss"), M("train.loss"), M("val.loss"), M("val.acc"), M("samples", "image"), M("hist", "histogram")];
const types = (r: ReturnType<typeof compatibleTypes>) => r.options.map((o) => `${o.type}${o.unavailable ? `(${o.unavailable})` : ""}`);

test("a scalar offers the line chart, value, bar and the run-level cards; too few runs say why", () => {
  const one = compatibleTypes({ mode: "series", names: ["loss"] }, METRICS, 1);
  assert.deepEqual(types(one), ["scalar", "tile", "bar", "scatter(needs 2+ runs)", "parallel(needs 2+ runs)", "importance(needs 2+ runs)"]);
  const three = compatibleTypes({ mode: "series", names: ["loss"] }, METRICS, 3);
  assert.deepEqual(types(three), ["scalar", "tile", "bar", "scatter", "parallel", "importance"]);
});

test("several scalars: one-series cards are marked; scatter takes two", () => {
  const two = compatibleTypes({ mode: "series", names: ["loss", "val.acc"] }, METRICS, 2);
  assert.deepEqual(types(two), ["scalar", "tile(shows one series)", "bar(shows one series)", "scatter", "parallel", "importance(shows one series)"]);
});

test("media and single-series kinds offer their own card; mixed kinds offer nothing", () => {
  assert.deepEqual(types(compatibleTypes({ mode: "series", names: ["samples"] }, METRICS, 1)), ["image"]);
  assert.deepEqual(types(compatibleTypes({ mode: "series", names: ["hist"] }, METRICS, 1)), ["histogram"]);
  const mixed = compatibleTypes({ mode: "series", names: ["loss", "samples"] }, METRICS, 1);
  assert.deepEqual(mixed.options, []);
  assert.match(mixed.reason!, /different kinds/);
});

test("regex data offers the per-metric card of its matches' kind; whole runs offer run-level cards", () => {
  assert.deepEqual(types(compatibleTypes({ mode: "regex", regex: "val\\..*" }, METRICS, 1)), ["scalar"]);
  assert.deepEqual(compatibleTypes({ mode: "regex", regex: "(" }, METRICS, 1).options, []);
  assert.equal(types(compatibleTypes({ mode: "runs" }, METRICS, 1))[0], "run-compare(needs 2+ runs)");
});

test("an edited card keeps its type on offer even when its data is not logged", () => {
  const r = compatibleTypes({ mode: "series", names: ["gone"] }, METRICS, 1, "image");
  assert.deepEqual(types(r), ["image"]);
});

test("regex matches are anchored and sorted; invalid regexes say so", () => {
  const r = regexMatches("val\\..*", METRICS);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.matches.map((m) => m.name), ["val.acc", "val.loss"]);
  assert.equal(regexMatches("loss", METRICS).ok && (regexMatches("loss", METRICS) as { matches: MetricInfo[] }).matches.length, 1);
  assert.equal(regexMatches("(", METRICS).ok, false);
  assert.deepEqual(dataMetrics({ mode: "series", names: ["loss", "nope"] }, METRICS).map((m) => m.name), ["loss"]);
});

test("seeding: per-metric cards take the selector; multi-run cards read the series through last(...)", () => {
  assert.deepEqual(seedPanel("scalar", { mode: "series", names: ["loss"] }), { selector: { names: ["loss"] }, settings: {} });
  assert.deepEqual(seedPanel("image", { mode: "regex", regex: " s.* " }, { fit: "cover" }), { selector: { regex: "s.*" }, settings: { fit: "cover" } });
  assert.deepEqual(seedPanel("tile", { mode: "series", names: ["train/loss"] }, { reduce: "mean" }), {
    selector: { names: [] },
    settings: { reduce: "mean", metric: { src: "last(`train/loss`)" } },
  });
  assert.deepEqual(seedPanel("scatter", { mode: "series", names: ["a", "b"] }).settings, { x: { src: "last(a)" }, y: { src: "last(b)" } });
  assert.deepEqual(seedPanel("parallel", { mode: "series", names: ["a", "val.b"] }).settings, { columns: [{ src: "last(a)" }, { src: "last(val.b)" }] });
  assert.deepEqual(seedPanel("run-compare", { mode: "runs" }), { selector: { names: [] }, settings: {} });
  // Settings that already read the data keep their expression; other data re-seeds.
  const own = { metric: { src: "min(loss)" } };
  assert.equal(seedPanel("bar", { mode: "series", names: ["loss"] }, own).settings, own);
  assert.deepEqual(seedPanel("bar", { mode: "series", names: ["acc"] }, own).settings, { metric: { src: "last(acc)" } });
});

test("panelData reads a panel back into builder data", () => {
  const tile: Panel = { id: "t", type: "tile", selector: { names: [] }, settings: seedPanel("tile", { mode: "series", names: ["val.loss"] }).settings };
  assert.deepEqual(panelData(tile), { mode: "series", names: ["val.loss"] });
  assert.deepEqual(panelData({ type: "run-compare", selector: { names: [] }, settings: {} }), { mode: "runs" });
  assert.deepEqual(panelData({ type: "scalar", selector: { regex: "x.*" }, settings: {} }), { mode: "regex", regex: "x.*" });
  assert.deepEqual(multiRunSeries("bar", { metric: { src: "min(a) / max(`b/c`)" } }), ["a", "b/c"]);
  assert.deepEqual(multiRunSeries("bar", { metric: { src: "((" } }), []);
});

test("labels and default titles", () => {
  assert.equal(dataLabel({ mode: "series", names: ["a", "b", "c"] }), "a + 2 more");
  assert.equal(dataLabel({ mode: "regex", regex: "x" }), "/x/");
  assert.equal(defaultTitle("tile", { mode: "series", names: ["loss"] }), "loss · Value");
  assert.equal(defaultTitle("scalar", { mode: "series", names: ["loss"] }), "");
});

test("the series catalogue groups by automatic section and lists the cards showing each series", () => {
  const doc = ops.seq(
    ops.addPanels("Mine", [
      { id: "v", type: "tile", selector: { names: [] }, settings: { metric: { src: "last(loss)" }, title: "Loss value" } },
      { id: "l2", type: "scalar", selector: { names: ["loss"] }, settings: { title: "Loss again" } },
    ]),
  )(EMPTY_WORKSPACE);
  const shown = seriesShownBy(deriveLayout(doc, METRICS));
  assert.deepEqual(shown.get("loss"), ["Loss value (Value)", "Loss again (Line chart)"]);
  assert.deepEqual(shown.get("samples"), ["samples (Image)"]);
  const cat = seriesCatalogue(METRICS, shown);
  assert.deepEqual(cat.map((g) => `${g.name}:${g.items.map((i) => i.name).join(",")}`), [
    "Charts:loss",
    "train:train.loss",
    "val:val.acc,val.loss",
    "Media:hist,samples",
  ]);
  assert.deepEqual(seriesCatalogue(METRICS, shown, "VAL").map((g) => g.name), ["val"]);
});

test("the card catalogue lists listed, hidden, automatic, removed and unlisted cards", () => {
  const base = ops.seq(
    ops.addPanels("Mine", [{ id: "a", type: "scalar", selector: { names: ["loss"] }, settings: {} }]),
    ops.addPanels("Mine", [{ id: "b", type: "scalar", selector: { names: ["val.acc"] }, settings: {} }]),
    ops.setPanelHidden("b", true),
    ops.removePanel("auto:hist", "hist"),
    ops.addHidePattern("train"),
  )(EMPTY_WORKSPACE);
  const st = (d: typeof base) => cardCatalogue(d, METRICS).map((e) => `${e.status}:${e.panel.id}${e.patternHidden ? "!" : ""}`);
  assert.deepEqual(st(base), ["listed:a", "hidden:b", "auto:auto:train.loss!", "auto:auto:val.loss", "auto:auto:samples", "removed:auto:hist"]);
  const off = ops.setAutoPanels(false)(base);
  assert.deepEqual(st(off), ["listed:a", "hidden:b", "unlisted:auto:train.loss!", "unlisted:auto:val.loss", "unlisted:auto:samples", "removed:auto:hist"]);
});
