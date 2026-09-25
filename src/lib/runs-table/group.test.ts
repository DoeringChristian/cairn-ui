import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenGroups, groupRunsNested } from "./group.ts";
import { makeRun as run, stats } from "./test-run.ts";

test("groupRunsNested: one level, missing last, order preserved", () => {
  const rs = [run("1", { group: "b" }), run("2"), run("3", { group: "a" }), run("4", { group: "b" })];
  const groups = groupRunsNested(rs, [{ source: "group" }])!;
  assert.deepEqual(groups.map((g) => [g.label, g.runs.map((r) => r.id), g.children]), [
    ["a", ["3"], null],
    ["b", ["1", "4"], null],
    [null, ["2"], null],
  ]);
  assert.equal(groupRunsNested(rs, []), null);
});

test("groupRunsNested: params sort numerically, tags fan out, ids unique", () => {
  const byParam = groupRunsNested(
    [run("1", { params: { bs: 128 } }), run("2", { params: { bs: 32 } }), run("3", { params: { bs: 32 } })],
    [{ source: "param", key: "bs" }],
  )!;
  assert.deepEqual(byParam.map((g) => [g.label, g.runs.length]), [["32", 2], ["128", 1]]);
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
      ["adam", [["false", 1, ["3"]], ["true", 1, ["1"]], [null, 1, ["4"]]]],
      ["sgd", [["false", 1, ["2"]]]],
    ],
  );
  const ids = tree.flatMap((g) => [g.id, ...g.children!.map((c) => c.id)]);
  assert.equal(new Set(ids).size, ids.length);

  const rows = flattenGroups(tree, new Set([tree[1]!.id]));
  assert.deepEqual(
    rows.map((r) => (r.kind === "group" ? `g:${r.node.label}` : `r:${r.run.id}@${r.depth}`)),
    ["g:adam", "g:false", "r:3@2", "g:true", "r:1@2", "g:null", "r:4@2", "g:sgd"],
  );
});
