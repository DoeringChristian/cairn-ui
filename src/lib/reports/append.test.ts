import { test } from "node:test";
import assert from "node:assert/strict";
import type { CardsBlock } from "./types.ts";
import { appendCardsFence } from "./append.ts";
import { parseReportMarkdown } from "./markdown-source.ts";
import { parseCairnSpec } from "./cairn-block.ts";

const block: CardsBlock = {
  id: "blk1",
  type: "cards",
  runIds: ["r1"],
  cards: [{ id: "card1", type: "scalar", series: [{ runId: "r1", name: "train/loss" }] }],
};

test("existing bytes are a prefix of the result, whatever the ending", () => {
  const sources = [
    "",
    "# T",
    "# T\n",
    "# T\n\n",
    "odd  spacing\t\r\n  kept​",
    "```cairn\nid: x\n# a comment the parser would drop\ncards: []\n```",
  ];
  for (const src of sources) {
    const out = appendCardsFence(src, block);
    assert.ok(out.startsWith(src), JSON.stringify(src));
    assert.ok(out.endsWith("```\n"));
  }
});

test("the appended fence parses as the block, with settings inline", () => {
  const out = appendCardsFence("# Report\n\nIntro.", block, { card1: { yScale: "log" } });
  const parsed = parseReportMarkdown(out);
  assert.equal(parsed.blocks.length, 2);
  const cards = parsed.blocks[1] as CardsBlock;
  assert.equal(cards.id, "blk1");
  assert.equal(cards.cards[0]!.id, "card1");
  assert.deepEqual(parsed.settings, { card1: { yScale: "log" } });
  const fenceBody = out.slice(out.indexOf("```cairn\n") + 9, out.lastIndexOf("```"));
  assert.deepEqual(parseCairnSpec(fenceBody).cards![0]!.settings, { yScale: "log" });
});

test("a blank line separates the fence from prose", () => {
  assert.match(appendCardsFence("text", block), /^text\n\n```cairn\n/);
  assert.match(appendCardsFence("text\n", block), /^text\n\n```cairn\n/);
  assert.match(appendCardsFence("text\n\n", block), /^text\n\n```cairn\n/);
});

test("an unclosed fence is closed first so the new fence stays a cell", () => {
  const src = "intro\n````python\nx = 1";
  const out = appendCardsFence(src, block);
  assert.ok(out.startsWith(src));
  const parsed = parseReportMarkdown(out);
  assert.equal(parsed.blocks.filter((b) => b.type === "cards").length, 1);
});
