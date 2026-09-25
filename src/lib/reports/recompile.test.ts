import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReportMarkdown, serializeReportToMarkdown } from "./markdown-source.ts";
import { buildMetricIndex } from "./metric-index.ts";
import { recompileDecision, recompileFailedBlock } from "./recompile.ts";
import { isCardsBlock, type CardsBlock } from "./types.ts";

const INFER = "```cairn\nid: blk1\nruns:\n  ids: [run_a, run_b]\ncards:\n  - metric: loss\n```";
const BAD = "```cairn\nid: blk2\nruns: [oops]\n```";

function cardsBlocks(source: string): CardsBlock[] {
  return parseReportMarkdown(source).blocks.filter(isCardsBlock);
}

const seq = (name: string, object_type = "scalar") =>
  ({ name, object_type, min_step: 0, max_step: 1, count: 2 }) as any;

test("a fence that fails to compile carries its error, body and runs", () => {
  const parsed = parseReportMarkdown(`# R\n\n${INFER}\n\n${BAD}`);
  const [inferred, bad] = parsed.blocks.filter(isCardsBlock);
  assert.match(inferred!.error!, /cannot infer `type` for metric "loss"/);
  assert.equal(inferred!.errorSource, "id: blk1\nruns:\n  ids: [run_a, run_b]\ncards:\n  - metric: loss");
  assert.deepEqual(inferred!.runIds, ["run_a", "run_b"]);
  assert.deepEqual(inferred!.cards, []);
  assert.equal(parsed.errors.blk1, inferred!.error);
  assert.match(bad!.error!, /`runs` must be a mapping/);
  assert.deepEqual(bad!.runIds, []);
});

test("failed fences round-trip unchanged, with or without cached raw text", () => {
  const source = `# R\n\n${INFER}\n\nmid\n\n${BAD}`;
  const parsed = parseReportMarkdown(source);
  assert.equal(serializeReportToMarkdown(parsed.blocks, parsed.settings, parsed.rawCairnSource), source);
  assert.equal(serializeReportToMarkdown(parsed.blocks, parsed.settings, {}), source);
});

test("a compiled fence carries no error", () => {
  const [b] = cardsBlocks("```cairn\nid: b\nruns:\n  ids: [run_a]\ncards:\n  - metric: loss\n    type: scalar\n```");
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
  const r = recompileFailedBlock(failed!, index);
  assert.ok(r.ok);
  assert.equal(r.block.id, "blk1");
  assert.equal(r.block.error, undefined);
  assert.equal(r.block.cards.length, 1);
  assert.equal(r.block.cards[0]!.type, "scalar");
  assert.deepEqual(r.block.cards[0]!.series.map((s) => s.runId), ["run_a", "run_b"]);
});

test("a fence that is really broken stays broken on recompile", () => {
  const [failed] = cardsBlocks(INFER);
  const r = recompileFailedBlock(failed!, buildMetricIndex([{ runId: "run_a", sequences: [seq("acc")] }]));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cannot infer/);
});
