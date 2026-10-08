import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReportMarkdown, serializeReportToMarkdown } from "./markdown-source.ts";
import { buildMetricIndex } from "./metric-index.ts";
import { recompileDecision, recompileFailedBlock } from "./recompile.ts";
import { isCardsBlock, type CardsBlock } from "./types.ts";

const INFER = "```cairn\nid: blk1\nrunSets:\n  - name: Main\ncards:\n  - metric: loss\n```";
const BAD = "```cairn\nid: blk2\nrunSets: oops\n```";

function cardsBlocks(source: string): CardsBlock[] {
  return parseReportMarkdown(source).blocks.filter(isCardsBlock);
}

const seq = (name: string, object_type = "scalar") =>
  ({ name, object_type, min_step: 0, max_step: 1, count: 2 }) as any;

test("a fence that fails to compile carries its error, body and runs", () => {
  const parsed = parseReportMarkdown(`# R\n\n${INFER}\n\n${BAD}`);
  const [inferred, bad] = parsed.blocks.filter(isCardsBlock);
  assert.match(inferred!.error!, /cannot infer `type` for metric "loss"/);
  assert.equal(inferred!.errorSource, "id: blk1\nrunSets:\n  - name: Main\ncards:\n  - metric: loss");
  assert.deepEqual(inferred!.runSets.map((s) => s.name), ["Main"]);
  assert.deepEqual(inferred!.cards, []);
  assert.equal(parsed.errors.blk1, inferred!.error);
  assert.match(bad!.error!, /`runSets` must be a list/);
  assert.deepEqual(bad!.runSets, []);
});

test("failed fences round-trip unchanged, with or without cached raw text", () => {
  const source = `# R\n\n${INFER}\n\nmid\n\n${BAD}`;
  const parsed = parseReportMarkdown(source);
  assert.equal(serializeReportToMarkdown(parsed.blocks, parsed.settings, parsed.rawCairnSource), source);
  assert.equal(serializeReportToMarkdown(parsed.blocks, parsed.settings, {}), source);
});

test("a compiled fence carries no error", () => {
  const [b] = cardsBlocks("```cairn\nid: b\nrunSets: [{ name: s }]\ncards:\n  - metric: loss\n    type: scalar\n```");
  assert.equal(b!.error, undefined);
  assert.equal(b!.errorSource, undefined);
});

test("recompileDecision", () => {
  const failed = { error: "x", errorSource: "cards: []" };
  const base = { block: failed, runIds: ["a"], runsResolved: true, indexLoading: false };
  assert.equal(recompileDecision(base), "recompile");
  assert.equal(recompileDecision({ ...base, indexLoading: true }), "wait");
  assert.equal(recompileDecision({ ...base, runsResolved: false }), "wait");
  assert.equal(recompileDecision({ ...base, runIds: [] }), "none");
  assert.equal(recompileDecision({ ...base, block: {} }), "none");
  assert.equal(recompileDecision({ ...base, block: { error: "x" } }), "none");
});

test("recompiling once the metric index is loaded infers the type and keeps the id", () => {
  const [failed] = cardsBlocks(INFER);
  const index = buildMetricIndex([
    { runId: "run_a", sequences: [seq("loss")] },
    { runId: "run_b", sequences: [seq("loss")] },
  ]);
  const r = recompileFailedBlock(failed!, index, ["run_a", "run_b"]);
  assert.ok(r.ok);
  assert.equal(r.block.id, "blk1");
  assert.equal(r.block.error, undefined);
  assert.equal(r.block.cards.length, 1);
  assert.equal(r.block.cards[0]!.type, "scalar");
  assert.deepEqual(r.block.cards[0]!.series.map((s) => s.runId), ["run_a", "run_b"]);
});

test("a fence that is really broken stays broken on recompile", () => {
  const [failed] = cardsBlocks(INFER);
  const r = recompileFailedBlock(failed!, buildMetricIndex([{ runId: "run_a", sequences: [seq("acc")] }]), ["run_a"]);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cannot infer/);
});
