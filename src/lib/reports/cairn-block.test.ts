/**
 * Per-card settings and card structure survive the ```cairn dialect:
 *   serializeCairnSpec → stringifyCairnSpec → parseCairnSpec → compileCairnBlock
 * must give back an equivalent card and settings. `metricIndexRuns` stands in
 * for a live `/api/{run}/sequences` fetch — it supplies the `object_type` of
 * a re-parsed `metric:`-form card (see cairn-block.ts's `selectionForCard`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SequenceMeta } from "../../api/types.ts";
import type { ComparisonCard } from "../comparisons/types.ts";
import { compileCairnBlock, parseCairnSpec, serializeCairnSpec, stringifyCairnSpec } from "./cairn-block.ts";
import { buildMetricIndex } from "./metric-index.ts";
import type { CardsBlock } from "./types.ts";

function seqFixture(runId: string, name: string): { runId: string; sequences: SequenceMeta[] } {
  return {
    runId,
    sequences: [{ name, object_type: "scalar", min_step: 0, max_step: 10, count: 11 }],
  };
}

interface Case {
  name: string;
  runIds: string[];
  card: ComparisonCard;
  settings: Record<string, unknown>;
  /** Fixture sequences per run, standing in for a live metricIndex fetch. */
  metricIndexRuns: Array<{ runId: string; sequences: SequenceMeta[] }>;
}

const CASES: Case[] = [
  {
    name: "scalar card: log y-scale + smoothing, two runs",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_scalar_1",
      type: "scalar",
      series: [
        { runId: "run_a", name: "train/loss" },
        { runId: "run_b", name: "train/loss" },
      ],
    },
    settings: { version: 1, yScale: "log", smoothing: 0.6 },
    metricIndexRuns: [
      { runId: "run_a", sequences: [{ name: "train/loss", object_type: "scalar", min_step: 0, max_step: 100, count: 101 }] },
      { runId: "run_b", sequences: [{ name: "train/loss", object_type: "scalar", min_step: 0, max_step: 100, count: 101 }] },
    ],
  },
  {
    name: "image card: external per-run reference/diff baseline",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_image_1",
      type: "image",
      series: [
        { runId: "run_a", name: "prediction" },
        { runId: "run_b", name: "prediction" },
      ],
    },
    settings: {
      version: 1,
      reference: { source: "external", externalScope: "per-run" },
    },
    metricIndexRuns: [
      { runId: "run_a", sequences: [{ name: "prediction", object_type: "image", min_step: 0, max_step: 10, count: 11 }] },
      { runId: "run_b", sequences: [{ name: "prediction", object_type: "image", min_step: 0, max_step: 10, count: 11 }] },
    ],
  },
  {
    name: "multi-run card: parallel coordinates over 3 runs",
    runIds: ["run_a", "run_b", "run_c"],
    card: {
      id: "card_parallel_1",
      type: "parallel",
      // Multi-run cards' series[].name is always MULTI_RUN_CARD_LABELS[type]
      // (see cardFromSpec's multi-run branch) — cosmetic, not a real metric.
      series: [
        { runId: "run_a", name: "Parallel Coordinates" },
        { runId: "run_b", name: "Parallel Coordinates" },
        { runId: "run_c", name: "Parallel Coordinates" },
      ],
    },
    settings: { version: 1, axes: ["lr", "batch_size", "final/loss"] },
    metricIndexRuns: [],
  },
  {
    name: "scalar card: metric only on a subset of block runs → falls back to explicit series",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_scalar_2",
      type: "scalar",
      series: [{ runId: "run_a", name: "val/accuracy" }],
    },
    settings: { version: 1, yScale: "linear" },
    metricIndexRuns: [
      { runId: "run_a", sequences: [{ name: "val/accuracy", object_type: "scalar", min_step: 0, max_step: 5, count: 6 }] },
    ],
  },
];

function seriesKeys(card: ComparisonCard): string[] {
  return [...new Set(card.series.map((s) => `${s.runId}::${s.name}`))].sort();
}

for (const c of CASES) {
  test(`round trip: ${c.name}`, () => {
    const block: CardsBlock = { id: "blk_test", type: "cards", runIds: c.runIds, cards: [c.card] };
    const yamlText = stringifyCairnSpec(serializeCairnSpec(block, { [c.card.id]: c.settings }));
    const compiled = compileCairnBlock(parseCairnSpec(yamlText), buildMetricIndex(c.metricIndexRuns));

    const newCard = compiled.block.cards[0];
    assert.ok(newCard, `no card produced from:\n${yamlText}`);
    assert.equal(newCard.type, c.card.type);
    assert.deepEqual(seriesKeys(newCard), seriesKeys(c.card));
    assert.deepEqual(compiled.settings[newCard.id], c.settings);
    assert.deepEqual([...(compiled.block.runIds ?? [])].sort(), [...c.runIds].sort());
  });
}

