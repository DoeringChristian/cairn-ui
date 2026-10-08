import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTER } from "../run-filter.ts";
import { groupRunsNested } from "./group.ts";
import { collapsedGroups, filterRuns, isStatusFilter, latestRuns, pinnedFirst, runRowName } from "./model.ts";
import { compileRunSearch } from "./search.ts";
import { makeRun as run } from "./test-run.ts";

const NO_SEARCH = compileRunSearch("");

test("latestRuns: newest run per name; highlighted only when the name has several", () => {
  const rs = [
    run("a1", { display_name: "a", created_at: "2026-01-01" }),
    run("a2", { display_name: "a", created_at: "2026-01-02" }),
    run("b1", { display_name: "b", created_at: "2026-01-01" }),
  ];
  const { latestIds, latestByName } = latestRuns(rs);
  assert.deepEqual([...latestIds].sort(), ["a2", "b1"]);
  assert.deepEqual([...latestByName], ["a2"]);
});

test("filterRuns: archived only under 'archived', status, latest only, search", () => {
  const rs = [
    run("1", { status: "completed" }),
    run("2", { status: "failed" }),
    run("3", { archived: true }),
    run("4", { display_name: "train" }),
  ];
  const ids = (status: Parameters<typeof filterRuns>[1]["status"], extra: Partial<Parameters<typeof filterRuns>[1]> = {}, latest = new Set(rs.map((r) => r.id))) =>
    filterRuns(rs, { status, search: NO_SEARCH, filter: EMPTY_FILTER, latestOnly: false, ...extra }, latest).map((r) => r.id);
  assert.deepEqual(ids("all"), ["1", "2", "4"]);
  assert.deepEqual(ids("archived"), ["3"]);
  assert.deepEqual(ids("failed"), ["2"]);
  assert.deepEqual(ids("all", { latestOnly: true }, new Set(["1", "4"])), ["1", "4"]);
  assert.deepEqual(ids("all", { search: compileRunSearch("^tr") }), ["4"]);
  assert.equal(isStatusFilter("crashed"), true);
  assert.equal(isStatusFilter("bogus"), false);
});

test("pinnedFirst: pinned runs first, both parts in order", () => {
  const rs = [run("1"), run("2"), run("3")];
  assert.deepEqual(pinnedFirst(rs, ["3"]).map((r) => r.id), ["3", "1", "2"]);
  assert.equal(pinnedFirst(rs, []), rs);
});

test("collapsedGroups: the default per node, flipped by toggles", () => {
  const groups = groupRunsNested(
    [run("1", { group: "a" }), run("2", { group: "b" }), run("3")],
    [{ source: "group" }],
  )!;
  const firstOpen = (n: { depth: number; label: string | null }, i: number) => n.depth === 0 && i > 0 && n.label != null;
  const ids = (toggled: string[]) => [...collapsedGroups(groups, new Set(toggled), firstOpen)];
  assert.deepEqual(ids([]), [groups[1]!.id]);
  assert.deepEqual(ids([groups[0]!.id, groups[1]!.id]), [groups[0]!.id]);
  assert.deepEqual([...collapsedGroups(groups, new Set(), () => false)], []);
});

test("runRowName: not grouped, a grouped run reads 'group · name'; grouped or without a group, the name", () => {
  const train = run("t", { display_name: "train", group: "exp-44" });
  const baseline = run("b", { display_name: "baseline" });
  assert.equal(runRowName(train, false), "exp-44 · train");
  assert.equal(runRowName(train, true), "train");
  assert.equal(runRowName(baseline, false), "baseline");
  assert.equal(runRowName(run("abc", { display_name: null }), false), "abc");
});
