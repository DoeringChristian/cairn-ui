/**
 * `parseReportMarkdown` resolves a `runs.selector` block against the project
 * run pool it is given (`opts.allProjectRuns`). Without the pool the card
 * compiles with `series: []` — and since a card's metric name only lives in
 * `series[].name`, no later rebind could recover it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../../api/types.ts";
import { isCardsBlock } from "./types.ts";
import { parseReportMarkdown } from "./markdown-source.ts";

function fakeRun(id: string, displayName: string, createdAt: string): Run {
  return {
    id,
    project_id: "proj",
    display_name: displayName,
    created_at: createdAt,
    ended_at: null,
    status: "running",
    exit_code: null,
    git_sha: null,
    git_dirty: null,
    git_branch: null,
    cli_args: null,
    env_snapshot: null,
    hostname: null,
    user: null,
    tags: null,
    notes: null,
    git_remote: null,
    parent_run_id: null,
    fork_step: null,
    data_epoch: 0,
    group: null,
    job_type: null,
    sweep_id: null,
    stop_requested: null,
  };
}

const ALL_RUNS: Run[] = [
  fakeRun("run_a", "ablate-1", "2026-07-01T00:00:00Z"),
  fakeRun("run_b", "ablate-2", "2026-07-02T00:00:00Z"),
];

const SELECTOR_SOURCE = [
  "```cairn",
  "id: blk1",
  "runs:",
  "  selector: { mode: newest-per-name, namePattern: ablate-* }",
  "cards:",
  "  - type: scalar",
  "    metric: val/loss",
  "```",
].join("\n");

function onlyCard(source: string, allProjectRuns?: Run[]) {
  const parsed = parseReportMarkdown(source, undefined, allProjectRuns ? { allProjectRuns } : undefined);
  assert.equal(parsed.blocks.length, 1);
  const block = parsed.blocks[0]!;
  assert.ok(isCardsBlock(block));
  assert.equal(block.cards.length, 1);
  return block.cards[0]!;
}

test("selector block without allProjectRuns compiles to an empty series", () => {
  assert.equal(onlyCard(SELECTOR_SOURCE).series.length, 0);
});

test("selector block with allProjectRuns binds the resolved runs", () => {
  const card = onlyCard(SELECTOR_SOURCE, ALL_RUNS);
  assert.deepEqual(card.series.map((s) => s.runId).sort(), ["run_a", "run_b"]);
  assert.ok(card.series.every((s) => s.name === "val/loss"));
});

test("static runs.ids block ignores allProjectRuns", () => {
  const source = [
    "```cairn",
    "id: blk2",
    "runs:",
    "  ids: [run_a]",
    "cards:",
    "  - type: scalar",
    "    metric: val/loss",
    "```",
  ].join("\n");
  assert.deepEqual(onlyCard(source, ALL_RUNS).series.map((s) => s.runId), ["run_a"]);
});
