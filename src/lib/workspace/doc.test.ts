import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORKSPACE,
  changedFields,
  findPanel,
  normalizeWorkspace,
  ops,
  rebase,
  restoreFields,
  type Panel,
  type WorkspaceDoc,
} from "./doc.ts";

const P = (id: string, names: string[], type: Panel["type"] = "scalar"): Panel => ({ id, type, selector: { names }, settings: {} });
const names = (d: WorkspaceDoc) => d.sections.map((s) => `${s.name}:${s.panels.map((p) => p.id).join(",")}`);

test("normalize fills a null or partial payload and drops malformed entries", () => {
  assert.deepEqual(normalizeWorkspace(null), EMPTY_WORKSPACE);
  const d = normalizeWorkspace({
    sections: [
      { id: "s1", name: "a", panels: [P("p1", ["x"]), { id: "bad" }, { id: "p2", type: "nope", selector: { names: [] } }] },
      { id: "s2", name: "a", panels: [] },
      { id: "s3", name: "b", collapsed: true, panels: [{ id: "p1", type: "scalar", selector: { regex: "y" } }] },
    ],
    removed: ["m", "m", 3],
    defaults: { scalar: { smoothing: 0.5 }, bar: 3 },
    prefs: { syncZoom: true },
    runs: { ids: ["r1", "r1"], selector: { kind: "bogus" } },
  });
  assert.deepEqual(names(d), ["a:p1", "b:"]);
  assert.equal(d.sections[1]!.collapsed, true);
  assert.deepEqual(d.removed, ["m"]);
  assert.deepEqual(d.defaults, { scalar: { smoothing: 0.5 } });
  assert.deepEqual(d.prefs, { syncZoom: true, syncCursor: true, colorBy: null });
  assert.deepEqual(d.runs, { ids: ["r1"], selector: null, view: { hidden: [], pinned: [], baseline: null } });
});

test("ensureSections inserts missing sections in rendered order", () => {
  const a = ops.addSection("train")(EMPTY_WORKSPACE);
  const b = ops.ensureSections(["Charts", "train", "val", "Media"])(a);
  assert.deepEqual(b.sections.map((s) => s.name), ["Charts", "train", "val", "Media"]);
  assert.equal(ops.ensureSections(["train"])(a), a);
});

test("section ops: rename carries defaults, move, collapse, sort, remove only empty", () => {
  let d = ops.seq(ops.addSection("a"), ops.addSection("b"), ops.setSectionDefaults("a", "scalar", { smoothing: 0.2 }))(EMPTY_WORKSPACE);
  d = ops.renameSection("a", "alpha")(d);
  assert.deepEqual(d.sections.map((s) => s.name), ["alpha", "b"]);
  assert.deepEqual(d.sectionDefaults, { alpha: { scalar: { smoothing: 0.2 } } });
  assert.equal(ops.renameSection("alpha", "b")(d), d, "taking another section's name is a no-op");
  d = ops.moveSection("b", -1)(d);
  assert.deepEqual(d.sections.map((s) => s.name), ["b", "alpha"]);
  d = ops.seq(ops.setSectionCollapsed("b", true), ops.setSectionSorted("alpha", true))(d);
  assert.equal(d.sections[0]!.collapsed, true);
  assert.equal(d.sections[1]!.sort, true);
  d = ops.addPanels("b", [P("p", ["x"])])(d);
  assert.equal(ops.removeSection("b")(d), d);
  assert.deepEqual(ops.removeSection("alpha")(d).sections.map((s) => s.name), ["b"]);
});

test("addPanels is idempotent per id and un-removes the claimed metric", () => {
  let d = ops.removePanel("auto:x", "x")(EMPTY_WORKSPACE);
  assert.deepEqual(d.removed, ["x"]);
  d = ops.addPanels("Charts", [P("auto:x", ["x"]), P("auto:y", ["y"])])(d);
  assert.deepEqual(names(d), ["Charts:auto:x,auto:y"]);
  assert.deepEqual(d.removed, []);
  assert.equal(ops.addPanels("Charts", [P("auto:x", ["x"])])(d), d);
  d = ops.addPanels("Charts", [P("n", ["z"])], 0)(d);
  assert.deepEqual(names(d), ["Charts:n,auto:x,auto:y"]);
});

