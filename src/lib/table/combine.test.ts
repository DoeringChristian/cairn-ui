import { test } from "node:test";
import assert from "node:assert/strict";
import { concatTables, defaultJoinKey, joinTables, suffixedPairs } from "./combine.ts";
import type { TableData } from "./types.ts";

const img = (h: string) => ({ $media: { hash: h, mime_type: "image/png" } });

const L: TableData = {
  columns: [{ name: "id", type: "number" }, { name: "pred", type: "string" }, { name: "score", type: "number" }],
  data: [[1, "cat", 0.9], [2, "dog", 0.4], [3, "cat", 0.7]],
};
const R: TableData = {
  columns: [{ name: "id", type: "number" }, { name: "score", type: "number" }, { name: "image", type: "media" }],
  data: [[2, 0.5, img("b")], [3, 0.6, img("c")], [4, 0.1, img("d")]],
};

test("concat unions columns, fills nulls, labels sources", () => {
  const c = concatTables([L, R], { labels: ["a", "b"] });
  assert.deepEqual(c.columns.map((x) => `${x.name}:${x.type}`), ["source:string", "id:number", "pred:string", "score:number", "image:media"]);
  assert.equal(c.data.length, 6);
  assert.deepEqual(c.data[0], ["a", 1, "cat", 0.9, null]);
  assert.deepEqual(c.data[3]!.slice(0, 4), ["b", 2, null, 0.5]);
  assert.equal(c.data[3]![4], R.data[0]![2]);
  const plain = concatTables([L, L]);
  assert.equal(plain.columns.length, 3);
  assert.equal(plain.data.length, 6);
});

test("concat: a source column name that clashes gets a free name; types merge", () => {
  const t: TableData = { columns: [{ name: "source", type: "number" }], data: [[1]] };
  const u: TableData = { columns: [{ name: "source", type: "string" }], data: [["x"]] };
  const c = concatTables([t, u], { labels: ["a", "b"] });
  assert.deepEqual(c.columns, [{ name: "source_", type: "string" }, { name: "source", type: "other" }]);
});

test("default join key: shared id-like first column", () => {
  assert.equal(defaultJoinKey(L, R), "id");
  const noKey: TableData = { columns: [{ name: "x", type: "number" }], data: [] };
  assert.equal(defaultJoinKey(noKey, noKey), null);
});

test("inner, left and outer joins; name collisions get suffixes", () => {
  const inner = joinTables(L, R);
  assert.deepEqual(inner.columns.map((c) => c.name), ["id", "pred", "score_1", "score_2", "image"]);
  assert.deepEqual(inner.data.map((r) => r.slice(0, 4)), [[2, "dog", 0.4, 0.5], [3, "cat", 0.7, 0.6]]);
  assert.equal(inner.data[0]![4], R.data[0]![2]);

  const left = joinTables(L, R, { how: "left" });
  assert.deepEqual(left.data.map((r) => r.slice(0, 5)), [
    [1, "cat", 0.9, null, null],
    [2, "dog", 0.4, 0.5, R.data[0]![2]],
    [3, "cat", 0.7, 0.6, R.data[1]![2]],
  ]);

  const outer = joinTables(L, R, { how: "outer", suffixes: ["_a", "_b"] });
  assert.deepEqual(outer.columns.map((c) => c.name), ["id", "pred", "score_a", "score_b", "image"]);
  assert.equal(outer.data.length, 4);
  assert.deepEqual(outer.data[3]!.slice(0, 4), [4, null, null, 0.1]);
});

test("duplicate keys give every matching pair", () => {
  const l: TableData = { columns: [{ name: "k", type: "string" }, { name: "a", type: "number" }], data: [["x", 1], ["x", 2], ["y", 3]] };
  const r: TableData = { columns: [{ name: "k", type: "string" }, { name: "b", type: "number" }], data: [["x", 10], ["x", 20], ["z", 30]] };
  const j = joinTables(l, r, { on: "k", how: "outer" });
  assert.deepEqual(j.data, [
    ["x", 1, 10], ["x", 1, 20], ["x", 2, 10], ["x", 2, 20], ["y", 3, null], ["z", null, 30],
  ]);
});

test("null keys never match; 1 and '1' differ", () => {
  const l: TableData = { columns: [{ name: "k", type: "other" }, { name: "a", type: "number" }], data: [[null, 1], [1, 2], ["1", 3]] };
  const r: TableData = { columns: [{ name: "k", type: "other" }, { name: "b", type: "number" }], data: [[null, 10], ["1", 20]] };
  const j = joinTables(l, r, { on: "k", how: "left" });
  assert.deepEqual(j.data, [[null, 1, null], [1, 2, null], ["1", 3, 20]]);
});

test("missing key columns throw", () => {
  assert.throws(() => joinTables(L, R, { on: "pred" }), /right table has no column 'pred'/);
  assert.throws(() => joinTables(L, R, { on: ["id", "image"] }), /left table has no column 'image'/);
});

test("multi-column keys", () => {
  const l: TableData = { columns: [{ name: "a", type: "number" }, { name: "b", type: "number" }, { name: "v", type: "number" }], data: [[1, 1, 5], [1, 2, 6]] };
  const r: TableData = { columns: [{ name: "b", type: "number" }, { name: "a", type: "number" }, { name: "v", type: "number" }], data: [[2, 1, 7]] };
  const j = joinTables(l, r, { on: ["a", "b"] });
  assert.deepEqual(j.columns.map((c) => c.name), ["a", "b", "v_1", "v_2"]);
  assert.deepEqual(j.data, [[1, 2, 6, 7]]);
});

test("no key: join by position", () => {
  const l: TableData = { columns: [{ name: "x", type: "number" }], data: [[1], [2], [3]] };
  const r: TableData = { columns: [{ name: "x", type: "number" }], data: [[10], [20]] };
  assert.deepEqual(joinTables(l, r, { how: "left" }).data, [[1, 10], [2, 20], [3, null]]);
});

test("a suffixed name that is already taken is made free", () => {
  const l: TableData = { columns: [{ name: "id", type: "number" }, { name: "s", type: "number" }, { name: "s_2", type: "number" }], data: [[1, 1, 2]] };
  const r: TableData = { columns: [{ name: "id", type: "number" }, { name: "s", type: "number" }], data: [[1, 3]] };
  const j = joinTables(l, r);
  assert.deepEqual(j.columns.map((c) => c.name), ["id", "s_1", "s_2", "s_2_2"]);
  assert.deepEqual(j.data, [[1, 1, 2, 3]]);
});

test("suffixedPairs finds joined twins", () => {
  const j = joinTables(L, R);
  assert.deepEqual(suffixedPairs(j), [[2, 3]]);
});
