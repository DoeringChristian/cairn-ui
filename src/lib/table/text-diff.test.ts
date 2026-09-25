import { test } from "node:test";
import assert from "node:assert/strict";
import { alignReference, diffCell } from "./text-diff.ts";
import type { TableData } from "./types.ts";

const join = (parts: { value: string; op: string }[], op: string) =>
  parts.filter((p) => p.op === "same" || p.op === op).map((p) => p.value).join("");

test("equal cells are one unchanged part (or none when empty)", () => {
  assert.deepEqual(diffCell("abc", "abc"), [{ value: "abc", op: "same" }]);
  assert.deepEqual(diffCell(null, ""), []);
});

test("word diff reconstructs both sides", () => {
  const a = "the quick brown fox";
  const b = "the slow brown dog";
  const parts = diffCell(a, b, "words");
  assert.equal(join(parts, "del"), a);
  assert.equal(join(parts, "add"), b);
  assert.ok(parts.some((p) => p.op === "del" && p.value.includes("quick")));
  assert.ok(parts.some((p) => p.op === "add" && p.value.includes("slow")));
});

test("char and line modes", () => {
  const c = diffCell("kitten", "sitting", "chars");
  assert.equal(join(c, "del"), "kitten");
  assert.equal(join(c, "add"), "sitting");
  const l = diffCell("a\nb\nc\n", "a\nx\nc\n", "lines");
  assert.deepEqual(l, [
    { value: "a\n", op: "same" },
    { value: "b\n", op: "del" },
    { value: "x\n", op: "add" },
    { value: "c\n", op: "same" },
  ]);
});

test("non-strings diff by their text; media by hash", () => {
  assert.deepEqual(diffCell(1, 1), [{ value: "1", op: "same" }]);
  const m = diffCell({ $media: { hash: "aa", mime_type: "" } }, { $media: { hash: "ab", mime_type: "" } }, "chars");
  assert.equal(join(m, "add"), "ab");
});

test("alignReference: by key column, else by position; columns by name", () => {
  const ref: TableData = {
    columns: [{ name: "id", type: "number" }, { name: "text", type: "string" }],
    data: [[1, "one"], [2, "two"]],
  };
  const t: TableData = {
    columns: [{ name: "id", type: "number" }, { name: "extra", type: "string" }, { name: "text", type: "string" }],
    data: [[2, "e", "TWO"], [3, "f", "three"]],
  };
  assert.deepEqual(alignReference(ref, t), [[2, undefined, "two"], [undefined, undefined, undefined]]);
  const noKey: TableData = { columns: [{ name: "text", type: "string" }], data: [["a"], ["b"]] };
  const other: TableData = { columns: [{ name: "text", type: "string" }], data: [["A"], ["B"], ["C"]] };
  assert.deepEqual(alignReference(noKey, other), [["a"], ["b"], [undefined]]);
});
