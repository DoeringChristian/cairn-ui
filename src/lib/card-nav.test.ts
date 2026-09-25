import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenNavOrder, navId, navNeighbours } from "./card-nav-order.ts";

test("grids flatten in page order, unplaced grids last", () => {
  const order = flattenNavOrder<number>(
    [
      ["b", { el: 2, keys: ["b1", "b2"] }],
      ["x", { el: null, keys: ["x1"] }],
      ["a", { el: 1, keys: ["a1"] }],
    ],
    (p, q) => p - q,
  );
  assert.deepEqual(order, [navId("a", "a1"), navId("b", "b1"), navId("b", "b2"), navId("x", "x1")]);
});

test("neighbours skip entries that cannot open; no wrap-around", () => {
  const order = ["a", "b", "c", "d"];
  const open = new Set(["a", "c", "d"]);
  assert.deepEqual(navNeighbours(order, "c", (k) => open.has(k)), { prev: "a", next: "d" });
  assert.deepEqual(navNeighbours(order, "a", (k) => open.has(k)), { prev: null, next: "c" });
  assert.deepEqual(navNeighbours(order, "d", (k) => open.has(k)), { prev: "c", next: null });
  assert.deepEqual(navNeighbours(order, "zz", () => true), { prev: null, next: null });
});
