import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Run } from "../api/types.ts";
import {
  OPERATORS,
  coerceArg,
  coerceScalar,
  evaluate,
  fieldValue,
  filterFieldsOf,
  groupRuns,
  isOperator,
  matchesFilters,
  parseRunsFilterState,
} from "./run-filter.ts";

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

function run(id: string, extra: Partial<Run> = {}): Run {
  return {
    id,
    project_id: "p",
    display_name: id,
    created_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    status: "completed",
    exit_code: null,
    git_sha: null,
    git_dirty: null,
    git_branch: null,
    cli_args: null,
    env_snapshot: null,
    hostname: null,
    user: null,
    tags: null,
    notes: null,
    ...extra,
  };
}

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

test("groupRuns: by group with missing values last, order preserved", () => {
  const rs = [run("1", { group: "b" }), run("2"), run("3", { group: "a" }), run("4", { group: "b" })];
  const groups = groupRuns(rs, { source: "group" });
  assert.deepEqual(groups.map((g) => [g.label, g.runs.map((r) => r.id)]), [
    ["a", ["3"]],
    ["b", ["1", "4"]],
    [null, ["2"]],
  ]);
});

test("groupRuns: params sort numerically, tags fan out", () => {
  const byParam = groupRuns(
    [run("1", { params: { bs: 128 } }), run("2", { params: { bs: 32 } }), run("3", { params: { bs: 32 } })],
    { source: "param", key: "bs" },
  );
  assert.deepEqual(byParam.map((g) => [g.label, g.runs.length]), [["32", 2], ["128", 1]]);

  const byTag = groupRuns(
    [run("1", { tags: '["x","y"]' }), run("2", { tags: '["y"]' }), run("3")],
    { source: "tag" },
  );
  assert.deepEqual(byTag.map((g) => [g.label, g.runs.map((r) => r.id)]), [
    ["x", ["1"]],
    ["y", ["1", "2"]],
    [null, ["3"]],
  ]);
  assert.equal(new Set(byTag.map((g) => g.id)).size, byTag.length);
});

test("parseRunsFilterState drops malformed entries", () => {
  assert.deepEqual(parseRunsFilterState(null), { version: 1, filters: [], groupBy: null });
  assert.deepEqual(
    parseRunsFilterState({
      filters: [
        { field: "status", op: "exact", arg: "failed" },
        { field: "status", op: "bogus", arg: "x" },
        { field: 1, op: "exact", arg: "x" },
      ],
      groupBy: { source: "param", key: "lr" },
    }),
    { version: 1, filters: [{ field: "status", op: "exact", arg: "failed" }], groupBy: { source: "param", key: "lr" } },
  );
  assert.equal(parseRunsFilterState({ groupBy: { source: "param" } }).groupBy, null);
  assert.deepEqual(parseRunsFilterState({ groupBy: { source: "tag" } }).groupBy, { source: "tag" });
});
