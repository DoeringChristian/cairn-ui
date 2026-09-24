/**
 * markdown ⇄ blocks round trips.
 *
 *  - source → blocks → source: hand-authored markdown (nested fences, an
 *    embedded ```cairn example inside prose, back-to-back fences, a
 *    malformed block, no trailing newline, …) serializes back byte-identical.
 *  - blocks → source → blocks: blocks authored in the editor (no prior
 *    source) keep their order, `CardsBlock` ids and card counts.
 *    `MarkdownBlock` ids regenerate on parse, so only their text is checked.
 *  - Adjacent markdown cells stay separate via `CELL_BOUNDARY_MARKER`; these
 *    checks assert block *counts*, since a re-merged cell can still
 *    byte-match (it would just carry the marker inside its own text).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ComparisonCard } from "../comparisons/types.ts";
import { isCardsBlock, isMarkdownBlock, type CardsBlock, type MarkdownBlock, type ReportBlock } from "./types.ts";
import { CELL_BOUNDARY_MARKER, parseReportMarkdown, serializeReportToMarkdown } from "./markdown-source.ts";

function roundTrip(source: string): { blocks: ReportBlock[]; reserialized: string } {
  const parsed = parseReportMarkdown(source);
  return {
    blocks: parsed.blocks,
    reserialized: serializeReportToMarkdown(parsed.blocks, parsed.settings, parsed.rawCairnSource),
  };
}

const SOURCE_CASES: Array<{ name: string; source: string }> = [
  {
    name: "prose, one cairn fence, prose",
    source: `# Report\n\nSome intro text.\n\n\`\`\`cairn\nid: blk1\nruns:\n  ids:\n    - run_a\ncards:\n  - type: scalar\n    metric: loss\n\`\`\`\n\nSome trailing text.`,
  },
  {
    name: "document starts with a cairn fence (no leading prose)",
    source: "```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```\n\nAfter.",
  },
  {
    name: "an embedded ```cairn EXAMPLE inside prose, wrapped in a longer outer fence — must not be extracted",
    source:
      "Here's how to write one:\n\n````markdown\n```cairn\nruns:\n  ids: [run_a]\ncards: []\n```\n````\n\nDone.",
  },
  {
    name: "a real cairn fence directly adjacent to an unrelated python example fence",
    source: "```python\nprint('hi')\n```\n```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```",
  },
  {
    name: "two cairn fences back-to-back, no prose between them",
    source: "```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```\n```cairn\nid: blk2\nruns:\n  ids: []\ncards: []\n```",
  },
  {
    name: "malformed cairn fence (bad YAML) — still round-trips its raw text byte-identically",
    source: "Before.\n\n```cairn\nruns: [this is not a mapping\n```\n\nAfter.",
  },
  {
    name: "no trailing newline after the closing fence",
    source: "```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```",
  },
];

for (const c of SOURCE_CASES) {
  test(`source round trip: ${c.name}`, () => {
    assert.equal(roundTrip(c.source).reserialized, c.source);
  });
}

interface BlocksCase {
  name: string;
  blocks: ReportBlock[];
  settingsByCardId: Record<string, unknown>;
}

const card1: ComparisonCard = { id: "card_1", type: "scalar", series: [{ runId: "run_a", name: "loss" }] };
const card2: ComparisonCard = { id: "card_2", type: "parallel", series: [{ runId: "run_a", name: "Parallel Coordinates" }] };

const BLOCKS_CASES: BlocksCase[] = [
  {
    name: "markdown, cards, markdown — order + cards-block id preserved",
    blocks: [
      { id: "md_1", type: "markdown", text: "# Title\n\nIntro." } satisfies MarkdownBlock,
      { id: "cards_1", type: "cards", runIds: ["run_a"], cards: [card1] } satisfies CardsBlock,
      { id: "md_2", type: "markdown", text: "Outro." } satisfies MarkdownBlock,
    ],
    settingsByCardId: { card_1: { version: 1, yScale: "log" } },
  },
  {
    name: "two adjacent cards blocks, one with a runSelector, one static — both ids preserved",
    blocks: [
      { id: "cards_a", type: "cards", runSelector: { kind: "query", mode: "latest-n", n: 3 }, cards: [] } satisfies CardsBlock,
      { id: "cards_b", type: "cards", runIds: ["run_a"], cards: [card2] } satisfies CardsBlock,
    ],
    settingsByCardId: {},
  },
  {
    name: "two adjacent markdown cells — survive as two independent cells, not merged",
    blocks: [
      { id: "md_a", type: "markdown", text: "Cell A text." } satisfies MarkdownBlock,
      { id: "md_b", type: "markdown", text: "Cell B text." } satisfies MarkdownBlock,
    ],
    settingsByCardId: {},
  },
  {
    name: "three adjacent markdown cells chained — all three survive independently",
    blocks: [
      { id: "md_a", type: "markdown", text: "A" } satisfies MarkdownBlock,
      { id: "md_b", type: "markdown", text: "B" } satisfies MarkdownBlock,
      { id: "md_c", type: "markdown", text: "C" } satisfies MarkdownBlock,
    ],
    settingsByCardId: {},
  },
  {
    name: "single markdown cell — unaffected by the boundary marker",
    blocks: [{ id: "md_1", type: "markdown", text: "Solo cell." } satisfies MarkdownBlock],
    settingsByCardId: {},
  },
];

for (const c of BLOCKS_CASES) {
  test(`blocks round trip: ${c.name}`, () => {
    const md = serializeReportToMarkdown(c.blocks, c.settingsByCardId, {});
    const parsed = parseReportMarkdown(md);
    assert.equal(parsed.blocks.length, c.blocks.length, md);
    c.blocks.forEach((orig, i) => {
      const got = parsed.blocks[i]!;
      if (isCardsBlock(orig)) {
        assert.ok(isCardsBlock(got), `block[${i}] should be cards`);
        assert.equal(got.id, orig.id);
        assert.equal(got.cards.length, orig.cards.length);
      } else {
        assert.ok(isMarkdownBlock(got), `block[${i}] should be markdown`);
        assert.equal(got.text, (orig as MarkdownBlock).text);
      }
    });
  });
}

test("adjacent prose without the marker stays one block", () => {
  const source = "Cell A text.\nCell B text.";
  const { blocks, reserialized } = roundTrip(source);
  assert.equal(blocks.length, 1);
  assert.ok(isMarkdownBlock(blocks[0]!));
  assert.equal(reserialized, source);
});

test("the marker splits prose into two blocks and round-trips byte-identical", () => {
  const source = `Cell A text.${CELL_BOUNDARY_MARKER}\n\nCell B text.`;
  const { blocks, reserialized } = roundTrip(source);
  assert.deepEqual(
    blocks.map((b) => (isMarkdownBlock(b) ? b.text : b.type)),
    ["Cell A text.", "Cell B text."],
  );
  assert.equal(reserialized, source);
});

test("prose + card + prose is three blocks", () => {
  const source = "Intro paragraph.\n\n```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```\n\nOutro paragraph.";
  const { blocks } = roundTrip(source);
  assert.deepEqual(blocks.map((b) => b.type), ["markdown", "cards", "markdown"]);
});

test("a single markdown cell emits no boundary marker", () => {
  const blocks: ReportBlock[] = [{ id: "md_1", type: "markdown", text: "Solo cell." } satisfies MarkdownBlock];
  assert.equal(serializeReportToMarkdown(blocks, {}, {}), "Solo cell.");
});
