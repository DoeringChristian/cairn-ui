import { test } from "node:test";
import assert from "node:assert/strict";
import { compareValues, removeSortKey, sortBy, toggleSort, type SortKey } from "./sort.ts";

test("toggleSort: click replaces or flips, shift-click adds or flips a key", () => {
  let s: SortKey[] = [{ column: "created_at", direction: "desc" }];
  s = toggleSort(s, "created_at", false);
  assert.deepEqual(s, [{ column: "created_at", direction: "asc" }]);
  s = toggleSort(s, "value:acc", false);
  assert.deepEqual(s, [{ column: "value:acc", direction: "asc" }]);
  s = toggleSort(s, "param:lr", true);
  assert.deepEqual(s, [
    { column: "value:acc", direction: "asc" },
    { column: "param:lr", direction: "asc" },
  ]);
  s = toggleSort(s, "value:acc", true);
  assert.deepEqual(s[0], { column: "value:acc", direction: "desc" });
  assert.equal(s.length, 2);
  // A plain click on a key of a multi-sort keeps its direction and drops the others.
  assert.deepEqual(toggleSort(s, "param:lr", false), [{ column: "param:lr", direction: "asc" }]);
  assert.deepEqual(toggleSort([], "created_at", true), [{ column: "created_at", direction: "desc" }]);
  assert.deepEqual(removeSortKey(s, "value:acc"), [{ column: "param:lr", direction: "asc" }]);
});

test("sortBy: multi-key, missing last in both directions, id tiebreak", () => {
  const rows = [
    { id: "a", g: "x", v: 3 },
    { id: "b", g: "y", v: null },
    { id: "c", g: "x", v: 1 },
    { id: "d", g: "y", v: 2 },
    { id: "e", g: "x", v: 1 },
    { id: "f", g: null, v: 5 },
  ];
  const by = (sort: SortKey[]) =>
    sortBy(rows, sort, (r, c) => (r as Record<string, unknown>)[c], (r) => r.id).map((r) => r.id);
  assert.deepEqual(by([{ column: "v", direction: "asc" }]), ["c", "e", "d", "a", "f", "b"]);
  assert.deepEqual(by([{ column: "v", direction: "desc" }]), ["f", "a", "d", "c", "e", "b"]);
  assert.deepEqual(by([{ column: "g", direction: "asc" }, { column: "v", direction: "desc" }]), ["a", "c", "e", "d", "b", "f"]);
  assert.deepEqual(by([]), ["a", "b", "c", "d", "e", "f"]);
});

test("compareValues: numbers numerically, bools as numbers, text numeric-aware, numbers first", () => {
  assert.ok(compareValues(2, 10) < 0);
  assert.ok(compareValues("run-2", "run-10") < 0);
  assert.ok(compareValues("Adam", "adam") === 0);
  assert.ok(compareValues(true, 0) > 0);
  assert.ok(compareValues(5, "a") < 0);
  assert.ok(compareValues(["a"], ["b"]) < 0);
});
