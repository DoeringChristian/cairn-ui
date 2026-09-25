import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportBlock } from "./types.ts";
import { buildOutline, collapsedAncestors, headingSlugsByLine, hiddenBlocks, isCollapsible, sectionHeadingAt } from "./outline.ts";

const md = (id: string, text: string): ReportBlock => ({ id, type: "markdown", text });
const cards = (id: string): ReportBlock => ({ id, type: "cards", runIds: [], cards: [] });

// 0: # Intro      1: cards    2: ## Details (+ ### Deep in the same cell)
// 3: cards        4: # Results  5: cards   6: # Results (dup)
const blocks = [
  md("m0", "# Intro\ntext"),
  cards("c1"),
  md("m2", "## Details\n\n### Deep\nmore"),
  cards("c3"),
  md("m4", "# Results"),
  cards("c5"),
  md("m6", "# Results"),
];

test("outline lists headings across cells with unique slugs and block positions", () => {
  const o = buildOutline(blocks);
  assert.deepEqual(
    o.map((h) => [h.slug, h.level, h.blockIndex, h.hideStart, h.hideEnd]),
    [
      ["intro", 1, 0, 1, 4],
      ["details", 2, 2, 3, 4],
      ["deep", 3, 2, 3, 4],
      ["results", 1, 4, 5, 6],
      ["results-1", 1, 6, 7, 7],
    ],
  );
  assert.equal(isCollapsible(o[4]!), false);
});

test("a section ending inside its own cell is not collapsible", () => {
  const o = buildOutline([md("a", "## A\n## B"), cards("c")]);
  assert.equal(isCollapsible(o[0]!), false);
  assert.equal(isCollapsible(o[1]!), true);
});

test("hiddenBlocks unions collapsed ranges; ancestors reveal a hidden cell", () => {
  const o = buildOutline(blocks);
  assert.deepEqual([...hiddenBlocks(o, new Set(["details"]))], [3]);
  assert.deepEqual([...hiddenBlocks(o, new Set(["intro", "results"]))].sort(), [1, 2, 3, 5]);
  assert.deepEqual(collapsedAncestors(o, new Set(["intro", "details"]), 3), ["intro", "details"]);
  assert.deepEqual(collapsedAncestors(o, new Set(["intro"]), 5), []);
});

test("slugs by line and the section heading of a cell", () => {
  const o = buildOutline(blocks);
  assert.deepEqual([...headingSlugsByLine(o, "m2")], [[0, "details"], [2, "deep"]]);
  assert.equal(sectionHeadingAt(o, 3)!.slug, "deep");
  assert.equal(sectionHeadingAt(o, 0)!.slug, "intro");
  assert.equal(sectionHeadingAt(buildOutline([cards("c"), md("m", "# A")]), 0), undefined);
});
