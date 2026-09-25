import { test } from "node:test";
import assert from "node:assert/strict";
import { aggColumnName, applyTableOps, hasTableOps } from "./pipeline.ts";
import type { TableData } from "./types.ts";

const img = (h: string) => ({ $media: { hash: h, mime_type: "image/png" } });

const T: TableData = {
  columns: [
    { name: "id", type: "number" },
    { name: "label", type: "string" },
    { name: "score", type: "number" },
    { name: "pred/label", type: "string" },
    { name: "image", type: "media" },
  ],
  data: [
    [1, "cat", 0.9, "cat", img("a")],
    [2, "dog", 0.4, "cat", img("b")],
    [3, "cat", 0.7, "dog", img("c")],
    [4, "bird", null, "bird", img("d")],
  ],
};

test("no ops is the identity", () => {
  const r = applyTableOps(T, {});
  assert.equal(r.table, T);
  assert.equal(hasTableOps({}), false);
  assert.equal(hasTableOps({ query: "  " }), false);
  assert.equal(hasTableOps({ query: "x" }), true);
});

test("derived columns: bare names, config.<col>, quoted names, chaining", () => {
  const r = applyTableOps(T, {
    derived: [
      { name: "pct", expr: "score * 100" },
      { name: "correct", expr: "label == `pred/label`" },
      { name: "pct2", expr: "config.pct + 1" },
    ],
  });
  assert.deepEqual(r.derivedErrors, [null, null, null]);
  assert.deepEqual(r.table.columns.slice(-3), [
    { name: "pct", type: "number" },
    { name: "correct", type: "bool" },
    { name: "pct2", type: "number" },
  ]);
  assert.deepEqual(r.table.data.map((row) => row.slice(-3)), [
    [90, true, 91],
    [40, false, 41],
    [70, false, 71],
    [null, true, null],
  ]);
  // Media cells pass through untouched (same object).
  assert.equal(r.table.data[0]![4], T.data[0]![4]);
  // The input is not mutated.
  assert.equal(T.data[0]!.length, 5);
});

test("a derived column named like an existing one replaces it in place", () => {
  const r = applyTableOps(T, { derived: [{ name: "score", expr: "id" }] });
  assert.equal(r.table.columns.length, 5);
  assert.deepEqual(r.table.data.map((row) => row[2]), [1, 2, 3, 4]);
});

test("derived errors are reported and the column is left out", () => {
  const r = applyTableOps(T, {
    derived: [
      { name: "bad", expr: "score +" },
      { name: "", expr: "1" },
      { name: "ok", expr: "id * 2" },
    ],
  });
  assert.equal(r.derivedErrors.length, 3);
  assert.ok(r.derivedErrors[0]);
  assert.ok(r.derivedErrors[1]);
  assert.equal(r.derivedErrors[2], null);
  assert.deepEqual(r.table.columns.map((c) => c.name).slice(-1), ["ok"]);
});

test("an unknown column is an error with a suggestion", () => {
  const r = applyTableOps(T, { derived: [{ name: "x", expr: "scor * 2" }], query: "lable == 'cat'" });
  assert.match(r.derivedErrors[0]!, /unknown column 'scor'; did you mean 'score'/);
  assert.match(r.queryError!, /unknown column 'lable'/);
  assert.equal(r.table.data.length, 4);
});

test("query filters rows; it can use derived columns and strings", () => {
  const r = applyTableOps(T, { derived: [{ name: "pct", expr: "score * 100" }], query: "pct > 50 and label == 'cat'" });
  assert.equal(r.queryError, null);
  assert.deepEqual(r.table.data.map((row) => row[0]), [1, 3]);
  const s = applyTableOps(T, { query: "'a' in label" });
  assert.deepEqual(s.table.data.map((row) => row[0]), [1, 3]);
  const n = applyTableOps(T, { query: "label in ['bird', 'dog']" });
  assert.deepEqual(n.table.data.map((row) => row[0]), [2, 4]);
});

