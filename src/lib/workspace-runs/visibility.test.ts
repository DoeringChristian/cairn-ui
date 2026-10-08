import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../../api/types.ts";
import { groupRunsNested, type GroupBy } from "../runs-table/group.ts";
import { makeRun } from "../runs-table/test-run.ts";
import { DEFAULT_RUN_STATE, type RunState } from "./state.ts";
import {
  DEFAULT_VISIBLE,
  allEye,
  toggleAllEyes,
  cardRuns,
  groupEye,
  groupKey,
  resolveVisibility,
  showOnly,
  toggleGroupEye,
  toggleRunEye,
} from "./visibility.ts";

const at = (i: number) => `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`;
/** Newest first, as the table sorts them. */
const sortNewest = (rs: Run[]) => [...rs].sort((a, b) => b.created_at.localeCompare(a.created_at));
const BY_GROUP: GroupBy[] = [{ source: "group" }];

function fixture(nGroups: number) {
  const runs: Run[] = [];
  for (let g = 0; g < nGroups; g++) {
    runs.push(makeRun(`g${g}-a`, { group: `exp-${g}`, display_name: "train", created_at: at(g * 2) }));
    runs.push(makeRun(`g${g}-b`, { group: `exp-${g}`, display_name: "eval", created_at: at(g * 2 + 1) }));
  }
  runs.push(makeRun("loose", { display_name: "baseline", created_at: at(59) }));
  const sorted = sortNewest(runs);
  return { sorted, groups: groupRunsNested(sorted, BY_GROUP)! };
}

const withEyes = (eyes: Record<string, boolean>): RunState => ({ ...DEFAULT_RUN_STATE, eyes });

test("not grouped: the newest DEFAULT_VISIBLE runs; a run eye overrides", () => {
  const runs = sortNewest(Array.from({ length: 12 }, (_, i) => makeRun(`r${i}`, { created_at: at(i) })));
  const v = resolveVisibility(runs, null, {});
  assert.equal(v.runs.size, DEFAULT_VISIBLE);
  assert.equal(v.runs.has("r0"), false);
  assert.equal(v.runs.has("r11"), true);
  assert.deepEqual([v.shown, v.listed, v.unit], [10, 12, "runs"]);
  const o = resolveVisibility(runs, null, { "r:r0": true, "r:r11": false });
  assert.equal(o.runs.has("r0"), true);
  assert.equal(o.runs.has("r11"), false);
});

test("grouped: the newest DEFAULT_VISIBLE groups with their runs; group then run eyes override", () => {
  const { sorted, groups } = fixture(11); // + the (none) group: 12 groups
  const v = resolveVisibility(sorted, groups, {});
  assert.deepEqual([v.shown, v.listed, v.unit], [10, 12, "groups"]);
  // The (none) group is newest; exp-0 and exp-1 are the oldest.
  assert.equal(v.runs.has("loose"), true);
  assert.equal(v.runs.has("g0-a") || v.runs.has("g1-a"), false);
  assert.equal(v.runs.has("g2-a") && v.runs.has("g2-b"), true);
  const exp0 = groups.find((g) => g.label === "exp-0")!;
  const o = resolveVisibility(sorted, groups, { [groupKey(exp0)]: true, "r:g0-b": false, "r:g10-a": false });
  assert.equal(o.runs.has("g0-a"), true);
  assert.equal(o.runs.has("g0-b"), false);
  assert.equal(o.runs.has("g10-a"), false);
  assert.equal(groupEye(exp0, o.runs), "mixed");
  assert.equal(groupEye(groups.find((g) => g.label === "exp-5")!, o.runs), "on");
  assert.equal(groupEye(groups.find((g) => g.label === "exp-1")!, o.runs), "off");
});

test("a top-level group eye sets the group and returns its runs to following it", () => {
  const { sorted, groups } = fixture(3);
  const exp2 = groups.find((g) => g.label === "exp-2")!;
  let s = withEyes({ "r:g2-a": false });
  let vis = resolveVisibility(sorted, groups, s.eyes).runs;
  assert.equal(groupEye(exp2, vis), "mixed");
  // mixed → all on
  s = toggleGroupEye(s, exp2, vis);
  assert.deepEqual(s.eyes, { [groupKey(exp2)]: true });
  vis = resolveVisibility(sorted, groups, s.eyes).runs;
  assert.equal(groupEye(exp2, vis), "on");
  // on → all off
  s = toggleGroupEye(s, exp2, vis);
  vis = resolveVisibility(sorted, groups, s.eyes).runs;
  assert.equal(groupEye(exp2, vis), "off");
  // a run eye inside the hidden group shows that run only
  s = toggleRunEye(s, { id: "g2-b" }, vis);
  vis = resolveVisibility(sorted, groups, s.eyes).runs;
  assert.deepEqual([vis.has("g2-a"), vis.has("g2-b")], [false, true]);
});

