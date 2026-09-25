import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORKSPACE,
  changedFields,
  normalizeWorkspace,
  ops,
  rebase,
  restoreFields,
} from "./doc.ts";

test("normalize fills a null or partial payload", () => {
  assert.deepEqual(normalizeWorkspace(null), EMPTY_WORKSPACE);
  const d = normalizeWorkspace({ hiddenCards: ["a", 3], sections: { pinned: ["x"] }, prefs: { syncZoom: true } });
  assert.deepEqual(d.hiddenCards, ["a"]);
  assert.deepEqual(d.sections, { pinned: ["x"], sort: [] });
  assert.deepEqual(d.prefs, { syncZoom: true, syncCursor: true, colorBy: null });
});

test("normalize drops malformed custom panels and defaults", () => {
  const d = normalizeWorkspace({
    customPanels: [{ id: "1", title: "t", type: "scalar", metrics: ["a"] }, { id: 2 }],
    defaults: { scalar: { smoothing: 0.5 }, bar: 3 },
  });
  assert.equal(d.customPanels.length, 1);
  assert.deepEqual(d.defaults, { scalar: { smoothing: 0.5 } });
});

test("ops patch without mutating", () => {
  const a = ops.hideCards(["x", "y"])(EMPTY_WORKSPACE);
  assert.deepEqual(a.hiddenCards, ["x", "y"]);
  assert.deepEqual(EMPTY_WORKSPACE.hiddenCards, []);
  assert.deepEqual(ops.hideCards(["y", "z"])(a).hiddenCards, ["x", "y", "z"]);
  assert.deepEqual(ops.showCards(["x"])(a).hiddenCards, ["y"]);
  const p = ops.togglePinned("val")(EMPTY_WORKSPACE);
  assert.deepEqual(p.sections.pinned, ["val"]);
  assert.deepEqual(ops.togglePinned("val")(p).sections.pinned, []);
});

test("section defaults: empty values remove the type and the section", () => {
  const a = ops.setSectionDefaults("val", "scalar", { smoothing: 0.3 })(EMPTY_WORKSPACE);
  assert.deepEqual(a.sectionDefaults, { val: { scalar: { smoothing: 0.3 } } });
  const b = ops.setSectionDefaults("val", "scalar", {})(a);
  assert.deepEqual(b.sectionDefaults, {});
  const c = ops.setDefaults("scalar", { yScale: "log" })(EMPTY_WORKSPACE);
  assert.deepEqual(ops.setDefaults("scalar", {})(c).defaults, {});
});

test("rebase replays pending ops onto the server document", () => {
  const server = ops.hideCards(["remote"])(ops.togglePinned("train")(EMPTY_WORKSPACE));
  const pending = [ops.hideCards(["local"]), ops.setPrefs({ syncZoom: true })];
  const d = rebase(server, pending);
  assert.deepEqual(d.hiddenCards, ["remote", "local"]);
  assert.deepEqual(d.sections.pinned, ["train"]);
  assert.equal(d.prefs.syncZoom, true);
  assert.deepEqual(rebase(server, []), server);
});

test("undo restores only the fields an op changed", () => {
  const before = EMPTY_WORKSPACE;
  const after = ops.hideCards(["x"])(before);
  const fields = changedFields(before, after);
  assert.deepEqual(fields, ["hiddenCards"]);
  // Another tab pinned a section meanwhile: undo keeps it.
  const current = ops.togglePinned("val")(after);
  const undone = restoreFields(before, fields)(current);
  assert.deepEqual(undone.hiddenCards, []);
  assert.deepEqual(undone.sections.pinned, ["val"]);
});

test("saved views round-trip the doc and the run layout", async () => {
  const { viewPayload, parseViewPayload } = await import("./views.ts");
  const doc = ops.togglePinned("val")(ops.hideCards(["x"])(EMPTY_WORKSPACE));
  const layout = { version: 1 as const, sectionOrder: ["val"], cardSection: {}, sectionOrderOfCards: { val: ["val.b"] } };
  const p = viewPayload(doc, layout);
  assert.equal("version" in p.workspace, false);
  const back = parseViewPayload(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(back.workspace, doc);
  assert.deepEqual(back.runLayout, layout);
  assert.equal(parseViewPayload({ workspace: doc }).runLayout, null);
});

test("prefs.colorBy: null by default, clamped and defaulted when set", () => {
  assert.equal(normalizeWorkspace({}).prefs.colorBy, null);
  assert.equal(normalizeWorkspace({ prefs: { colorBy: { expr: "  " } } }).prefs.colorBy, null);
  assert.deepEqual(normalizeWorkspace({ prefs: { colorBy: { expr: "config.lr", buckets: 20, palette: "nope" } } }).prefs.colorBy, {
    expr: "config.lr",
    buckets: 8,
    palette: "turbo",
  });
  assert.deepEqual(normalizeWorkspace({ prefs: { colorBy: { expr: "run.group", buckets: 1, palette: "magma" } } }).prefs.colorBy, {
    expr: "run.group",
    buckets: 2,
    palette: "magma",
  });
});
