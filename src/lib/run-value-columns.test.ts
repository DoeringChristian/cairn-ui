import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../api/types.ts";
import {
  compareValuesDirected,
  isValueColumn,
  valueColumnKey,
  valueColumnsOf,
} from "./run-value-columns.ts";

function run(id: string, values?: Run["values"]): Run {
  return {
    id,
    project_id: "p",
    display_name: id,
    created_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    status: "completed",
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
    values,
  };
}

const sortIds = (runs: Run[], key: string, dir: "asc" | "desc") =>
  [...runs]
    .sort((a, b) => {
      const cmp = compareValuesDirected(a, b, key, dir);
      return cmp !== 0 ? cmp : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((r) => r.id);

test("column ids round-trip through the value: prefix", () => {
  assert.ok(isValueColumn("value:val.acc"));
  assert.equal(valueColumnKey("value:val.acc"), "val.acc");
  assert.ok(!isValueColumn("status"));
  // A metric named like a built-in column must not shadow it.
  assert.ok(isValueColumn("value:status"));
  assert.equal(valueColumnKey("value:status"), "status");
});

test("columns are the union across runs, not the intersection", () => {
  const cols = valueColumnsOf([
    run("a", { acc: 1, loss: 2 }),
    run("b", { acc: 3, psnr: 4 }),
    run("c"),
  ]);
  assert.deepEqual(cols, ["acc", "loss", "psnr"]);
});

test("a run with no values contributes no columns and breaks nothing", () => {
  assert.deepEqual(valueColumnsOf([run("a"), run("b", {})]), []);
  assert.deepEqual(valueColumnsOf([]), []);
});

test("numbers sort numerically, not lexically", () => {
  const runs = [run("a", { acc: 9 }), run("b", { acc: 10 }), run("c", { acc: 2 })];
  assert.deepEqual(sortIds(runs, "acc", "asc"), ["c", "a", "b"]);
  assert.deepEqual(sortIds(runs, "acc", "desc"), ["b", "a", "c"]);
});

test("missing values sort last in BOTH directions", () => {
  // The bug this guards: the caller negates for descending, so a comparator
  // that only returned "missing is greater" would float blanks to the top and
  // bury every run that actually logged the metric.
  const runs = [run("a", { acc: 1 }), run("b"), run("c", { acc: 5 })];
  assert.deepEqual(sortIds(runs, "acc", "asc"), ["a", "c", "b"]);
  assert.deepEqual(sortIds(runs, "acc", "desc"), ["c", "a", "b"]);
});

test("a null value counts as missing, not as zero", () => {
  const runs = [run("a", { acc: null }), run("b", { acc: -5 })];
  assert.deepEqual(sortIds(runs, "acc", "asc"), ["b", "a"]);
  assert.deepEqual(sortIds(runs, "acc", "desc"), ["b", "a"]);
});

test("two missing values leave the stable tiebreaker in charge", () => {
  assert.equal(compareValuesDirected(run("a"), run("b"), "acc", "asc"), 0);
  assert.equal(compareValuesDirected(run("a"), run("b"), "acc", "desc"), 0);
});

test("non-numeric values fall back to a string compare", () => {
  const runs = [run("a", { tag: "beta" }), run("b", { tag: "alpha" })];
  assert.deepEqual(sortIds(runs, "tag", "asc"), ["b", "a"]);
  assert.deepEqual(sortIds(runs, "tag", "desc"), ["a", "b"]);
});

test("a mixed-type column does not throw", () => {
  const runs = [run("a", { x: 1 }), run("b", { x: "two" })];
  assert.equal(sortIds(runs, "x", "asc").length, 2);
});
