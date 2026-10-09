import { test } from "node:test";
import assert from "node:assert/strict";
import type { TableData } from "./types.ts";
import { moveColumn, nextSort, orderedColumns, pageOf, pageSizeOptions, shownCsv, sortRows, visibleColumns } from "./view.ts";

const t: TableData = {
  columns: [
    { name: "id", type: "number" },
    { name: "label", type: "string" },
    { name: "score", type: "number" },
  ],
  data: [
    [0, "dog", 0.5],
    [1, "Cat", null],
    [2, "bird", 0.9],
    [3, "cat10", 0.5],
    [4, "cat9", 0.1],
  ],
};

test("nextSort: asc, desc, off; another column starts at asc", () => {
  const a = nextSort(null, "x");
  assert.deepEqual(a, { column: "x", direction: "asc" });
  const d = nextSort(a, "x");
  assert.deepEqual(d, { column: "x", direction: "desc" });
  assert.equal(nextSort(d, "x"), null);
  assert.deepEqual(nextSort(d, "y"), { column: "y", direction: "asc" });
});

test("sortRows: numbers numerically, nulls last both ways, ties keep the logged order", () => {
  assert.deepEqual(sortRows(t, { column: "score", direction: "asc" }), [4, 0, 3, 2, 1]);
  assert.deepEqual(sortRows(t, { column: "score", direction: "desc" }), [2, 0, 3, 4, 1]);
  assert.deepEqual(sortRows(t, null), [0, 1, 2, 3, 4]);
  assert.deepEqual(sortRows(t, { column: "nope", direction: "asc" }), [0, 1, 2, 3, 4]);
});

test("sortRows: text case-insensitively in natural order", () => {
  assert.deepEqual(sortRows(t, { column: "label", direction: "asc" }), [2, 1, 4, 3, 0]);
});

test("column order: listed first, the rest as logged; hidden left out", () => {
  assert.deepEqual(orderedColumns(["a", "b", "c"], ["c", "zz", "a"]), ["c", "a", "b"]);
  assert.deepEqual(visibleColumns(t, ["score"], ["id"]), [2, 1]);
  assert.deepEqual(moveColumn(["a", "b", "c"], [], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveColumn(["a", "b", "c"], [], "a", -1), ["a", "b", "c"]);
});

test("pageOf: '1–5 of 5', clamped pages", () => {
  assert.deepEqual(pageOf(5, 0, 10), { from: 0, to: 5, page: 0, pages: 1, label: "1–5 of 5" });
  assert.deepEqual(pageOf(25, 9, 10), { from: 20, to: 25, page: 2, pages: 3, label: "21–25 of 25" });
  assert.equal(pageOf(0, 0, 10).label, "0 of 0");
  assert.deepEqual(pageSizeOptions(30), [10, 25, 30, 50, 100]);
  assert.deepEqual(pageSizeOptions(100), [10, 25, 50, 100]);
});

test("shownCsv: the shown columns in order, every row in display order", () => {
  const csv = shownCsv(t, [2, 0], [2, 1]);
  assert.deepEqual(csv.header, ["score", "label"]);
  assert.deepEqual(csv.rows, [[0.9, "bird"], [0.5, "dog"]]);
});
