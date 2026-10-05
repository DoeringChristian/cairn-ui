import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import { deriveLayout, type MetricInfo } from "./layout.ts";
import {
  captureGroups,
  cardCatalogue,
  compatibleTypes,
  dataLabel,
  dataMetrics,
  dataReady,
  defaultTitle,
  multiRunSeries,
  newCards,
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
  assert.equal(dataLabel({ mode: "series", names: ["a", "b", "c"] }, METRICS), "a + 2 more");
  assert.equal(dataLabel({ mode: "regex", regex: "x" }, METRICS), "/x/");
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

// --- custom viewers ----------------------------------------------------------

import type { ViewerInfo } from "../../api/types.ts";
import { optionKey, optionLabel, parseOptionKey } from "./card-builder.ts";

const viewer = (o: Partial<ViewerInfo>): ViewerInfo => ({
  name: "v", title: "V", entry: "index.js", accepts: [], inputs: "single", webgl: false, view: false, settings: [],
  imports: {}, dev: false, version_id: "id", version: 1, digest: "d", content_digest: "c", updated_at: "", error: null, ...o,
});
const CUSTOM: MetricInfo[] = [
  { name: "guide", object_type: "custom", kind: "guiding/vmf", count: 5, runIds: ["r1"] },
  { name: "field", object_type: "custom", kind: "field/2d", count: 5, runIds: ["r1"] },
  { name: "vol", object_type: "volume", count: 5, runIds: ["r1"] },
];
const VIEWERS = [
  viewer({ name: "vmf", title: "Guiding", accepts: ["custom:guiding/*"], icon: "globe" }),
  viewer({ name: "any", title: "Any custom", accepts: ["custom:*"] }),
  viewer({ name: "ray", title: "Raymarcher", accepts: ["volume"], dev: true, version: null, version_id: null }),
  viewer({ name: "broken", title: "Broken", accepts: ["custom:guiding/vmf"], dev: true, error: "bad manifest" }),
];

test("custom data: every accepting viewer is an option, the most specific first", () => {
  const r = compatibleTypes({ mode: "series", names: ["guide"] }, CUSTOM, 1, null, VIEWERS);
  assert.deepEqual(r.options.map((o) => o.key), ["custom:broken", "custom:vmf", "custom:any"]);
  assert.equal(r.options[0]!.unavailable, "the viewer is broken: bad manifest");
  assert.deepEqual(r.options[1]!.seed, { viewer: "vmf" });
  assert.equal(r.options[1]!.label, "Guiding");
  assert.equal(r.options[1]!.icon, "globe");
  assert.equal(r.options[2]!.icon, undefined);
  assert.equal(r.reason, null);
});

test("several custom series: viewers that accept them all", () => {
  const r = compatibleTypes({ mode: "series", names: ["guide", "field"] }, CUSTOM, 1, null, VIEWERS);
  assert.deepEqual(r.options.map((o) => o.key), ["custom:any"]);
});

test("a built-in kind: its own card, then the viewers taking it over", () => {
  const r = compatibleTypes({ mode: "series", names: ["vol"] }, CUSTOM, 1, null, VIEWERS);
  assert.deepEqual(r.options.map((o) => o.key), ["volume", "custom:ray"]);
  assert.match(r.options[1]!.hint, /live dev source/);
});

test("custom data no viewer accepts: the reason says how to add one", () => {
  const r = compatibleTypes({ mode: "series", names: ["field"] }, CUSTOM, 1, null, [VIEWERS[0]!]);
  assert.deepEqual(r.options, []);
  assert.match(r.reason!, /No custom viewer accepts field\/2d yet/);
});

test("editing a custom card keeps its viewer option", () => {
  const r = compatibleTypes({ mode: "series", names: ["field"] }, CUSTOM, 1, "custom:gone", [VIEWERS[0]!]);
  assert.deepEqual(r.options.map((o) => o.key), ["custom:gone"]);
});

test("option keys", () => {
  assert.equal(optionKey("custom", { viewer: "vmf" }), "custom:vmf");
  assert.equal(optionKey("custom", {}), "custom");
  assert.equal(optionKey("image", { viewer: "x" }), "image");
  assert.deepEqual(parseOptionKey("custom:vmf"), { type: "custom", seed: { viewer: "vmf" } });
  assert.deepEqual(parseOptionKey("scalar"), { type: "scalar", seed: {} });
  assert.equal(optionLabel("custom:vmf", VIEWERS), "Guiding");
  assert.equal(optionLabel("custom:gone", VIEWERS), "gone");
  assert.equal(optionLabel("scalar"), "Line chart");
});

// --- the gear's editor ---------------------------------------------------------

import { changedPanel } from "./card-builder.ts";

test("changedPanel: new data keeps the settings; a default title follows", () => {
  const p = { type: "image" as const, selector: { names: ["samples"] }, settings: { height: 300, rendering: "smooth" } };
  assert.deepEqual(changedPanel(p, { data: { mode: "series", names: ["samples", "other"] } }), {
    type: "image", selector: { names: ["samples", "other"] }, settings: { height: 300, rendering: "smooth" },
  });
  assert.deepEqual(changedPanel(p, { data: { mode: "regex", regex: "sam.*" } }).selector, { regex: "sam.*" });
  const tile = { type: "tile" as const, selector: { names: [] }, settings: { title: "loss · Value", metric: { src: "last(loss)" } } };
  const moved = changedPanel(tile, { data: { mode: "series", names: ["acc"] } });
  assert.equal(moved.settings.title, "acc · Value");
  assert.deepEqual(moved.settings.metric, { src: "last(acc)" });
});

test("changedPanel: a new type keeps the frame, not the content", () => {
  const p = { type: "image" as const, selector: { names: ["guide"] }, settings: { title: "Mine", height: 400, rendering: "smooth" } };
  const c = changedPanel(p, { option: "custom:vmf" });
  assert.deepEqual(c, { type: "custom", selector: { names: ["guide"] }, settings: { title: "Mine", height: 400, viewer: "vmf" } });
  const other = changedPanel({ ...c, settings: { ...c.settings, viewer_version: 2, "vs:vmf:e": 1 } }, { option: "custom:ray" });
  assert.deepEqual(other.settings, { title: "Mine", height: 400, viewer: "ray", "vs:vmf:e": 1 }, "another viewer: settings kept, pin dropped");
  assert.deepEqual(changedPanel(p, { option: "image" }), { type: "image", selector: p.selector, settings: p.settings }, "the same option changes nothing");
});

test("changedPanel: title set and cleared", () => {
  const p = { type: "scalar" as const, selector: { names: ["loss"] }, settings: { title: "old" } };
  assert.equal(changedPanel(p, { title: " New " }).settings.title, "New");
  assert.equal("title" in changedPanel(p, { title: "" }).settings, false);
});

// --- groups (adding only) and new cards ---------------------------------------

const GM = [M("train.loss"), M("train.acc"), M("val.loss"), M("val.acc"), M("lr"), M("samples", "image")];

test("capture groups split matches into one card per distinct capture", () => {
  const r = captureGroups("val\\.(.*)", GM);
  assert.ok(r.ok);
  assert.deepEqual(r.groups, [
    { title: "acc", names: ["val.acc"] },
    { title: "loss", names: ["val.loss"] },
  ]);
});

test("metrics sharing a capture share a card; several groups join the title", () => {
  const r = captureGroups(".*\\.(loss|acc)", GM);
  assert.ok(r.ok);
  assert.deepEqual(r.groups, [
    { title: "acc", names: ["train.acc", "val.acc"] },
    { title: "loss", names: ["train.loss", "val.loss"] },
  ]);
  const two = captureGroups("(train|val)\\.(loss)", GM);
  assert.ok(two.ok);
  assert.deepEqual(two.groups.map((g) => g.title), ["train · loss", "val · loss"]);
});

test("no groups: every match on one card; the pattern is anchored; bad patterns say so", () => {
  const r = captureGroups("val\\..*", GM);
  assert.ok(r.ok);
  assert.deepEqual(r.groups, [{ title: "val\\..*", names: ["val.acc", "val.loss"] }]);
  const partial = captureGroups("loss", GM);
  assert.ok(partial.ok);
  assert.deepEqual(partial.groups, []);
  assert.equal(captureGroups("val\\.(", GM).ok, false);
  assert.equal(captureGroups("  ", GM).ok, false);
});

test("groups make one card per group and chosen type, titled by the captures", () => {
  const data = { mode: "groups", regex: "(train|val)\\.loss" } as const;
  assert.ok(dataReady(data, GM));
  assert.equal(dataLabel(data, GM), "/(train|val)\\.loss/ → 2 cards");
  const cards = newCards(data, ["scalar"], GM);
  assert.deepEqual(cards, [
    { type: "scalar", selector: { names: ["train.loss"] }, settings: { title: "train" } },
    { type: "scalar", selector: { names: ["val.loss"] }, settings: { title: "val" } },
  ]);
  // Two types: one card of each per group.
  assert.equal(newCards(data, ["scalar", "tile"], GM).length, 4);
  assert.equal(dataReady({ mode: "groups", regex: "nope\\.(.*)" }, GM), false);
});

test("groups offer the types every group's card can take", () => {
  // One series per group: the one-series cards are fine.
  const one = compatibleTypes({ mode: "groups", regex: "(train|val)\\.loss" }, GM, 3);
  assert.deepEqual(types(one), ["scalar", "tile", "bar", "scatter", "parallel", "importance"]);
  // Two series in a group: the one-series cards are not.
  const two = compatibleTypes({ mode: "groups", regex: ".*\\.(loss)" }, GM, 3);
  assert.deepEqual(types(two), ["scalar", "tile(shows one series)", "bar(shows one series)", "scatter", "parallel", "importance(shows one series)"]);
  // A group mixing kinds has no type.
  const mixed = compatibleTypes({ mode: "groups", regex: "(lr|samples)" }, GM, 1);
  assert.deepEqual(types(mixed), []);
  assert.equal(compatibleTypes({ mode: "groups", regex: "zz(.*)" }, GM, 1).reason, "No series of these runs matches (yet).");
});

test("plain data: one card per chosen type; multi-run cards are titled by their data", () => {
  const cards = newCards({ mode: "series", names: ["val.loss"] }, ["scalar", "tile"], GM);
  assert.deepEqual(cards[0], { type: "scalar", selector: { names: ["val.loss"] }, settings: {} });
  assert.equal(cards[1]!.type, "tile");
  assert.equal(cards[1]!.settings.title, "val.loss · Value");
  const custom = newCards({ mode: "series", names: ["samples"] }, ["custom:viewers/x"], GM);
  assert.deepEqual(custom, [{ type: "custom", selector: { names: ["samples"] }, settings: { viewer: "viewers/x" } }]);
});
