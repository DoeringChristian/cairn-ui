import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenGroups, groupLineLabel, groupRowModel, groupRunsNested, hasGroupLevel, innermostLineOf, type GroupBy } from "./group.ts";
import { groupLineColors } from "../run-color.ts";
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

test("groupRunsNested: group, then job_type (wandb's nested grouping)", () => {
  const rs = [
    run("p", { group: "exp-44", job_type: "prepare" }),
    run("t", { group: "exp-44", job_type: "train" }),
    run("f1", { group: "exp-44", job_type: "finetune" }),
    run("f2", { group: "exp-44", job_type: "finetune" }),
    run("s0", { group: "seeds", job_type: "train" }),
    run("u"),
  ];
  const tree = groupRunsNested(rs, [{ source: "group" }, { source: "job_type" }])!;
  assert.deepEqual(
    tree.map((g) => [g.label, g.children!.map((c) => [c.label, c.runs.map((r) => r.id)])]),
    [
      ["exp-44", [["prepare", ["p"]], ["train", ["t"]], ["finetune", ["f1", "f2"]]]],
      ["seeds", [["train", ["s0"]]]],
      [null, [[null, ["u"]]]],
    ],
  );
});

// wandb's nested grouping (group › job type), as the sidebar and the Runs page read it.
const nested = () => [
  run("t2", { group: "exp-44", job_type: "train", display_name: "eager-sun", version: 2 }),
  run("t1", { group: "exp-44", job_type: "train", display_name: "eager-sun", version: 1 }),
  run("e1", { group: "exp-44", job_type: "eval" }),
  run("p1", { group: "exp-44", job_type: "prepare" }),
  run("p2", { group: "exp-44", job_type: "prepare" }),
  run("s0", { group: "seeds-lr3e-4", job_type: "train" }),
  run("b1", { job_type: "eval" }),
  run("b2"),
];

test("groupRowModel: outer rows `Field: value`, hollow, sub-group + run counts; innermost filled, run count", () => {
  const groups = groupRunsNested(nested(), [{ source: "group" }, { source: "job_type" }])!;
  const outer = groups.map(groupRowModel);
  assert.deepEqual(
    outer.map((m) => [m.text, m.dot, m.counts, m.line]),
    [
      ["Group: exp-44", "hollow", [3, 5], null],
      ["Group: seeds-lr3e-4", "hollow", [1, 1], null],
      ["Group: (none)", "hollow", [2, 2], null],
    ],
  );
  assert.equal(outer[2]!.none, true);
  const inner = groups[0]!.children!.map(groupRowModel);
  assert.deepEqual(
    inner.map((m) => [m.text, m.dot, m.counts, m.line]),
    [
      ["Job Type: train", "filled", [2], "group: exp-44, jobType: train"],
      ["Job Type: eval", "filled", [1], "group: exp-44, jobType: eval"],
      ["Job Type: prepare", "filled", [2], "group: exp-44, jobType: prepare"],
    ],
  );
  assert.deepEqual(groups[2]!.children!.map((n) => groupRowModel(n).text), ["Job Type: eval", "Job Type: (none)"]);
});

test("groupRowModel: one level, the group row is innermost (filled dot, run count); tag and param fields", () => {
  const [g] = groupRunsNested(nested(), [{ source: "group" }])!;
  const m = groupRowModel(g!);
  assert.deepEqual([m.text, m.dot, m.counts, m.line], ["Group: exp-44", "filled", [5], "group: exp-44"]);
  const tag = groupRunsNested([run("a", { tags: JSON.stringify(["x"]) })], [{ source: "tag" }])!;
  assert.equal(groupRowModel(tag[0]!).text, "Tag: x");
  const param = groupRunsNested([run("a", { params: { lr: 0.1 } })], [{ source: "param", key: "lr" }])!;
  assert.deepEqual([groupRowModel(param[0]!).text, groupRowModel(param[0]!).line], ["lr: 0.1", "lr: 0.1"]);
});

test("flattenGroups: runs inside groups sit one level below their innermost group", () => {
  const groups = groupRunsNested(nested(), [{ source: "group" }, { source: "job_type" }])!;
  const rows = flattenGroups(groups, new Set());
  const t2 = rows.find((r) => r.kind === "run" && r.run.id === "t2")!;
  assert.equal(t2.kind === "run" && t2.depth, 2);
});

test("innermostLineOf / groupLineLabel: a run's innermost group path (wandb's legend `key: value` list)", () => {
  const groups = groupRunsNested(nested(), [{ source: "group" }, { source: "job_type" }])!;
  const of = innermostLineOf(groups);
  assert.equal(of.get("t1"), "group: exp-44, jobType: train");
  assert.equal(of.get("b2"), "group: (none), jobType: (none)");
  assert.equal(of.size, 8);
  assert.equal(groupLineLabel([]), "");
  // Every innermost group a colour, distinct while the palette lasts.
  const colors = groupLineColors([...new Set(of.values())]);
  assert.equal(new Set(colors.values()).size, colors.size);
});

test("hasGroupLevel: the same field is a duplicate level, another field or param key is not", () => {
  const levels: GroupBy[] = [{ source: "group" }, { source: "param", key: "lr" }];
  assert.equal(hasGroupLevel(levels, { source: "group" }), true);
  assert.equal(hasGroupLevel(levels, { source: "job_type" }), false);
  assert.equal(hasGroupLevel(levels, { source: "param", key: "lr" }), true);
  assert.equal(hasGroupLevel(levels, { source: "param", key: "seed" }), false);
  assert.equal(hasGroupLevel(levels, { source: "expr", expr: "group" }), false);
});
