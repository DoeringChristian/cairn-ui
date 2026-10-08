import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_RUN_STATE,
  DEFAULT_RUN_STATE,
  DEFAULT_VIEW_RUN_STATE,
  editGroup,
  editProject,
  groupRunState,
  parseRunState,
  parseViewRunState,
  projectRunState,
  setEyes,
  setSearch,
} from "./state.ts";

test("parseRunState: the toolbar and the eyes; what does not parse takes its default", () => {
  assert.equal(parseRunState(null), DEFAULT_RUN_STATE);
  assert.equal(parseRunState([1]), DEFAULT_RUN_STATE);
  const s = parseRunState({
    status: "failed",
    search: "train",
    groupBy: [{ source: "param", key: "lr" }, { source: "bogus" }],
    latestOnly: true,
    sort: [{ column: "values.loss", direction: "asc" }, { column: "", direction: "asc" }, { column: "x", direction: "up" }],
    eyes: { "r:a": false, "g:group:exp": true, bad: 1 },
    hiddenNames: { exp: ["n:train"] },
  });
  assert.deepEqual(s, {
    status: "failed",
    search: "train",
    filter: DEFAULT_RUN_STATE.filter,
    groupBy: [{ source: "param", key: "lr" }],
    latestOnly: true,
    sort: [{ column: "values.loss", direction: "asc" }],
    eyes: { "r:a": false, "g:group:exp": true },
  });
  const bad = parseRunState({ status: "nope", search: 3, groupBy: "x", latestOnly: "yes", eyes: [] });
  assert.deepEqual(bad, DEFAULT_RUN_STATE);
});

test("setEyes: set several, or back to their default", () => {
  const s = setEyes(DEFAULT_RUN_STATE, ["r:a", "r:b"], false);
  assert.deepEqual(s.eyes, { "r:a": false, "r:b": false });
  assert.deepEqual(setEyes(s, ["r:a"], null).eyes, { "r:b": false });
  assert.equal(setEyes(s, [], true), s);
});

test("parseRunState: no valid sort key keeps the default sort (created, newest first)", () => {
  assert.deepEqual(parseRunState({ sort: [] }).sort, [{ column: "created_at", direction: "desc" }]);
  assert.deepEqual(parseRunState({ sort: "name" }).sort, DEFAULT_RUN_STATE.sort);
});

test("parseViewRunState: per-group states parse with the group default (not grouped)", () => {
  assert.equal(parseViewRunState(undefined), DEFAULT_VIEW_RUN_STATE);
  const v = parseViewRunState({
    search: "x",
    groups: { "exp-44": { search: "train", eyes: { "r:a": false } }, "exp-43": {}, bad: 3 },
  });
  assert.equal(v.search, "x");
  assert.deepEqual(Object.keys(v.groups).sort(), ["exp-43", "exp-44"]);
  assert.deepEqual(v.groups["exp-44"], { ...DEFAULT_GROUP_RUN_STATE, search: "train", eyes: { "r:a": false } });
  assert.deepEqual(v.groups["exp-43"]!.groupBy, []);
  // A group's own group-by survives.
  assert.deepEqual(parseViewRunState({ groups: { g: { groupBy: [{ source: "group" }] } } }).groups.g!.groupBy, [{ source: "group" }]);
});

test("editProject / editGroup: each edits its own part of the view's run state", () => {
  const v0 = parseViewRunState({ search: "p", groups: { a: { search: "ga" } } });
  const v1 = editGroup("b", (s) => setSearch(s, "gb"))(v0);
  assert.equal(v1.search, "p");
  assert.equal(groupRunState(v1, "a").search, "ga");
  assert.deepEqual(groupRunState(v1, "b"), { ...DEFAULT_GROUP_RUN_STATE, search: "gb" });
  const v2 = editProject((s) => setSearch(s, "q"))(v1);
  assert.equal(v2.search, "q");
  assert.equal(v2.groups, v1.groups);
  assert.equal("groups" in projectRunState(v2), false);
  // A group without its own state reads the default.
  assert.equal(groupRunState(v0, "none"), DEFAULT_GROUP_RUN_STATE);
});