test("a nested group eye sets its runs' eyes", () => {
  const runs = sortNewest([
    makeRun("a", { group: "exp", display_name: "train", created_at: at(1) }),
    makeRun("b", { group: "exp", display_name: "eval", created_at: at(2) }),
  ]);
  const groups = groupRunsNested(runs, [{ source: "group" }, { source: "param", key: "lr" }])!;
  const inner = groups[0]!.children![0]!;
  const vis = resolveVisibility(runs, groups, {}).runs;
  const s = toggleGroupEye(DEFAULT_RUN_STATE, inner, vis);
  assert.deepEqual(s.eyes, { "r:b": false, "r:a": false });
});

test("cardRuns: visible runs in table order; grouped, each with its top-level group (no value: none)", () => {
  const { sorted, groups } = fixture(2);
  const vis = resolveVisibility(sorted, groups, { "r:g1-a": false }).runs;
  const c = cardRuns(sorted, groups, vis);
  assert.deepEqual(c.runIds, ["g1-b", "g0-b", "g0-a", "loose"]);
  assert.deepEqual([...c.groupOf], [["g1-b", "exp-1"], ["g0-b", "exp-0"], ["g0-a", "exp-0"]]);
  const flat = cardRuns(sorted, null, resolveVisibility(sorted, null, {}).runs);
  assert.deepEqual(flat.runIds, sorted.map((r) => r.id));
  assert.equal(flat.groupOf.size, 0);
});

test("showOnly: grouped, the ticked runs' groups (no-value runs only where ticked); not grouped, the ticked runs", () => {
  const { sorted, groups } = fixture(3);
  const extra = makeRun("loose2", { display_name: "other", created_at: at(58) });
  const all = [...sorted, extra];
  const base = { ...DEFAULT_RUN_STATE, search: "x", status: "failed" as const, latestOnly: true };
  const s = showOnly(base, all, new Set(["g1-a", "loose"]));
  assert.deepEqual([s.search, s.status, s.latestOnly], ["", "all", false]);
  const allGroups = groupRunsNested(sortNewest(all), BY_GROUP)!;
  const vis = resolveVisibility(sortNewest(all), allGroups, s.eyes).runs;
  assert.deepEqual([...vis].sort(), ["g1-a", "g1-b", "loose"]);
  assert.equal(groups.length, 4);
  const flat = showOnly({ ...base, groupBy: [] }, all, new Set(["g1-a"]));
  assert.deepEqual([...resolveVisibility(all, null, flat.eyes).runs], ["g1-a"]);
});

test("header eye: on / off / mixed over the listed runs; a click shows all, or hides all when all are shown", () => {
  const { sorted, groups } = fixture(3);
  const s0 = withEyes({});
  const v0 = resolveVisibility(sorted, groups, s0.eyes).runs;
  assert.equal(allEye(sorted, v0), "on");
  // All shown: hide all (grouped: every top-level group's eye, run eyes cleared).
  const s1 = toggleAllEyes(withEyes({ "r:g0-a": true }), sorted, groups, v0);
  assert.equal(s1.eyes["r:g0-a"], undefined);
  const v1 = resolveVisibility(sorted, groups, s1.eyes).runs;
  assert.equal(v1.size, 0);
  assert.equal(allEye(sorted, v1), "off");
  // Some shown: show all.
  const s2 = toggleGroupEye(s1, groups[0]!, v1);
  const v2 = resolveVisibility(sorted, groups, s2.eyes).runs;
  assert.equal(allEye(sorted, v2), "mixed");
  const v3 = resolveVisibility(sorted, groups, toggleAllEyes(s2, sorted, groups, v2).eyes).runs;
  assert.equal(v3.size, sorted.length);
  // Not grouped: every run's eye.
  const s4 = toggleAllEyes(withEyes({}), sorted, null, resolveVisibility(sorted, null, {}).runs);
  assert.equal(Object.keys(s4.eyes).length, sorted.length);
  assert.equal(resolveVisibility(sorted, null, s4.eyes).runs.size, 0);
  assert.equal(allEye([], new Set()), "off");
});
