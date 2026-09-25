import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSections } from "./sections.ts";

const S = [
  { name: "Charts", items: ["z", "a"] },
  { name: "train", items: ["train.b", "train.a"] },
  { name: "val", items: ["val.10", "val.9"] },
];

test("no prefs keeps the order", () => {
  assert.deepEqual(orderSections(S, { pinned: [], sort: [] }, (x) => x), S);
});

test("pinned sections come first in pin order; unknown pins are ignored", () => {
  const out = orderSections(S, { pinned: ["val", "gone", "train"], sort: [] }, (x) => x);
  assert.deepEqual(out.map((s) => s.name), ["val", "train", "Charts"]);
});

test("sorted sections sort their items A–Z, numerically", () => {
  const out = orderSections(S, { pinned: [], sort: ["val", "Charts"] }, (x) => x);
  assert.deepEqual(out[0]!.items, ["a", "z"]);
  assert.deepEqual(out[1]!.items, ["train.b", "train.a"]);
  assert.deepEqual(out[2]!.items, ["val.9", "val.10"]);
  assert.deepEqual(S[0]!.items, ["z", "a"]);
});
