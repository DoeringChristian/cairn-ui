import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenGroups, groupRunsNested } from "./group.ts";
import { sortBy } from "./sort.ts";
import { makeRun as run, stats } from "./test-run.ts";

test("groupRunsNested: one level, groups in first-run order, missing last, order preserved", () => {
  const rs = [run("1", { group: "b" }), run("2"), run("3", { group: "a" }), run("4", { group: "b" })];
  const groups = groupRunsNested(rs, [{ source: "group" }])!;
  assert.deepEqual(groups.map((g) => [g.label, g.runs.map((r) => r.id), g.children]), [
    ["b", ["1", "4"], null],
    ["a", ["3"], null],
    [null, ["2"], null],
  ]);
  assert.equal(groupRunsNested(rs, []), null);
});

test("groupRunsNested: sorting by the grouped column orders the groups by value (numeric, both ways)", () => {
  const rs = [run("1", { params: { bs: 128 } }), run("2", { params: { bs: 32 } }), run("3", { params: { bs: 32 } }), run("4")];
  const bs = (r: (typeof rs)[number]) => r.params?.bs;
  const group = (dir: "asc" | "desc") =>
    groupRunsNested(sortBy(rs, [{ column: "param:bs", direction: dir }], (r) => bs(r), (r) => r.id), [{ source: "param", key: "bs" }])!
      .map((g) => [g.label, g.runs.length]);
  assert.deepEqual(group("asc"), [["32", 2], ["128", 1], [null, 1]]);
  assert.deepEqual(group("desc"), [["128", 1], ["32", 2], [null, 1]]);
});

test("groupRunsNested: sorting by Created orders groups by their newest/oldest run, runs sorted inside", () => {
  const rs = [
    run("a1", { group: "a", created_at: "2026-01-01" }),
    run("b1", { group: "b", created_at: "2026-01-02" }),
    run("a2", { group: "a", created_at: "2026-01-03" }),
    run("c1", { group: "c", created_at: "2026-01-04" }),
  ];
  const by = (dir: "asc" | "desc") =>
    groupRunsNested(sortBy(rs, [{ column: "created_at", direction: dir }], (r) => r.created_at, (r) => r.id), [{ source: "group" }])!
      .map((g) => [g.label, g.runs.map((r) => r.id)]);
  assert.deepEqual(by("desc"), [["c", ["c1"]], ["a", ["a2", "a1"]], ["b", ["b1"]]]);
  assert.deepEqual(by("asc"), [["a", ["a1", "a2"]], ["b", ["b1"]], ["c", ["c1"]]]);
});

test("groupRunsNested: tags fan out, ids unique", () => {
  const byTag = groupRunsNested([run("1", { tags: '["x","y"]' }), run("2", { tags: '["y"]' }), run("3")], [{ source: "tag" }])!;
  assert.deepEqual(byTag.map((g) => [g.label, g.runs.map((r) => r.id)]), [
    ["x", ["1"]],
    ["y", ["1", "2"]],
    [null, ["3"]],
  ]);
});

test("groupRunsNested: nested levels and expression groups", () => {
  const rs = [
    run("1", { params: { opt: "adam", lr: 0.1 }, stats: stats({ loss: [0.2, 1] }) }),
    run("2", { params: { opt: "sgd", lr: 0.1 }, stats: stats({ loss: [0.6, 1] }) }),
    run("3", { params: { opt: "adam", lr: 0.01 }, stats: stats({ loss: [0.7, 1] }) }),
    run("4", { params: { opt: "adam", lr: 0.1 } }),
  ];
  const tree = groupRunsNested(rs, [{ source: "param", key: "opt" }, { source: "expr", expr: "min(loss) < 0.5" }])!;
  assert.deepEqual(
    tree.map((g) => [g.label, g.children!.map((c) => [c.label, c.depth, c.runs.map((r) => r.id)])]),
    [
      ["adam", [["true", 1, ["1"]], ["false", 1, ["3"]], [null, 1, ["4"]]]],
      ["sgd", [["false", 1, ["2"]]]],
    ],
  );
  const ids = tree.flatMap((g) => [g.id, ...g.children!.map((c) => c.id)]);
  assert.equal(new Set(ids).size, ids.length);

  const rows = flattenGroups(tree, new Set([tree[1]!.id]));
  assert.deepEqual(
    rows.map((r) => (r.kind === "group" ? `g:${r.node.label}` : `r:${r.run.id}@${r.depth}`)),
    ["g:adam", "g:true", "r:1@2", "g:false", "r:3@2", "g:null", "r:4@2", "g:sgd"],
  );
});
