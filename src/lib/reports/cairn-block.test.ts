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
import { CairnLegacyRunsError, compileCairnBlock, parseCairnSpec, serializeCairnSpec, stringifyCairnSpec } from "./cairn-block.ts";
import { runSetOfIds } from "../run-sets.ts";
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
    name: "manual overlay of two metrics stays an explicit series",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_overlay_1",
      type: "scalar",
      series: [
        { runId: "run_a", name: "val/accuracy" },
        { runId: "run_b", name: "train/accuracy" },
      ],
    },
    settings: { version: 1, yScale: "linear" },
    metricIndexRuns: [],
  },
];

function seriesKeys(card: ComparisonCard): string[] {
  return [...new Set(card.series.map((s) => `${s.runId}::${s.name}`))].sort();
}

for (const c of CASES) {
  test(`round trip: ${c.name}`, () => {
    const block: CardsBlock = { id: "blk_test", type: "cards", runSets: [runSetOfIds(c.runIds)], cards: [c.card] };
    const yamlText = stringifyCairnSpec(serializeCairnSpec(block, { [c.card.id]: c.settings }));
    const compiled = compileCairnBlock(parseCairnSpec(yamlText), buildMetricIndex(c.metricIndexRuns), { resolvedRunIds: c.runIds });

    const newCard = compiled.block.cards[0];
    assert.ok(newCard, `no card produced from:\n${yamlText}`);
    assert.equal(newCard.type, c.card.type);
    assert.deepEqual(seriesKeys(newCard), seriesKeys(c.card));
    assert.deepEqual(compiled.settings[newCard.id], c.settings);
    assert.deepEqual(compiled.block.runSets, block.runSets);
  });
}

// A cell compiles against the run ids its caller resolved from its run sets
// (`opts.resolvedRunIds`); without them its cards have no series.
const RUN_SETS_YAML = `
runSets:
  - name: Train runs
    filter: { kind: group, op: and, children: [{ kind: chip, field: job_type, op: exact, arg: train }] }
    groupBy: [{ source: group }]
    latestOnly: true
cards:
  - metric: train/loss
    type: scalar
`;

test("run sets parse leniently, with defaults", () => {
  const compiled = compileCairnBlock(parseCairnSpec(RUN_SETS_YAML), buildMetricIndex([]));
  assert.deepEqual(compiled.block.runSets, [
    {
      name: "Train runs",
      filter: { kind: "group", op: "and", children: [{ kind: "chip", field: "job_type", op: "exact", arg: "train" }] },
      groupBy: [{ source: "group" }],
      latestOnly: true,
      sort: [{ column: "created_at", direction: "desc" }],
      eyes: {},
    },
  ]);
  assert.throws(() => compileCairnBlock(parseCairnSpec("runSets: [3]"), buildMetricIndex([])), /runSets\[0\] must be a mapping/);
  assert.throws(() => parseCairnSpec("runSets: {}"), /`runSets` must be a list/);
});

test("resolvedRunIds compiles a series over the resolved runs", () => {
  const metricIndex = buildMetricIndex([seqFixture("run_x", "train/loss"), seqFixture("run_y", "train/loss")]);
  const compiled = compileCairnBlock(parseCairnSpec(RUN_SETS_YAML), metricIndex, { resolvedRunIds: ["run_x", "run_y"] });
  const card = compiled.block.cards[0];
  assert.ok(card);
  assert.deepEqual([...new Set(card.series.map((s) => s.runId))].sort(), ["run_x", "run_y"]);
});

test("without resolvedRunIds the cards compile to an empty series", () => {
  const compiled = compileCairnBlock(parseCairnSpec(RUN_SETS_YAML), buildMetricIndex([]));
  assert.equal(compiled.block.cards[0]!.series.length, 0);
});

test("the old runs: format is not read", () => {
  assert.throws(() => parseCairnSpec("runs:\n  ids: [a]\ncards: []\n"), CairnLegacyRunsError);
  assert.throws(() => parseCairnSpec("runs:\n  selector: { mode: latest-n }\n"), CairnLegacyRunsError);
});

// The cell's run view (view.hidden/pinned/baseline) survives the fence.
test("run view round trip: hidden, pinned, baseline", () => {
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
    runSets: [runSetOfIds(["run_a", "run_b", "run_c"])],
    runView: { hidden: ["run_b"], pinned: ["run_c"], baseline: "run_a" },
    cards: [card],
  };
  const yamlText = stringifyCairnSpec(serializeCairnSpec(block));
  assert.match(yamlText, /hidden:\n\s+- run_b/);
  assert.match(yamlText, /baseline: run_a/);
  const compiled = compileCairnBlock(parseCairnSpec(yamlText), buildMetricIndex([]));
  assert.deepEqual(compiled.block.runView, block.runView);
  assert.deepEqual(compiled.block.runSets, block.runSets);

  // An empty view writes nothing and reads back as absent.
  const plain = stringifyCairnSpec(serializeCairnSpec({ ...block, runView: { hidden: [], pinned: [], baseline: null } }));
  assert.doesNotMatch(plain, /hidden|pinned|baseline/);
  assert.equal(compileCairnBlock(parseCairnSpec(plain), buildMetricIndex([])).block.runView, undefined);
});

test("run view is validated", () => {
  assert.throws(() => compileCairnBlock(parseCairnSpec("view:\n  hidden: a\n"), buildMetricIndex([])), /view.hidden must be a list/);
  assert.throws(() => compileCairnBlock(parseCairnSpec("view:\n  baseline: [a]\n"), buildMetricIndex([])), /view.baseline must be a run-id string/);
  assert.throws(() => parseCairnSpec("view: [a]"), /`view` must be a mapping/);
});
