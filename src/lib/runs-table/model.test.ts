import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTER } from "../run-filter.ts";
import { groupRunsNested } from "./group.ts";
import {
  collapsedGroups,
  filterRuns,
  filterRunsKeeping,
  isStatusFilter,
  latestRuns,
  groupSelection,
  toggleGroupSelection,
  pinnedFirst,
  runRowName,
  sameGroup,
} from "./model.ts";
import { sortBy } from "./sort.ts";
import { cellValue } from "./columns.ts";
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

test("latestRuns: the same name in different groups is a separate series", () => {
  const rs = [
    run("t42", { display_name: "train", group: "exp-42", created_at: "2026-01-03" }),
    run("t43", { display_name: "train", group: "exp-43", created_at: "2026-01-02" }),
    run("t44a", { display_name: "train", group: "exp-44", version: 1, created_at: "2026-01-01" }),
    run("t44b", { display_name: "train", group: "exp-44", version: 2, created_at: "2026-01-04" }),
  ];
  const { latestIds, latestByName } = latestRuns(rs);
  assert.deepEqual([...latestIds].sort(), ["t42", "t43", "t44b"]);
  assert.deepEqual([...latestByName], ["t44b"]);
});

test("latestRuns: the higher version wins over a later created_at", () => {
  const rs = [
    run("v2", { display_name: "train", group: "g", version: 2, created_at: "2026-01-01" }),
    run("v1", { display_name: "train", group: "g", version: 1, created_at: "2026-01-09" }),
  ];
  assert.deepEqual([...latestRuns(rs).latestIds], ["v2"]);
  // Without a version on both, created_at decides.
  const mixed = [
    run("old", { display_name: "train", group: "g", version: 3, created_at: "2026-01-01" }),
    run("new", { display_name: "train", group: "g", version: null, created_at: "2026-01-02" }),
  ];
  assert.deepEqual([...latestRuns(mixed).latestIds], ["new"]);
});

test("latestRuns: ungrouped runs form their own series per name", () => {
  const rs = [
    run("u1", { display_name: "train", created_at: "2026-01-01" }),
    run("u2", { display_name: "train", created_at: "2026-01-02" }),
    run("g1", { display_name: "train", group: "g", created_at: "2026-01-01" }),
  ];
  const { latestIds, latestByName } = latestRuns(rs);
  assert.deepEqual([...latestIds].sort(), ["g1", "u2"]);
  assert.deepEqual([...latestByName], ["u2"]);
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

test("sameGroup: every run in one non-null group drops the `group ·` prefix (e.g. filtered to one group)", () => {
  const a = run("a", { group: "exp-44", display_name: "train", version: 2 });
  const b = run("b", { group: "exp-44", display_name: "eval" });
  const c = run("c", { group: "exp-43", display_name: "eval" });
  assert.equal(sameGroup([a, b]), true);
  assert.equal(sameGroup([a, c]), false);
  assert.equal(sameGroup([run("x"), run("y")]), false);
  assert.equal(sameGroup([]), false);
  assert.equal(runRowName(a, sameGroup([a, b])), "train");
  assert.equal(runRowName(a, sameGroup([a, c])), "exp-44 · train");
});

test("sidebar order: the sort, pinned runs first and listed whatever the filters", () => {
  const rs = [
    run("a", { display_name: "beta", created_at: "2026-01-01" }),
    run("b", { display_name: "alpha", created_at: "2026-01-03", status: "failed" }),
    run("c", { display_name: "gamma", created_at: "2026-01-02" }),
  ];
  const f = { status: "completed" as const, search: NO_SEARCH, filter: EMPTY_FILTER, latestOnly: false };
  const all = new Set(rs.map((r) => r.id));
  assert.deepEqual(filterRunsKeeping(rs, f, all, []).map((r) => r.id), ["a", "c"]);
  const listed = filterRunsKeeping(rs, f, all, ["b"]);
  assert.deepEqual(listed.map((r) => r.id), ["a", "b", "c"]);
  const byName = sortBy(listed, [{ column: "name", direction: "asc" }], (r, col) => cellValue(r, col), (r) => r.id);
  assert.deepEqual(byName.map((r) => r.id), ["b", "a", "c"]);
  const byCreated = sortBy(listed, [{ column: "created_at", direction: "desc" }], (r, col) => cellValue(r, col), (r) => r.id);
  assert.deepEqual(pinnedFirst(byCreated, ["c"]).map((r) => r.id), ["c", "b", "a"]);
});

test("group header checkbox: all / some / none of its runs, nested runs included", () => {
  const rs = [run("a"), run("b"), run("c")];
  assert.equal(groupSelection(rs, new Set()), "none");
  assert.equal(groupSelection(rs, new Set(["b", "x"])), "some");
  assert.equal(groupSelection(rs, new Set(["a", "b", "c"])), "all");
  assert.equal(groupSelection([], new Set(["a"])), "none");
});

test("group header click: selects all its runs, keeps other selections; clears them when all were selected", () => {
  const rs = [run("a"), run("b")];
  assert.deepEqual([...toggleGroupSelection(rs, new Set(["x"]))].sort(), ["a", "b", "x"]);
  assert.deepEqual([...toggleGroupSelection(rs, new Set(["a", "x"]))].sort(), ["a", "b", "x"]);
  assert.deepEqual([...toggleGroupSelection(rs, new Set(["a", "b", "x"]))], ["x"]);
  // Two headers ticked: the union of their runs.
  const other = [run("c")];
  assert.deepEqual([...toggleGroupSelection(other, toggleGroupSelection(rs, new Set()))].sort(), ["a", "b", "c"]);
});
