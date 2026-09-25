import { test } from "node:test";
import assert from "node:assert/strict";
import { BINARY, fileText, mergeTrees, toSplitRows, toUnifiedRows, type UnifiedRow } from "./source-diff.ts";

const lines = (n: number, edit?: Record<number, string>) =>
  Array.from({ length: n }, (_, i) => edit?.[i + 1] ?? `line ${i + 1}`).join("\n") + "\n";

/** A compact picture of unified rows: " x", "-x", "+x", "…N". */
const pic = (rows: UnifiedRow[]) =>
  rows.map((r) => (r.kind === "skip" ? `…${r.count}` : `${r.op === "add" ? "+" : r.op === "del" ? "-" : " "}${r.text}`));

test("mergeTrees: statuses left → right, sorted by path", () => {
  const merged = mergeTrees(
    [
      { path: "b.py", sha256: "1" },
      { path: "a.py", sha256: "2" },
      { path: "gone.py", sha256: "3" },
    ],
    [
      { path: "a.py", sha256: "2" },
      { path: "b.py", sha256: "9" },
      { path: "new.py", sha256: "4" },
    ],
  );
  assert.deepEqual(
    merged.map((f) => [f.path, f.status]),
    [
      ["a.py", "unchanged"],
      ["b.py", "modified"],
      ["gone.py", "removed"],
      ["new.py", "added"],
    ],
  );
  assert.equal(merged[2]!.rightSha, undefined);
  assert.equal(merged[3]!.leftSha, undefined);
});

test("context collapses unchanged stretches around a change", () => {
  const r = toUnifiedRows(lines(20), lines(20, { 10: "changed" }), 2);
  assert.deepEqual(pic(r.rows), ["…7", " line 8", " line 9", "-line 10", "+changed", " line 11", " line 12", "…8"]);
  assert.equal(r.added, 1);
  assert.equal(r.removed, 1);
  const first = r.rows[0]!;
  assert.ok(first.kind === "skip" && first.aStart === 1 && first.bStart === 1);
  const last = r.rows[r.rows.length - 1]!;
  assert.ok(last.kind === "skip" && last.aStart === 13 && last.bStart === 13);
});

test("nearby changes share one hunk; a one-line gap is shown, not skipped", () => {
  const r = toUnifiedRows(lines(12), lines(12, { 3: "x", 7: "y" }), 1);
  // Lines 4 and 6 are context of the changes; line 5 alone would be a skip of 1.
  assert.deepEqual(pic(r.rows), [
    " line 1", " line 2", "-line 3", "+x", " line 4", " line 5", " line 6", "-line 7", "+y", " line 8", "…4",
  ]);
});

test("context 0 shows only changes; Infinity shows the whole file", () => {
  assert.deepEqual(pic(toUnifiedRows(lines(5), lines(5, { 3: "x" }), 0).rows), ["…2", "-line 3", "+x", "…2"]);
  assert.equal(toUnifiedRows(lines(5), lines(5, { 3: "x" }), Infinity).rows.length, 6);
});

test("identical files collapse to a single skip", () => {
  assert.deepEqual(pic(toUnifiedRows(lines(10), lines(10), 3).rows), ["…10"]);
});

test("an added file is all additions; a removed file all deletions", () => {
  const added = toUnifiedRows(null, "a\nb\n", 3);
  assert.deepEqual(pic(added.rows), ["+a", "+b"]);
  assert.deepEqual([added.added, added.removed], [2, 0]);
  const removed = toSplitRows("a\nb\n", null, 3);
  assert.deepEqual(removed.rows, [
    { kind: "pair", left: { line: 1, text: "a", op: "del" }, right: null },
    { kind: "pair", left: { line: 2, text: "b", op: "del" }, right: null },
  ]);
  assert.equal(removed.removed, 2);
});

test("binary on either side gives no rows", () => {
  for (const [a, b] of [[BINARY, "x\n"], ["x\n", BINARY], [BINARY, null]] as const) {
    assert.deepEqual(toUnifiedRows(a, b, 3), { binary: true, rows: [], added: 0, removed: 0 });
    assert.equal(toSplitRows(a, b, 3).binary, true);
  }
  assert.deepEqual(fileText({ path: "x", encoding: "base64", content: "AAE=" }), BINARY);
  assert.equal(fileText({ path: "x", encoding: "utf-8", content: "hi" }), "hi");
  assert.equal(fileText(undefined), null);
});

test("split rows pair removed with added lines and pad the shorter side", () => {
  const r = toSplitRows("a\nb\nc\nd\n", "a\nX\nY\nZ\nd\n", Infinity);
  assert.deepEqual(r.rows, [
    { kind: "pair", left: { line: 1, text: "a", op: "context" }, right: { line: 1, text: "a", op: "context" } },
    { kind: "pair", left: { line: 2, text: "b", op: "del" }, right: { line: 2, text: "X", op: "add" } },
    { kind: "pair", left: { line: 3, text: "c", op: "del" }, right: { line: 3, text: "Y", op: "add" } },
    { kind: "pair", left: null, right: { line: 4, text: "Z", op: "add" } },
    { kind: "pair", left: { line: 4, text: "d", op: "context" }, right: { line: 5, text: "d", op: "context" } },
  ]);
});

test("split rows keep the same skips as unified rows", () => {
  const a = lines(30);
  const b = lines(30, { 15: "mid" });
  const u = toUnifiedRows(a, b, 3).rows.filter((r) => r.kind === "skip");
  const s = toSplitRows(a, b, 3).rows.filter((r) => r.kind === "skip");
  assert.deepEqual(s, u);
});
