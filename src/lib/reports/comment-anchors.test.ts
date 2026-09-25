import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportBlock } from "./types.ts";
import { anchorKey, cellAnchor, groupThreads, locateAnchor, markdownPlainText, quoteAnchor } from "./comment-anchors.ts";

const blocks: ReportBlock[] = [
  { id: "m0", type: "markdown", text: "# Intro\n\nWe train a **small** model." },
  { id: "c1", type: "cards", runIds: ["r"], cards: [{ id: "card-a", type: "scalar", series: [] }] },
  { id: "m2", type: "markdown", text: "## Results\n\n- The loss *drops* fast.\n- A small model wins." },
  { id: "m3", type: "markdown", text: "No heading here.\nSecond line." },
];

test("cards and blocks by id; markdown cells by heading slug", () => {
  assert.equal(locateAnchor(blocks, { anchor_kind: "card", anchor_id: "card-a", quote: null }), 1);
  assert.equal(locateAnchor(blocks, { anchor_kind: "block", anchor_id: "c1", quote: null }), 1);
  assert.equal(locateAnchor(blocks, { anchor_kind: "block", anchor_id: "#results", quote: null }), 2);
  assert.equal(locateAnchor(blocks, { anchor_kind: "report", anchor_id: null, quote: null }), null);
});

test("gone targets are detached", () => {
  assert.equal(locateAnchor(blocks, { anchor_kind: "card", anchor_id: "nope", quote: null }), null);
  assert.equal(locateAnchor(blocks, { anchor_kind: "block", anchor_id: "#gone", quote: null }), null);
  assert.equal(locateAnchor(blocks, { anchor_kind: "quote", anchor_id: "#intro", quote: "not in the text" }), null);
});

test("quotes match rendered text, preferring the anchored section", () => {
  assert.equal(markdownPlainText("- The loss *drops* fast."), "The loss drops fast.");
  assert.equal(locateAnchor(blocks, { anchor_kind: "quote", anchor_id: "#intro", quote: "a small  model" }), 0);
  assert.equal(locateAnchor(blocks, { anchor_kind: "quote", anchor_id: "#results", quote: "small model" }), 2);
  // The section moved away: still found elsewhere.
  assert.equal(locateAnchor(blocks, { anchor_kind: "quote", anchor_id: "#gone", quote: "loss drops" }), 2);
});

test("anchors made for cells and selections locate back to them", () => {
  for (let i = 0; i < blocks.length; i++) {
    assert.equal(locateAnchor(blocks, cellAnchor(blocks, i)), i);
  }
  assert.deepEqual(cellAnchor(blocks, 3), { anchor_kind: "quote", anchor_id: "#results", quote: "No heading here." });
  const q = quoteAnchor(blocks, 2, "loss drops\nfast");
  assert.deepEqual(q, { anchor_kind: "quote", anchor_id: "#results", quote: "loss drops fast" });
  assert.equal(locateAnchor(blocks, q), 2);
  assert.equal(quoteAnchor([{ id: "x", type: "markdown", text: "plain" }], 0, "plain").anchor_id, "#");
  assert.notEqual(anchorKey(q), anchorKey(cellAnchor(blocks, 2)));
});

test("groupThreads nests replies under roots in time order", () => {
  const c = (id: string, parent_id: string | null, created_at: string) => ({ id, parent_id, created_at });
  const threads = groupThreads([c("r2", null, "3"), c("a", "r1", "2"), c("r1", null, "1"), c("b", "r1", "4"), c("x", "missing", "5")]);
  assert.deepEqual(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)]), [["r1", ["a", "b"]], ["r2", []]]);
});
