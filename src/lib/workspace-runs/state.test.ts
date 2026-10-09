import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RUN_STATE, parseRunState, setColumns, setEyes, setGroupBy, toggleGroupOpen } from "./state.ts";
import { regroup } from "./visibility.ts";

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
    toggled: [],
    columns: DEFAULT_RUN_STATE.columns,
    computed: [],
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


test("parseRunState: a stored per-group state (the removed group pages) is ignored", () => {
  const s = parseRunState({ search: "p", groups: { "exp-44": { search: "g" } } });
  assert.equal(s.search, "p");
  assert.equal("groups" in s, false);
});

test("default run state: not grouped (one line per run, as wandb's default workspace); a stored grouping is kept", () => {
  assert.deepEqual(DEFAULT_RUN_STATE.groupBy, []);
  assert.deepEqual(parseRunState({}).groupBy, []);
  assert.deepEqual(parseRunState({ groupBy: [{ source: "group" }] }).groupBy, [{ source: "group" }]);
});

test("parseRunState: the Runs page's columns and the toggled groups live in the view (malformed parts dropped)", () => {
  const s = parseRunState({
    toggled: ["0=a/", 3, "0=a/"],
    columns: { order: ["a", 1], hidden: ["b"], pinned: ["value:acc"], widths: { name: 420, "value:acc": 10, y: "wide" } },
    computed: [{ id: "c1", expr: "min(val.loss)", name: "best" }, { id: 3 }],
  });
  assert.deepEqual(s.toggled, ["0=a/"]);
  assert.deepEqual(s.columns, { order: ["a"], hidden: ["b"], pinned: ["value:acc"], widths: { name: 420, "value:acc": 60 } });
  assert.deepEqual(s.computed, [{ id: "c1", expr: "min(val.loss)", name: "best" }]);
  assert.deepEqual(parseRunState({ columns: "x", computed: {} }).columns, { order: [], hidden: [], pinned: [], widths: {} });
});

test("toggled groups: flipped one at a time, cleared by a new group-by (they belong to the old grouping)", () => {
  let s = toggleGroupOpen(DEFAULT_RUN_STATE, "0=a/");
  s = toggleGroupOpen(s, "0=b/");
  assert.deepEqual(s.toggled, ["0=a/", "0=b/"]);
  assert.deepEqual(toggleGroupOpen(s, "0=a/").toggled, ["0=b/"]);
  assert.deepEqual(setGroupBy(s, [{ source: "job_type" }]).toggled, []);
  assert.deepEqual(regroup(s, [{ source: "job_type" }], [], new Set()).toggled, []);
  // Column edits keep them.
  assert.deepEqual(setColumns(s, { order: ["x"], hidden: [], pinned: [], widths: {} }).toggled, ["0=a/", "0=b/"]);
});