test("removePanel records the claimed metric; multi-metric panels claim nothing", () => {
  let d = ops.addPanels("s", [P("a", ["x"]), P("b", ["x", "y"])])(EMPTY_WORKSPACE);
  d = ops.removePanel("b", null)(d);
  assert.deepEqual(d.removed, []);
  d = ops.removePanel("a", "x")(d);
  assert.deepEqual(d.removed, ["x"]);
  assert.deepEqual(names(d), ["s:"]);
  assert.deepEqual(ops.restoreRemoved(["x"])(d).removed, []);
});

test("panel settings, type, selector, and moves between sections", () => {
  let d = ops.seq(ops.addPanels("a", [P("1", ["x"]), P("2", ["y"])]), ops.addPanels("b", [P("3", ["z"])]))(EMPTY_WORKSPACE);
  d = ops.setPanelSettings("1", { height: 400 })(d);
  d = ops.setPanelType("2", "bar")(d);
  d = ops.setPanelSelector("3", { regex: "val/.*" })(d);
  assert.deepEqual(findPanel(d, "1")?.panel.settings, { height: 400 });
  assert.equal(findPanel(d, "2")?.panel.type, "bar");
  assert.deepEqual(findPanel(d, "3")?.panel.selector, { regex: "val/.*" });
  d = ops.movePanel("1", "b", "3")(d);
  assert.deepEqual(names(d), ["a:2", "b:1,3"]);
  d = ops.movePanel("2", "c", null)(d);
  assert.deepEqual(names(d), ["a:", "b:1,3", "c:2"]);
  assert.equal(ops.movePanel("nope", "a", null)(d), d);
});

test("section defaults: empty values remove the type and the section", () => {
  const a = ops.setSectionDefaults("val", "scalar", { smoothing: 0.3 })(EMPTY_WORKSPACE);
  assert.deepEqual(a.sectionDefaults, { val: { scalar: { smoothing: 0.3 } } });
  assert.deepEqual(ops.setSectionDefaults("val", "scalar", {})(a).sectionDefaults, {});
  const c = ops.setDefaults("scalar", { yScale: "log" })(EMPTY_WORKSPACE);
  assert.deepEqual(ops.setDefaults("scalar", {})(c).defaults, {});
});

test("run ops touch comparisons only", () => {
  assert.equal(ops.addRuns(["r"])(EMPTY_WORKSPACE), EMPTY_WORKSPACE);
  const c = normalizeWorkspace({ runs: { ids: ["a"] } });
  assert.deepEqual(ops.addRuns(["a", "b"])(c).runs!.ids, ["a", "b"]);
  assert.deepEqual(ops.removeRun("a")(c).runs!.ids, []);
});

test("rebase replays pending ops onto the server document", () => {
  const server = ops.addPanels("remote", [P("r", ["x"])])(EMPTY_WORKSPACE);
  const pending = [ops.addPanels("local", [P("l", ["y"])]), ops.setPrefs({ syncZoom: true })];
  const d = rebase(server, pending);
  assert.deepEqual(names(d), ["remote:r", "local:l"]);
  assert.equal(d.prefs.syncZoom, true);
  assert.deepEqual(rebase(server, []), server);
});

test("undo restores only the fields an op changed", () => {
  const before = EMPTY_WORKSPACE;
  const after = ops.removePanel("auto:x", "x")(before);
  const fields = changedFields(before, after);
  assert.deepEqual(fields, ["removed"]);
  const current = ops.addSection("val")(after); // another tab
  const undone = restoreFields(before, fields)(current);
  assert.deepEqual(undone.removed, []);
  assert.deepEqual(undone.sections.map((s) => s.name), ["val"]);
});

test("saved views round-trip the layout and keep the run set", async () => {
  const { viewPayload, parseViewPayload } = await import("./views.ts");
  const doc = ops.addPanels("a", [P("1", ["x"])])(normalizeWorkspace({ runs: { ids: ["r1"] } }));
  const p = JSON.parse(JSON.stringify(viewPayload(doc)));
  assert.equal("runs" in p.layout, false);
  const layout = parseViewPayload(p);
  const other = normalizeWorkspace({ runs: { ids: ["r2"] } });
  const applied = ops.replaceLayout(layout)(other);
  assert.deepEqual(names(applied), ["a:1"]);
  assert.deepEqual(applied.runs!.ids, ["r2"]);
});

test("prefs.colorBy: null by default, clamped and defaulted when set", () => {
  assert.equal(normalizeWorkspace({}).prefs.colorBy, null);
  assert.deepEqual(normalizeWorkspace({ prefs: { colorBy: { expr: "config.lr", buckets: 20, palette: "nope" } } }).prefs.colorBy, {
    expr: "config.lr",
    buckets: 8,
    palette: "turbo",
  });
});