// A `runs.selector` block compiles against the run ids its caller resolved
// (`opts.resolvedRunIds`); a static `runs.ids` block ignores them.
const SELECTOR_YAML = `
runs:
  selector:
    mode: newest-per-name
cards:
  - metric: train/loss
    type: scalar
`;

test("runs.selector + resolvedRunIds compiles a series over the resolved runs", () => {
  const metricIndex = buildMetricIndex([seqFixture("run_x", "train/loss"), seqFixture("run_y", "train/loss")]);
  const compiled = compileCairnBlock(parseCairnSpec(SELECTOR_YAML), metricIndex, { resolvedRunIds: ["run_x", "run_y"] });
  const card = compiled.block.cards[0];
  assert.ok(card);
  assert.ok(compiled.block.runSelector);
  assert.equal(compiled.block.runIds, undefined);
  assert.deepEqual([...new Set(card.series.map((s) => s.runId))].sort(), ["run_x", "run_y"]);
});

test("runs.selector without resolvedRunIds compiles to an empty series", () => {
  const compiled = compileCairnBlock(parseCairnSpec(SELECTOR_YAML), buildMetricIndex([]));
  const card = compiled.block.cards[0];
  assert.ok(card);
  assert.equal(card.series.length, 0);
});

test("static runs.ids ignores resolvedRunIds", () => {
  const staticYaml = `
runs:
  ids: [run_a, run_b]
cards:
  - metric: train/loss
    type: scalar
`;
  const metricIndex = buildMetricIndex([seqFixture("run_a", "train/loss"), seqFixture("run_b", "train/loss")]);
  const compiled = compileCairnBlock(parseCairnSpec(staticYaml), metricIndex, { resolvedRunIds: ["run_x", "run_y"] });
  const card = compiled.block.cards[0];
  assert.ok(card);
  assert.deepEqual([...new Set(card.series.map((s) => s.runId))].sort(), ["run_a", "run_b"]);
});

// The cell's run view (runs.hidden/pinned/baseline) survives the fence.
test("runs view round trip: hidden, pinned, baseline", () => {
  const card: ComparisonCard = {
    id: "card_rv",
    type: "scalar",
    series: [
      { runId: "run_a", name: "loss" },
      { runId: "run_b", name: "loss" },
      { runId: "run_c", name: "loss" },
    ],
  };
  const block: CardsBlock = {
    id: "blk_rv",
    type: "cards",
    runIds: ["run_a", "run_b", "run_c"],
    runView: { hidden: ["run_b"], pinned: ["run_c"], baseline: "run_a" },
    cards: [card],
  };
  const yamlText = stringifyCairnSpec(serializeCairnSpec(block));
  assert.match(yamlText, /hidden:\n\s+- run_b/);
  assert.match(yamlText, /baseline: run_a/);
  const compiled = compileCairnBlock(parseCairnSpec(yamlText), buildMetricIndex([]));
  assert.deepEqual(compiled.block.runView, block.runView);
  assert.deepEqual(compiled.block.runIds, block.runIds);

  // An empty view writes nothing and reads back as absent.
  const plain = stringifyCairnSpec(serializeCairnSpec({ ...block, runView: { hidden: [], pinned: [], baseline: null } }));
  assert.doesNotMatch(plain, /hidden|pinned|baseline/);
  assert.equal(compileCairnBlock(parseCairnSpec(plain), buildMetricIndex([])).block.runView, undefined);
});

test("runs view is validated", () => {
  assert.throws(
    () => compileCairnBlock(parseCairnSpec("runs:\n  ids: [a]\n  hidden: a\n"), buildMetricIndex([])),
    /runs.hidden must be a list/,
  );
  assert.throws(
    () => compileCairnBlock(parseCairnSpec("runs:\n  ids: [a]\n  baseline: [a]\n"), buildMetricIndex([])),
    /runs.baseline must be a run-id string/,
  );
  const sel = compileCairnBlock(
    parseCairnSpec("runs:\n  selector: { mode: latest-n, n: 2 }\n  pinned: [x]\n"),
    buildMetricIndex([]),
    { resolvedRunIds: ["x", "y"] },
  );
  assert.deepEqual(sel.block.runView, { hidden: [], pinned: ["x"], baseline: null });
});
