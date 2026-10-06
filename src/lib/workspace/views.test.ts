import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceViewDoc, WorkspaceViews } from "../../api/types.ts";
import { EMPTY_WORKSPACE, ops } from "./doc.ts";
import {
  canDeleteView,
  duplicateName,
  EMPTY_VIEW_LAYOUT,
  layoutPayload,
  viewAfterDelete,
  viewLayout,
  viewSummary,
  withAdded,
  withCurrent,
  withRemoved,
  withRenamed,
} from "./views.ts";

const V = (id: string, name = id): WorkspaceViewDoc => ({
  id,
  name,
  rev: 1,
  created_at: "t",
  updated_at: "t",
  payload: {},
});
const LIST: WorkspaceViews = { views: [V("a", "Default"), V("b", "Media"), V("c", "Losses")], current: "b" };

test("a view's layout comes from its payload; a first view not stored yet is empty", () => {
  assert.deepEqual(viewLayout(null), EMPTY_VIEW_LAYOUT);
  const layout = viewLayout({ autoPanels: false, hidePatterns: ["^x"], runs: { ids: ["r"] } });
  assert.equal(layout.autoPanels, false);
  assert.deepEqual(layout.hidePatterns, ["^x"]);
  assert.equal("runs" in layout, false);
});

test("a view stores the layout only, never a comparison's runs", () => {
  const doc = { ...ops.addHidePattern("sys")(EMPTY_WORKSPACE), runs: { ids: ["r1"], selector: null, view: { hidden: [], pinned: [], baseline: null } } };
  const payload = layoutPayload(doc);
  assert.equal("runs" in payload, false);
  assert.deepEqual(payload.hidePatterns, ["sys"]);
});

test("the empty view lists nothing and includes unlisted metrics", () => {
  assert.deepEqual(EMPTY_VIEW_LAYOUT.sections, []);
  assert.equal(EMPTY_VIEW_LAYOUT.autoPanels, true);
});

test("names, delete rules and the tile summary", () => {
  assert.equal(duplicateName("Media review"), "Media review copy");
  assert.equal(canDeleteView([V("a")]), false);
  assert.equal(canDeleteView([V("a"), V("b")]), true);
  assert.equal(viewAfterDelete(LIST.views, "a"), "b");
  assert.equal(viewAfterDelete(LIST.views, "b"), "a");
  assert.equal(viewAfterDelete([V("a")], "a"), null);
  assert.equal(viewSummary(14, true), "14 cards · unlisted on");
  assert.equal(viewSummary(9, false), "9 cards · listed only");
  assert.equal(viewSummary(1, true), "1 card · unlisted on");
});

test("list ops: switch, rename, add (last), remove", () => {
  assert.equal(withCurrent(LIST, "c").current, "c");
  assert.equal(withCurrent(LIST, "b"), LIST);
  assert.deepEqual(withRenamed(LIST, "c", "Curves").views.map((v) => v.name), ["Default", "Media", "Curves"]);
  assert.deepEqual(withAdded(LIST, V("d")).views.map((v) => v.id), ["a", "b", "c", "d"]);
  // Removing another view keeps the current one.
  assert.deepEqual(withRemoved(LIST, "a"), { views: [LIST.views[1], LIST.views[2]], current: "b" });
  // Removing the current view makes the first remaining one current.
  assert.deepEqual(withRemoved(LIST, "b"), { views: [LIST.views[0], LIST.views[2]], current: "a" });
  // The last view stays; an unknown id changes nothing.
  const one: WorkspaceViews = { views: [V("a")], current: "a" };
  assert.equal(withRemoved(one, "a"), one);
  assert.equal(withRemoved(LIST, "zz"), LIST);
});
