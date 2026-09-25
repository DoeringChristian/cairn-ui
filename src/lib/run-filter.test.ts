import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OPERATORS,
  coerceArg,
  coerceScalar,
  evaluate,
  fieldValue,
  EMPTY_FILTER,
  EMPTY_RUNS_FILTER,
  OP_BUILTINS,
  addChild,
  exprLeafError,
  filterFieldsOf,
  isEmptyFilter,
  isOperator,
  matchesFilter,
  matchesFilters,
  nodeAt,
  opBuiltin,
  parseRunsFilterState,
  updateAt,
  type FilterNode,
  type Operator,
} from "./run-filter.ts";
import { makeRun as run, stats } from "./runs-table/test-run.ts";

interface Vector {
  op: string;
  field_value: unknown;
  arg: unknown;
  expected: boolean;
}

const vectors = JSON.parse(
  readFileSync(new URL("../../docs/schemas/filter-vectors.json", import.meta.url), "utf8"),
) as Vector[];

test("filter-vectors.json: every case matches the Python comparators", () => {
  for (const v of vectors) {
    assert.ok(isOperator(v.op), `unknown op ${v.op}`);
    assert.equal(
      evaluate(v.op, v.field_value, v.arg),
      v.expected,
      `${v.op}(${JSON.stringify(v.field_value)}, ${JSON.stringify(v.arg)})`,
    );
  }
});

test("filter-vectors.json covers every operator", () => {
  const ops = new Set(vectors.map((v) => v.op));
  for (const op of OPERATORS) assert.ok(ops.has(op), op);
});

test("coerceScalar mirrors query_resolver._coerce", () => {
  assert.equal(coerceScalar("true"), true);
  assert.equal(coerceScalar("FALSE"), false);
  assert.equal(coerceScalar("true "), "true ");
  assert.equal(coerceScalar("3"), 3);
  assert.equal(coerceScalar(" -3 "), -3);
  assert.equal(coerceScalar("1_000"), 1000);
  assert.equal(coerceScalar("0.5"), 0.5);
  assert.equal(coerceScalar(".5"), 0.5);
  assert.equal(coerceScalar("1."), 1);
  assert.equal(coerceScalar("1e-3"), 0.001);
  assert.equal(coerceScalar("inf"), Infinity);
  assert.equal(coerceScalar("-Infinity"), -Infinity);
  assert.equal(coerceScalar("0x10"), "0x10");
  assert.equal(coerceScalar(""), "");
  assert.equal(coerceScalar("adam"), "adam");
  assert.deepEqual(coerceArg("in", "adam,1, sgd"), ["adam", 1, " sgd"]);
  assert.equal(coerceArg("exact", "a,b"), "a,b");
});


test("fieldValue: built-ins, values, params, missing", () => {
  const r = run("a", {
    tags: '["x","y"]',
    group: "g1",
    values: { acc: 0.9 },
    params: { lr: 0.1, "model.depth": 4 },
  });
  assert.equal(fieldValue(r, "display_name"), "a");
  assert.equal(fieldValue(r, "status"), "completed");
  assert.deepEqual(fieldValue(r, "tags"), ["x", "y"]);
  assert.deepEqual(fieldValue(run("b"), "tags"), []);
  assert.equal(fieldValue(r, "group"), "g1");
  assert.equal(fieldValue(r, "job_type"), null);
  assert.equal(fieldValue(r, "values.acc"), 0.9);
  assert.equal(fieldValue(r, "values.loss"), null);
  assert.equal(fieldValue(r, "params.model.depth"), 4);
  assert.equal(fieldValue(run("c"), "params.lr"), null);
});

test("matchesFilters: all-of, with typed args coerced", () => {
  const r = run("a", { tags: '["baseline"]', values: { acc: 0.9 }, params: { opt: "adam" } });
  assert.ok(matchesFilters(r, []));
  assert.ok(matchesFilters(r, [
    { field: "values.acc", op: "gt", arg: "0.8" },
    { field: "params.opt", op: "in", arg: "adam,sgd" },
    { field: "tags", op: "contains", arg: "baseline" },
  ]));
  assert.ok(!matchesFilters(r, [
    { field: "values.acc", op: "gt", arg: "0.8" },
    { field: "group", op: "isnull", arg: "false" },
  ]));
  assert.ok(matchesFilters(r, [{ field: "job_type", op: "isnull", arg: "true" }]));
});

test("filterFieldsOf: built-ins then sorted values/params unions", () => {
  const fields = filterFieldsOf([
    run("a", { values: { b: 1 }, params: { z: 1 } }),
    run("b", { values: { a: 1 }, params: { y: 1 } }),
  ]);
  assert.deepEqual(fields, [
    "display_name", "status", "tags", "group", "job_type",
    "values.a", "values.b", "params.y", "params.z",
  ]);
});