test("a null comparison drops the row; a query error keeps every row", () => {
  const r = applyTableOps(T, { query: "score < 0.5" });
  assert.deepEqual(r.table.data.map((row) => row[0]), [2]);
  const e = applyTableOps(T, { query: "score <" });
  assert.ok(e.queryError);
  assert.equal(e.table.data.length, 4);
});

test("axis roots and reserved roots read literal columns", () => {
  const t: TableData = {
    columns: [{ name: "step", type: "number" }, { name: "summary.x", type: "number" }],
    data: [[1, 10], [2, 20]],
  };
  const r = applyTableOps(t, { derived: [{ name: "y", expr: "step + summary.x" }] });
  assert.deepEqual(r.derivedErrors, [null]);
  assert.deepEqual(r.table.data.map((row) => row[2]), [11, 22]);
});

test("group by with every aggregate", () => {
  const r = applyTableOps(T, {
    groupBy: {
      keys: ["label"],
      aggs: [
        { column: "", fn: "count" },
        { column: "score", fn: "count" },
        { column: "score", fn: "mean" },
        { column: "score", fn: "sum" },
        { column: "score", fn: "min" },
        { column: "score", fn: "max" },
        { column: "image", fn: "first" },
        { column: "pred/label", fn: "nunique" },
      ],
    },
  });
  assert.equal(r.groupByError, null);
  assert.deepEqual(r.table.columns.map((c) => c.name), [
    "label", "count", "count(score)", "mean(score)", "sum(score)", "min(score)", "max(score)", "first(image)", "nunique(pred/label)",
  ]);
  assert.equal(r.table.columns[7]!.type, "media");
  assert.deepEqual(r.table.data[0]!.slice(0, 7), ["cat", 2, 2, 0.8, 1.6, 0.7, 0.9]);
  assert.equal(r.table.data[0]![7], T.data[0]![4]);
  assert.equal(r.table.data[0]![8], 2);
  // bird: no numeric score.
  assert.deepEqual(r.table.data[2]!.slice(0, 7), ["bird", 1, 0, null, null, null, null]);
  // Groups keep first-appearance order.
  assert.deepEqual(r.table.data.map((row) => row[0]), ["cat", "dog", "bird"]);
});

test("group by several keys, no keys, and 1 vs '1'", () => {
  const t: TableData = {
    columns: [{ name: "a", type: "other" }, { name: "b", type: "string" }, { name: "v", type: "number" }],
    data: [[1, "x", 1], ["1", "x", 2], [1, "y", 3], [1, "x", 4]],
  };
  const r = applyTableOps(t, { groupBy: { keys: ["a", "b"], aggs: [{ column: "v", fn: "sum" }] } });
  assert.deepEqual(r.table.data, [[1, "x", 5], ["1", "x", 2], [1, "y", 3]]);
  const all = applyTableOps(t, { groupBy: { keys: [], aggs: [{ column: "v", fn: "max" }] } });
  assert.deepEqual(all.table.data, [[4]]);
});

test("group by an unknown column reports and skips", () => {
  const r = applyTableOps(T, { groupBy: { keys: ["nope"], aggs: [{ column: "x", fn: "sum" }] } });
  assert.match(r.groupByError!, /nope, x/);
  assert.equal(r.table, T);
});

test("query runs before group by", () => {
  const r = applyTableOps(T, {
    query: "score > 0.5",
    groupBy: { keys: ["label"], aggs: [{ column: "score", fn: "mean" }] },
  });
  assert.deepEqual(r.table.data, [["cat", 0.8]]);
});

test("aggColumnName", () => {
  assert.equal(aggColumnName({ column: "*", fn: "count" }), "count");
  assert.equal(aggColumnName({ column: "x", fn: "mean" }), "mean(x)");
});

test("an aggregate without a column is skipped (count counts rows)", () => {
  const r = applyTableOps(T, { groupBy: { keys: ["label"], aggs: [{ column: "", fn: "mean" }, { column: "", fn: "count" }] } });
  assert.equal(r.groupByError, null);
  assert.deepEqual(r.table.data, [["cat", 2], ["dog", 1], ["bird", 1]]);
});