test("filter tree: and/or groups, chips and expression leaves", () => {
  const a = run("a", { params: { opt: "adam", lr: 0.1 }, values: { acc: 0.9 }, stats: stats({ "val.loss": [0.2, 0.5] }) });
  const b = run("b", { params: { opt: "sgd", lr: 0.01 }, values: { acc: 0.7 }, stats: stats({ "val.loss": [0.4, 0.9] }) });
  const c = run("c", { params: { opt: "sgd", lr: 0.5 }, values: { acc: 0.95 } });
  const chip = (field: string, op: Operator, arg: string): FilterNode => ({ kind: "chip", field, op, arg });
  const or: FilterNode = {
    kind: "group",
    op: "or",
    children: [chip("params.opt", "exact", "adam"), chip("values.acc", "gt", "0.9")],
  };
  const pick = (n: FilterNode) => [a, b, c].filter((r) => matchesFilter(r, n)).map((r) => r.id);
  assert.deepEqual(pick(or), ["a", "c"]);
  assert.deepEqual(pick({ kind: "group", op: "and", children: [or, chip("params.lr", "lt", "0.2")] }), ["a"]);
  assert.deepEqual(pick({ kind: "expr", expr: "min(val.loss) < 0.3" }), ["a"]);
  assert.deepEqual(pick({ kind: "expr", expr: "config.opt == 'sgd' and summary.acc > 0.8" }), ["c"]);
  assert.deepEqual(pick({ kind: "expr", expr: "run.name in ['a', 'b']" }), ["a", "b"]);
  // An invalid expression constrains nothing (the bar shows its error).
  assert.deepEqual(pick({ kind: "expr", expr: "min(" }), ["a", "b", "c"]);
  assert.ok(exprLeafError("min(") !== null);
  assert.ok(exprLeafError("val.loss") !== null, "a series is not a filter");
  assert.equal(exprLeafError("last(val.loss) < 1"), null);
  // Empty groups match everything.
  assert.deepEqual(pick(EMPTY_FILTER), ["a", "b", "c"]);
  assert.deepEqual(pick({ kind: "group", op: "or", children: [] }), ["a", "b", "c"]);
  assert.ok(isEmptyFilter({ kind: "group", op: "and", children: [{ kind: "group", op: "or", children: [] }] }));
  assert.ok(!isEmptyFilter({ kind: "group", op: "and", children: [chip("status", "exact", "x")] }));
});

test("chips compile to __op_* builtins that agree with filter-vectors.json", () => {
  for (const v of vectors) {
    if (!isOperator(v.op)) continue;
    assert.equal(OP_BUILTINS[opBuiltin(v.op)](v.field_value, v.arg), v.expected, `${v.op}`);
  }
});

test("tree edits: addChild / updateAt / nodeAt", () => {
  let root = addChild(EMPTY_FILTER, [], { kind: "group", op: "or", children: [] });
  root = addChild(root, [0], { kind: "expr", expr: "x > 1" });
  root = addChild(root, [0], { kind: "chip", field: "status", op: "exact", arg: "failed" });
  assert.deepEqual(nodeAt(root, [0, 1]), { kind: "chip", field: "status", op: "exact", arg: "failed" });
  root = updateAt(root, [0], (n) => (n.kind === "group" ? { ...n, op: "and" } : n));
  assert.equal((nodeAt(root, [0]) as { op: string }).op, "and");
  root = updateAt(root, [0, 0], () => null);
  assert.equal((nodeAt(root, [0]) as { children: unknown[] }).children.length, 1);
  assert.equal(nodeAt(root, [5]), null);
});

test("parseRunsFilterState: v2 only, malformed parts dropped", () => {
  assert.deepEqual(parseRunsFilterState(null), EMPTY_RUNS_FILTER);
  // v1 is not migrated.
  assert.deepEqual(parseRunsFilterState({ version: 1, filters: [], groupBy: { source: "tag" } }), EMPTY_RUNS_FILTER);
  const parsed = parseRunsFilterState({
    version: 2,
    filter: {
      kind: "group",
      op: "or",
      children: [
        { kind: "chip", field: "status", op: "exact", arg: "failed" },
        { kind: "chip", field: "status", op: "bogus", arg: "x" },
        { kind: "expr", expr: "min(loss) < 1" },
        { kind: "group", op: "and", children: [{ kind: "expr" }] },
      ],
    },
    groupBy: [{ source: "param", key: "lr" }, { source: "param" }, { source: "expr", expr: "config.a" }],
    sort: [{ column: "value:acc", direction: "desc" }, { column: "x", direction: "sideways" }],
    columns: { order: ["a", 1], hidden: ["b"], pinned: ["value:acc"], better: { "value:acc": "higher", x: "bad" }, widths: { name: 420, "value:acc": 10, y: "wide" } },
    computed: [{ id: "c1", expr: "min(val.loss)", better: "lower" }, { id: 3 }],
  });
  assert.deepEqual(parsed, {
    version: 2,
    filter: {
      kind: "group",
      op: "or",
      children: [
        { kind: "chip", field: "status", op: "exact", arg: "failed" },
        { kind: "expr", expr: "min(loss) < 1" },
        { kind: "group", op: "and", children: [] },
      ],
    },
    groupBy: [{ source: "param", key: "lr" }, { source: "expr", expr: "config.a" }],
    sort: [{ column: "value:acc", direction: "desc" }],
    columns: { order: ["a"], hidden: ["b"], pinned: ["value:acc"], better: { "value:acc": "higher" }, widths: { name: 420, "value:acc": 60 } },
    computed: [{ id: "c1", expr: "min(val.loss)", better: "lower" }],
  });
});

test("NaN is unordered, like Python", () => {
  for (const op of ["gt", "gte", "lt", "lte"] as const) {
    assert.equal(evaluate(op, NaN, 1), false);
    assert.equal(evaluate(op, 1, NaN), false);
  }
});
